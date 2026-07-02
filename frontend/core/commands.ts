import type { Bus, CommandOrigin, CommandSource, CommandSpec, CommandSpecInput, EventName, RawInput } from '../types';
import type { IoApi } from './io';
import { STORAGE_KEYS } from './io';
import type { PerfApi } from './perf';
import { bindingParsed, keyMatchesEvent, parseShortcut, shortcutOf } from './shortcuts';

const POINTER_TYPES = new Set(['click', 'pointerdown', 'pointermove', 'pointerup', 'wheel']);
const originFromEvent = (event?: Event): CommandOrigin => {
  if (!event) return 'programmatic';
  if (event instanceof KeyboardEvent) return 'keyboard';
  if (POINTER_TYPES.has(event.type)) return 'pointer';
  return 'programmatic';
};

/** Owns the command registry: registration, shortcut overrides, conflict checks,
 *  enabled/disabled toggles (persisted via io), and dispatch. */
export function commandsContext(bus: Bus, isFlagOn: (origin?: string) => boolean, io: IoApi) {
  const commandMap = new Map<string, CommandSpec>();
  const shortcutOverrides = io.get<Record<string, string>>(STORAGE_KEYS.shortcuts, {});
  const disabledCommands = new Set<string>(io.get<string[]>(STORAGE_KEYS.disabledCommands, []));
  let enabledCache: CommandSpec[] | null = null;
  const inputCache = new Map<RawInput, CommandSpec[]>();
  const invalidate = () => {
    enabledCache = null;
    inputCache.clear();
  };
  bus.on('flag.changed', invalidate);

  const isEnabled = (command: CommandSpec) =>
    command.enabled !== false
    && !disabledCommands.has(command.id)
    && isFlagOn(command.origin);

  const normalizeShortcut = (shortcut: string) => {
    const p = parseShortcut(shortcut);
    return [p.ctrl && 'ctrl', p.meta && 'meta', p.alt && 'alt', p.shift && 'shift', p.key.toLowerCase()].filter(Boolean).join('+');
  };
  const shortcutConflict = (id: string, shortcut: string) => {
    const norm = normalizeShortcut(shortcut);
    if (!norm.endsWith('+') && !parseShortcut(shortcut).key) return undefined;
    return [...commandMap.values()].find(command =>
      command.id !== id && isEnabled(command) && normalizeShortcut(shortcutOf(command)) === norm,
    );
  };
  const applyShortcut = (command: CommandSpec, shortcut: string) => {
    command.shortcut = shortcut;
    if (command.input?.on === 'keydown') {
      const p = parseShortcut(shortcut);
      command.input.key = p.key;
      command.input.ctrl = p.ctrl;
      command.input.shift = p.shift;
      command.input.alt = p.alt;
      command.input.meta = p.meta;
    }
  };
  const applyOverrides = (command: CommandSpec) => {
    const override = shortcutOverrides[command.id];
    if (override != null) applyShortcut(command, override);
  };

  return {
    register: (specs: CommandSpecInput[], origin?: string) => {
      specs.forEach(input => {
        const command = input as CommandSpec;
        // `event` defaults to `id`. Most commands have id === event; the option to
        // override exists for cases where many command ids fire the same event
        // (e.g. four nudge directions → 'item.update', several pointer variants
        // → 'drag.item.start').
        if (!command.event) command.event = command.id as EventName;
        if (origin && !command.origin) command.origin = origin;
        applyOverrides(command);
        commandMap.set(command.id, command);
      });
      invalidate();
    },
    unregister(id: string) { commandMap.delete(id); invalidate(); },
    unregisterOrigin(origin: string) {
      for (const [id, command] of commandMap) if (command.origin === origin) commandMap.delete(id);
      invalidate();
    },
    get: (id: string) => commandMap.get(id),
    all: () => [...commandMap.values()],
    enabled: () => enabledCache ??= [...commandMap.values()].filter(isEnabled),
    enabledForInput(type: RawInput) {
      let cached = inputCache.get(type);
      if (!cached) {
        cached = (enabledCache ??= [...commandMap.values()].filter(isEnabled))
          .filter(command => command.input?.on === type);
        inputCache.set(type, cached);
      }
      return cached;
    },
    isEnabled,
    shortcutConflict,
    setShortcut(id: string, shortcut: string) {
      const command = commandMap.get(id);
      if (!command) return false;
      const next = shortcut.trim();
      if (shortcutConflict(id, next)) return false;
      applyShortcut(command, next);
      shortcutOverrides[id] = next;
      bus.emit('command.shortcut.changed', { id, shortcut: next });
      return true;
    },
    setEnabled(id: string, enabled: boolean) {
      const command = commandMap.get(id);
      if (!command) return false;
      if (enabled) disabledCommands.delete(id); else disabledCommands.add(id);
      bus.emit('command.enabled.changed', { id, enabled });
      invalidate();
      return true;
    },
    run(id: string, source: CommandSource = {}) {
      const command = commandMap.get(id);
      if (!command || !isEnabled(command) || command.available?.(source) === false) return false;
      const resolved: CommandSource = source.origin ? source : { ...source, origin: originFromEvent(source.event) };
      const payload = command.payload?.(resolved);
      if (command.picker) {
        bus.emit('commandPicker.open', { commandId: id, source: resolved });
        return true;
      }
      if (command.form?.shouldOpen?.(payload, resolved)) {
        bus.emit('commandForm.open', {
          commandId: id,
          seed: command.form.seed?.(payload, resolved) ?? {},
        });
        return true;
      }
      bus.forward(command.event, payload);
      return true;
    },
  };
}

