import type { Bus, CommandOrigin, CommandSource, CommandSpec, EventName } from '../types';
import type { IoApi } from './io';
import { STORAGE_KEYS } from './io';
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
    register: (specs: CommandSpec[], origin?: string) => specs.forEach(command => {
      if (origin && !command.origin) command.origin = origin;
      applyOverrides(command);
      commandMap.set(command.id, command);
    }),
    unregister(id: string) { commandMap.delete(id); },
    unregisterOrigin(origin: string) {
      for (const [id, command] of commandMap) if (command.origin === origin) commandMap.delete(id);
    },
    get: (id: string) => commandMap.get(id),
    all: () => [...commandMap.values()],
    enabled: () => [...commandMap.values()].filter(isEnabled),
    isEnabled,
    shortcutConflict,
    setShortcut(id: string, shortcut: string) {
      const command = commandMap.get(id);
      if (!command) return false;
      const next = shortcut.trim();
      if (shortcutConflict(id, next)) return false;
      applyShortcut(command, next);
      shortcutOverrides[id] = next;
      io.set(STORAGE_KEYS.shortcuts, shortcutOverrides);
      return true;
    },
    setEnabled(id: string, enabled: boolean) {
      const command = commandMap.get(id);
      if (!command) return false;
      if (enabled) disabledCommands.delete(id); else disabledCommands.add(id);
      io.set(STORAGE_KEYS.disabledCommands, [...disabledCommands]);
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
export function inputRouter(commands: ReturnType<typeof commandsContext>) {
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
        const typing = event instanceof KeyboardEvent
          && (/input|textarea|select/i.test(rawTarget?.tagName ?? '') || (rawTarget instanceof HTMLElement && rawTarget.isContentEditable));
        const modal = modalScopeEl();
        const inModal = targetInModal(rawTarget, modal);

        const button = event.type === 'click' ? rawTarget?.closest('[data-command]') : null;
        if (button instanceof HTMLElement) {
          // Modal strictness for click-driven data-command buttons too —
          // background toolbar buttons can't fire while a modal is up.
          if (modal && !modal.contains(button)) return;
          event.preventDefault();
          commands.run(button.dataset.command!, { event, target: button });
          return;
        }

        for (const command of commands.enabled()) {
          const binding = command.input;
          if (!binding || binding.on !== event.type) continue;
          if (event instanceof KeyboardEvent && (!binding.key || !keyMatchesEvent(event, bindingParsed(binding)))) continue;
          const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
          if (!(target instanceof Element) || (binding.selector && !target)) continue;
          if (typing && !binding.global && !binding.selector) continue;
          if (modal && !binding.global && !inModal) continue;
          if (binding.when && !binding.when(event, target)) continue;
          if (binding.prevent) event.preventDefault();
          commands.run(command.id, { event, target });
          if (binding.stop) break;
        }
      };
      const types: EventName[] | string[] = ['click', 'dblclick', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'input', 'change', 'focusout'];
      types.forEach(type => root.addEventListener(type, route, type === 'wheel' ? { passive: false } : undefined));
      return () => types.forEach(type => root.removeEventListener(type, route));
    },
  };
}