/** Routes raw DOM events to commands. Click → `[data-command]`; key/pointer/wheel
 *  → match against registered command.input bindings. Two strictness layers
 *  shield "in another scope" inputs from spilling into app commands:
 *
 *    1. Typing — inside any input/textarea/select/contenteditable, non-global
 *       commands without a `selector` are skipped (so typing the letter "a"
 *       in a text field doesn't create a node).
 *    2. Modal — when a modal is mounted, non-global commands whose event
 *       target is outside the modal are skipped. Backdrop, form fields, and
 *       command buttons inside the modal still work; A/E/G/etc on the
 *       background do nothing until the modal closes. */
export function inputRouter(commands: ReturnType<typeof commandsContext>, perf?: PerfApi) {
  return {
    start(root: Document | HTMLElement = document) {
      /** A modal is "mounted" when [data-place="modal"] has any rendered children. */
      const modalScopeEl = (): Element | null => {
        const placeEl = (root instanceof Document ? root : root).querySelector('[data-place="modal"]');
        return placeEl?.firstElementChild ? placeEl : null;
      };
      const targetInModal = (target: Element | null, modal: Element | null) =>
        !!modal && !!target && modal.contains(target);
      const route = (event: Event) => {
        const rawTarget = event.target instanceof Element ? event.target : null;
        const trace = perf?.beginInput(event.type, event, rawTarget);
        const candidates: string[] = [];
        const matched: string[] = [];
        const runCommand = (id: string, target: Element) => {
          matched.push(id);
          const run = () => commands.run(id, { event, target });
          return perf?.enabled() ? perf.measure(`Command.run.${id}`, run) : run();
        };
        try {
          const typing = event instanceof KeyboardEvent
            && (/input|textarea|select/i.test(rawTarget?.tagName ?? '') || (rawTarget instanceof HTMLElement && rawTarget.isContentEditable));
          const modal = modalScopeEl();
          const inModal = targetInModal(rawTarget, modal);

          const button = event.type === 'click' ? rawTarget?.closest('[data-command]') : null;
          if (button instanceof HTMLElement) {
            // Modal strictness for click-driven data-command buttons too —
            // background toolbar buttons can't fire while a modal is up.
            if (modal && !modal.contains(button)) return;
            const commandId = button.dataset.command!;
            candidates.push(commandId);
            event.preventDefault();
            runCommand(commandId, button);
            return;
          }

          const commandsForInput = commands.enabledForInput(event.type as RawInput);
          candidates.push(...commandsForInput.map(command => command.id));
          for (const command of commandsForInput) {
            const binding = command.input;
            if (!binding || binding.on !== event.type) continue;
            if (event instanceof KeyboardEvent && (!binding.key || !keyMatchesEvent(event, bindingParsed(binding)))) continue;
            const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
            if (!(target instanceof Element) || (binding.selector && !target)) continue;
            if (typing && !binding.global && !binding.selector) continue;
            if (modal && !binding.global && !inModal) continue;
            if (binding.when && !binding.when(event, target)) continue;
            if (binding.prevent) event.preventDefault();
            runCommand(command.id, target);
            if (binding.stop) break;
          }
        } finally {
          trace?.end({ candidates, matched });
        }
      };
      const types: string[] = ['click', 'dblclick', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'input', 'change', 'focusout', 'paste'];
      types.forEach(type => root.addEventListener(type, route, type === 'wheel' ? { passive: false } : undefined));
      return () => types.forEach(type => root.removeEventListener(type, route));
    },
  };
}
