import type { GraphStore } from './model';
import type {
  ActionDef,
  AffordanceDef,
  AffordanceSurface,
  AnyEvent,
  Bus,
  CollectionDef,
  CommandSource,
  CommandSpec,
  EntityDef,
  EventName,
  FeatureFlags,
  Id,
  ItemRef,
  ModelDef,
  NodeEntity,
  Place,
  Position,
  PropertyDef,
  PropertyRenderer,
  PropertyValue,
  RawInput,
  Rect,
  Renderable,
  SystemAffordance,
  UiValue,
  ViewState,
} from './types';

export type Contexts = ReturnType<typeof createContexts>;
export type Models = ReturnType<typeof createModelRegistry>;
export type ModelCtx = { graphs: GraphStore };
export type AppCtx = {
  bus: Bus;
  graphs: GraphStore;
  contexts: Contexts;
  model: Models;
  flags: FlagsApi;
  selection: SelectionStore;
  io: IoApi;
};
export type AppCollectionDef<T> = CollectionDef<T, ModelCtx>;
export type SystemCtx = AppCtx & Pick<Bus, 'on' | 'emit'> & {
  /** Stable name of the currently-starting system / ability — used to tag commands for unregister. */
  origin: string;
  /** Shorthand: contribute an affordance tagged with this system's origin. */
  contribute(aff: SystemAffordance): void;
};
export type AppSystem = (ctx: SystemCtx) => void;
export type RegistryEntryOptions = {
  /** Other system / ability / feature names that must be enabled for this entry to function well.
   *  DX will warn if this entry is enabled but a required dep is off. */
  requires?: string[];
};
export type Registry = ((name: string, setup: AppSystem, opts?: RegistryEntryOptions) => void) & {
  start(ctx: AppCtx): void;
  names(): string[];
  enabledNames(flags: FlagsApi): string[];
  requires(name: string): string[];
  /** Post-register the requires list for an already-declared entry. Useful when the entry table is built top-down
   *  and the dep map is colocated at the bottom for readability. */
  setRequires(name: string, requires: string[]): void;
};
export type FlagsApi = {
  all(): FeatureFlags;
  isOn(name: string): boolean;
  set(name: string, on: boolean): void;
  declared(): string[];
  declare(name: string, defaultOn?: boolean, requires?: string[]): void;
  /** Names the given flag depends on. Populated by registry.start. */
  requires(name: string): string[];
};
export type SelectionStore = {
  selected(graphId?: Id): Id | null;
  focused(graphId?: Id): Id | null;
  selectedNode(graphId?: Id): NodeEntity | undefined;
  select(id: Id | null, graphId?: Id): void;
  focus(id: Id | null, graphId?: Id): void;
};

declare global { interface Window { v2?: AppCtx } }

export const systemOf = (id: string) => id.split('.')[0] || 'app';
export const shortcutOf = (command: CommandSpec) =>
  command.shortcut ?? (command.input?.key ? shortcutLabel(command.input) : '');
/** Parse a shortcut string into key + modifier requirements.
 *  Format: `Mod+Mod+Key` e.g. `Ctrl+Shift+P`, `Cmd+K`, `Alt+ArrowRight`, `?`. */
type ParsedShortcut = { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
export const parseShortcut = (shortcut: string): ParsedShortcut => {
  const parts = shortcut.split('+').map(p => p.trim()).filter(Boolean);
  const result: ParsedShortcut = { key: '', ctrl: false, shift: false, alt: false, meta: false };
  const rawKey = parts.pop() ?? '';
  result.key = rawKey.toLowerCase() === 'esc' ? 'Escape' : rawKey;
  for (const part of parts) {
    const m = part.toLowerCase();
    if (m === 'ctrl' || m === 'control') result.ctrl = true;
    else if (m === 'shift') result.shift = true;
    else if (m === 'alt' || m === 'option') result.alt = true;
    else if (m === 'meta' || m === 'cmd' || m === 'command') result.meta = true;
  }
  return result;
};
/** Render a shortcut input back to a label string for display. */
const shortcutLabel = (input: NonNullable<CommandSpec['input']>) => {
  const parts = [
    input.ctrl ? 'Ctrl' : null,
    input.meta ? 'Cmd' : null,
    input.alt ? 'Alt' : null,
    input.shift ? 'Shift' : null,
    input.key,
  ].filter(Boolean);
  return parts.join('+');
};
const keyMatchesEvent = (event: Event, parsed: ParsedShortcut) => {
  if (!(event instanceof KeyboardEvent)) return false;
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.metaKey !== parsed.meta) return false;
  // For letter keys the shortcut MUST specify shift correctly (so 'a' and 'A' are distinct).
  // For non-letter keys we trust event.key to already encode shift output (so '?' matches Shift+/).
  const isLetter = /^[a-z]$/i.test(parsed.key);
  if (isLetter && event.shiftKey !== parsed.shift) return false;
  if (!isLetter && parsed.shift && !event.shiftKey) return false;
  return event.key.toLowerCase() === parsed.key.toLowerCase();
};
const bindingParsed = (input: NonNullable<CommandSpec['input']>): ParsedShortcut => ({
  key: input.key ?? '',
  ctrl: !!input.ctrl, shift: !!input.shift, alt: !!input.alt, meta: !!input.meta,
});
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const nodeRect = (node: NodeEntity): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};
export const clientPoint = (event: Event): Position => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY });
export const isStageSurface = (event: Event, stage: Element) =>
  event.target === stage || (event.target instanceof Element && event.target.classList.contains('nodes'));
export const appendRenderable = (slot: Element, view: Renderable) => {
  const value = typeof view === 'function' ? view() : view;
  if (typeof value === 'string') slot.insertAdjacentHTML('beforeend', value);
  else slot.append(value);
};
export const grouped = <T,>(items: T[], keyOf: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  items.forEach(item => (groups.get(keyOf(item)) || groups.set(keyOf(item), []).get(keyOf(item))!).push(item));
  return [...groups.entries()];
};
/** Build an empty-state DOM block. Hint is HTML-safe: pass <kbd> markup if you want a keycap.
 *  Returns null when no template adapter is reachable (kiosk mode). */
export const emptyState = (ctx: Contexts, title: string, hintHtml = '') => {
  try {
    const el = ctx.templates.clone<HTMLElement>('empty');
    ctx.templates.text(el, 'title', title);
    const hintEl = el.querySelector('[data-text="hint"]');
    if (hintEl) hintEl.innerHTML = hintHtml;
    return el;
  } catch { return null; }
};
/** Shortcut label for a registered command, or null if it can't be triggered from keys. */
export const commandShortcut = (commands: Contexts['commands'], id: string) => {
  const c = commands.get(id);
  return c ? shortcutOf(c) : null;
};
export const uiValue = <T,>(value: UiValue<T> | undefined, item: T, fallback = '') =>
  typeof value === 'function' ? value(item) : value ?? fallback;
export const entityUi = <T,>(entityDef: EntityDef<T>, slot?: string) =>
  entityDef.abilities.flatMap(abilityDef => abilityDef.actions.flatMap(actionDef =>
    actionDef.ui
      .filter(ui => ui.surface === 'entity' && (slot == null || ui.slot === slot))
      .map(ui => ({ action: actionDef as ActionDef<T>, ui: ui as AffordanceDef<T> })),
  ));
export const itemIdFrom = (target?: Element | null) =>
  target?.closest('[data-item-id]')?.getAttribute('data-item-id')
  ?? target?.closest('[data-node-id]')?.getAttribute('data-node-id')
  ?? target?.closest('[data-graph-id]')?.getAttribute('data-graph-id')
  ?? '';
export const itemRefFrom = (target?: Element | null): ItemRef | null => {
  const node = target?.closest('[data-node-id]')?.getAttribute('data-node-id');
  if (node) return { kind: 'node', id: node };
  const graph = target?.closest('[data-graph-id]')?.getAttribute('data-graph-id');
  if (graph) return { kind: 'graph', id: graph };
  return null;
};

export const createModelRegistry = <Ctx,>(model: ModelDef<Ctx>, flags?: FlagsApi) => {
  const entities = new Map(model.entities.map(entityDef => [entityDef.kind, entityDef]));
  const collections = new Map(model.collections.map(collectionDef =>
    [collectionDef.id, collectionDef as unknown as CollectionDef<unknown, unknown>],
  ));
  // Disabled abilities disappear from the live model — render, palette, and DX all stop seeing them.
  const filterAbilities = <T,>(entityDef: EntityDef<T>): EntityDef<T> => {
    if (!flags) return entityDef;
    const liveAbilities = entityDef.abilities.filter(ability => flags.isOn(`ability.${ability.id}`));
    return liveAbilities.length === entityDef.abilities.length ? entityDef : { ...entityDef, abilities: liveAbilities };
  };
  return {
    entity<T, Patch = unknown>(kind: string) {
      const entityDef = entities.get(kind) as EntityDef<T, Patch> | undefined;
      return entityDef ? filterAbilities(entityDef) as EntityDef<T, Patch> : undefined;
    },
    collection<T>(id: string) { return collections.get(id) as CollectionDef<T, unknown> | undefined; },
    entities: () => [...entities.values()].map(e => filterAbilities(e)),
    collections: () => [...collections.values()],
    /** Raw, unfiltered access — DX validator uses this to compare declared vs live. */
    rawEntities: () => [...entities.values()],
  };
};

function templateContext() {
  const find = (root: ParentNode, selector: string) =>
    root instanceof Element && root.matches(selector) ? root : root.querySelector(selector);
  const cloned = new Set<string>();
  const clone = <T extends HTMLElement = HTMLElement>(name: string) => {
    cloned.add(name);
    const template = document.getElementById(`tpl-${name}`);
    const node = template instanceof HTMLTemplateElement ? template.content.firstElementChild?.cloneNode(true) : null;
    if (!(node instanceof HTMLElement)) throw new Error(`Missing template: ${name}`);
    return node as T;
  };
  const text = (root: ParentNode, name: string, value: unknown) => {
    const el = find(root, `[data-text="${name}"]`);
    if (el) el.textContent = String(value ?? '');
    return root;
  };
  const slot = (root: ParentNode, name: string) => {
    const el = find(root, `[data-slot="${name}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`Missing slot: ${name}`);
    return el;
  };
  return { clone, text, slot, _cloned: cloned };
}

function viewContext(places: Map<Place, HTMLElement>) {
  let state: ViewState = { x: 0, y: 0, scale: 1 };
  const localRect = (place: Place) => places.get(place)?.getBoundingClientRect();
  const get = () => ({ ...state });
  const set = (next: Partial<ViewState>) => {
    state = {
      x: next.x ?? state.x,
      y: next.y ?? state.y,
      scale: clamp(next.scale ?? state.scale, 0.25, 3),
    };
    return get();
  };
  const clientToScreen = (place: Place, point: Position) => {
    const rect = localRect(place);
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : point;
  };
  const screenToSpace = (point: Position) => ({ x: state.x + point.x / state.scale, y: state.y + point.y / state.scale });
  const spaceToScreen = (point: Position) => ({ x: (point.x - state.x) * state.scale, y: (point.y - state.y) * state.scale });
  const clientToSpace = (place: Place, point: Position) => screenToSpace(clientToScreen(place, point));
  const screenCenter = (place: Place) => {
    const rect = localRect(place);
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  };
  const spaceCenter = (place: Place) => screenToSpace(screenCenter(place));
  const visibleRect = (place: Place, margin = 0): Rect | null => {
    const rect = localRect(place);
    if (!rect) return null;
    return {
      x: state.x - margin,
      y: state.y - margin,
      w: rect.width / state.scale + margin * 2,
      h: rect.height / state.scale + margin * 2,
    };
  };
  const isVisible = (place: Place, rect: Rect, margin = 0) => {
    const visible = visibleRect(place, margin);
    return !visible || rectsIntersect(visible, rect);
  };
  const zoomAtScreen = (screen: Position, factor: number) => {
    const before = screenToSpace(screen);
    const scale = clamp(state.scale * factor, 0.25, 3);
    return set({ scale, x: before.x - screen.x / scale, y: before.y - screen.y / scale });
  };
  return { get, set, clientToScreen, screenToSpace, spaceToScreen, clientToSpace, screenCenter, spaceCenter, visibleRect, isVisible, zoomAtScreen };
}

type InstrumentedBus = Bus & { _subscribed: Set<string>; _emitted: Set<string> };
function eventBus(): InstrumentedBus {
  const listeners = new Map<EventName, ((data: unknown, event: AnyEvent) => void)[]>();
  const any: ((event: AnyEvent) => void)[] = [];
  // Dev-time event vocabulary tracking — feeds the DX orphan-event check.
  const subscribed = new Set<string>();
  const emitted = new Set<string>();
  return {
    on(name, fn) {
      subscribed.add(name);
      (listeners.get(name) || listeners.set(name, []).get(name)!).push(fn as (data: unknown, event: AnyEvent) => void);
    },
    onAny(fn) { any.push(fn); },
    emit(name, ...args) {
      emitted.add(name);
      const event = { name, data: args[0], at: performance.now() } as AnyEvent;
      any.forEach(fn => fn(event));
      (listeners.get(name) || []).forEach(fn => fn(event.data, event));
    },
    _subscribed: subscribed,
    _emitted: emitted,
  };
}

/** Persistence keys used across core. Owned here so the io system can audit them. */
export const STORAGE_KEYS = {
  shortcuts: 'v2.shortcuts',
  flags: 'v2.flags',
  disabledCommands: 'v2.commands.disabled',
} as const;

/** IoApi is the swap point between localStorage, an in-memory map, IndexedDB, an HTTP server, etc.
 *  Pass a different implementation to `createAppContext` to test or to boot kiosk-style. */
export type IoApi = {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  del(key: string): void;
  keys(): string[];
};

export const localStorageIo = (): IoApi => ({
  get<T>(key: string, fallback: T): T {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* */ } },
  keys() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (k) keys.push(k);
      }
      return keys;
    } catch { return []; }
  },
});

export const memoryIo = (): IoApi => {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, fallback: T) { return store.has(key) ? store.get(key) as T : fallback; },
    set(key, value) { store.set(key, value); },
    del(key) { store.delete(key); },
    keys: () => [...store.keys()],
  };
};

function createContexts(bus: Bus, flags: FlagsApi, io: IoApi) {
  const commandMap = new Map<string, CommandSpec>();
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);
  const shortcutOverrides = io.get<Record<string, string>>(STORAGE_KEYS.shortcuts, {});
  const disabledCommands = new Set<string>(io.get<string[]>(STORAGE_KEYS.disabledCommands, []));
  const isEnabled = (command: CommandSpec) =>
    command.enabled !== false
    && !disabledCommands.has(command.id)
    && (!command.origin || flags.isOn(command.origin));

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
  const applyOverrides = (command: CommandSpec) => {
    const override = shortcutOverrides[command.id];
    if (override == null) return;
    command.shortcut = override;
    if (command.input?.on === 'keydown') {
      const p = parseShortcut(override);
      command.input.key = p.key;
      command.input.ctrl = p.ctrl;
      command.input.shift = p.shift;
      command.input.alt = p.alt;
      command.input.meta = p.meta;
    }
  };

  const commands = {
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
      command.shortcut = next;
      if (command.input?.on === 'keydown') {
        const p = parseShortcut(next);
        command.input.key = p.key;
        command.input.ctrl = p.ctrl;
        command.input.shift = p.shift;
        command.input.alt = p.alt;
        command.input.meta = p.meta;
      }
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
      const payload = command.payload?.(source);
      (bus.emit as (name: EventName, data?: unknown) => void)(command.event, payload);
      return true;
    },
  };

  const input = {
    start(root: Document | HTMLElement = document) {
      const route = (event: Event) => {
        const rawTarget = event.target instanceof Element ? event.target : null;
        const typing = event instanceof KeyboardEvent
          && (/input|textarea|select/i.test(rawTarget?.tagName ?? '') || (rawTarget instanceof HTMLElement && rawTarget.isContentEditable));

        const button = event.type === 'click' ? rawTarget?.closest('[data-command]') : null;
        if (button instanceof HTMLElement) {
          event.preventDefault();
          commands.run(button.dataset.command!, { event, target: button });
          return;
        }

        for (const command of commands.enabled()) {
          const binding = command.input;
          if (!binding || binding.on !== event.type) continue;
          if (binding.key && !keyMatchesEvent(event, bindingParsed(binding))) continue;
          const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
          if (!(target instanceof Element) || (binding.selector && !target)) continue;
          if (typing && !binding.global && !binding.selector) continue;
          if (binding.when && !binding.when(event, target)) continue;
          if (binding.prevent) event.preventDefault();
          commands.run(command.id, { event, target });
          if (binding.stop) break;
        }
      };
      (['click', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'input', 'change', 'focusout'] as RawInput[])
        .forEach(type => root.addEventListener(type, route, type === 'wheel' ? { passive: false } : undefined));
    },
  };

  const placeContext = {
    set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
    el: (place: Place) => places.get(place) ?? null,
  };

  /** Property input registry — turns `prop.input` (a string) into an HTMLElement.
   *  New input kinds (color picker, select, etc.) register here without touching core.
   *  Default renderers for 'text', 'number', 'checkbox' are seeded below. */
  const renderers = new Map<string, PropertyRenderer<any>>();
  const defaultRender = <T,>(prop: PropertyDef<T>, item: T): HTMLElement => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.dataset.field = prop.id;
    input.type = prop.input;
    if (prop.min != null) input.min = `${prop.min}`;
    if (prop.step != null) input.step = `${prop.step}`;
    if (prop.input === 'checkbox') {
      label.className = 'check-row';
      input.checked = Boolean(prop.value(item));
      label.append(input, prop.label);
    } else {
      if (prop.input === 'text') input.classList.add('editable-inline');
      input.value = String(prop.value(item));
      label.append(prop.label, input);
    }
    return label;
  };
  renderers.set('text', defaultRender);
  renderers.set('number', defaultRender);
  renderers.set('checkbox', defaultRender);
  const properties = {
    register(name: string, render: PropertyRenderer) { renderers.set(name, render); },
    has(name: string) { return renderers.has(name); },
    render<T>(prop: PropertyDef<T>, item: T): HTMLElement {
      const renderer = renderers.get(prop.input) ?? defaultRender;
      return renderer(prop, item);
    },
    names: () => [...renderers.keys()],
  };

  // DX inspection surface — `dx` system writes here at boot for tests/devtools to read.
  let lastDxIssues: DxIssue[] = [];
  const dx = {
    issues: () => lastDxIssues,
    _set(issues: DxIssue[]) { lastDxIssues = issues; },
  };

  // System-level affordances (toolbar buttons, side-bar entries, list contributions).
  // Entity affordances stay on EntityDef.abilities — they need item context. System
  // affordances are context-free, so any system can contribute one.
  const surfaceAffordances = new Map<AffordanceSurface, SystemAffordance[]>();
  const affordances = {
    contribute(aff: SystemAffordance) {
      const list = surfaceAffordances.get(aff.surface) ?? [];
      list.push(aff);
      surfaceAffordances.set(aff.surface, list);
      bus.emit('affordance.contributed', { surface: aff.surface });
    },
    for(surface: AffordanceSurface) {
      const list = [...(surfaceAffordances.get(surface) ?? [])];
      return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    unregisterOrigin(origin: string) {
      for (const [surface, list] of surfaceAffordances) {
        surfaceAffordances.set(surface, list.filter(a => a.origin !== origin));
      }
    },
  };

  return { commands, input, places: placeContext, templates, view, properties, dx, affordances };
}

/** Registry runs setup functions in insertion order, filtering by feature flag.
 *  Each setup gets `origin: <name>` injected so any commands it registers are tagged. */
export function registry(): Registry {
  const entries: { name: string; setup: AppSystem; requires: string[] }[] = [];
  const register = ((name: string, setup: AppSystem, opts: RegistryEntryOptions = {}) => {
    entries.push({ name, setup, requires: opts.requires ?? [] });
  }) as Registry;
  register.start = (ctx) => {
    entries.forEach(entry => {
      ctx.flags.declare(entry.name, true, entry.requires);
      if (!ctx.flags.isOn(entry.name)) return;
      const api: SystemCtx = {
        ...ctx,
        on: ctx.bus.on,
        emit: ctx.bus.emit,
        origin: entry.name,
        contribute: (aff) => ctx.contexts.affordances.contribute({ ...aff, origin: aff.origin ?? entry.name }),
      };
      // Adapt register so commands without `origin` get tagged with the current system name.
      const original = ctx.contexts.commands.register;
      const taggedRegister = (specs: CommandSpec[]) => original(specs, entry.name);
      const restore = ctx.contexts.commands.register;
      ctx.contexts.commands.register = taggedRegister as typeof original;
      try { entry.setup(api); } finally { ctx.contexts.commands.register = restore; }
    });
  };
  register.names = () => entries.map(entry => entry.name);
  register.enabledNames = (flags) => entries.map(e => e.name).filter(name => flags.isOn(name));
  register.requires = (name) => entries.find(e => e.name === name)?.requires ?? [];
  register.setRequires = (name, requires) => {
    const e = entries.find(e => e.name === name);
    if (e) e.requires = requires;
  };
  return register;
}

export function createFlags(initial: FeatureFlags = {}, io: IoApi = localStorageIo()): FlagsApi {
  const persisted = io.get<FeatureFlags>(STORAGE_KEYS.flags, {});
  const state: FeatureFlags = { ...initial, ...persisted };
  const deps = new Map<string, string[]>();
  return {
    all: () => ({ ...state }),
    isOn: (name) => state[name] !== false,
    declare(name, defaultOn = true, requires) {
      if (!(name in state)) state[name] = defaultOn;
      if (requires?.length) deps.set(name, requires);
    },
    set(name, on) { state[name] = on; io.set(STORAGE_KEYS.flags, state); },
    declared: () => Object.keys(state),
    requires: (name) => deps.get(name) ?? [],
  };
}

/** Selection and focus live OUTSIDE Graph so a graph can be displayed without one,
 *  and so multiple stores (e.g. per-view) can coexist. Keyed by graph id. */
export function createSelectionStore(graphs: GraphStore, bus: Bus): SelectionStore {
  const sel = new Map<Id, Id | null>();
  const foc = new Map<Id, Id | null>();
  const gid = (override?: Id) => override ?? graphs.current.id;
  // Stale selection cleanup when the underlying node disappears.
  bus.on('graph.node.deleted', ({ graphId, id }) => {
    if (sel.get(graphId) === id) { sel.set(graphId, null); bus.emit('selection.node.selected', { id: null }); }
    if (foc.get(graphId) === id) { foc.set(graphId, null); bus.emit('focus.node.focused', { id: null }); }
  });
  return {
    selected: (graphId) => sel.get(gid(graphId)) ?? null,
    focused: (graphId) => foc.get(gid(graphId)) ?? null,
    selectedNode: (graphId) => {
      const id = sel.get(gid(graphId)); if (!id) return undefined;
      return graphs.get(gid(graphId))?.node(id);
    },
    select(id, graphId) { sel.set(gid(graphId), id); },
    focus(id, graphId) { foc.set(gid(graphId), id); },
  };
}

export function createAppContext(
  graphs: GraphStore,
  model: ModelDef<ModelCtx>,
  flags: FlagsApi = createFlags(),
  io: IoApi = localStorageIo(),
): AppCtx {
  const bus = eventBus();
  const selection = createSelectionStore(graphs, bus);
  return {
    bus, graphs, flags, selection, io,
    contexts: createContexts(bus, flags, io),
    model: createModelRegistry(model, flags),
  };
}

export type DxIssue = { level: 'error' | 'warn'; rule: string; message: string };
/** Run DX checks against the *live* app context — model + commands + flags + observed runtime activity.
 *  Called from the `dx` system at `app.start`. */
export function runDx(ctx: AppCtx): DxIssue[] {
  const issues: DxIssue[] = [];
  const error = (rule: string, message: string) => issues.push({ level: 'error', rule, message });
  const warn = (rule: string, message: string) => issues.push({ level: 'warn', rule, message });

  const commands = ctx.contexts.commands.all();
  const commandIds = new Set(commands.map(c => c.id));
  const visibleCommandIds = new Set(commands.filter(c => !c.hidden).map(c => c.id));

  // RULE 1: ability/action contract (existing).
  ctx.model.entities().forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    if (!abilityDef.actions.length) error('ability.no-actions', `${entityDef.kind}.${abilityDef.id} has no actions`);
    if (abilityDef.id === 'configurable' && !entityDef.properties?.length) {
      error('configurable.no-properties', `${entityDef.kind}.configurable declares no properties`);
    }
    abilityDef.actions.forEach(actionDef => {
      if (actionDef.paletteCommand != null && !visibleCommandIds.has(actionDef.paletteCommand)) {
        error('action.palette-missing', `${actionDef.id} missing visible palette command ${actionDef.paletteCommand}`);
      }
      if (!actionDef.ui.length) error('action.no-ui', `${actionDef.id} has no UI affordance`);
      actionDef.ui.forEach(ui => {
        if (!commandIds.has(ui.command)) error('action.ui-command-missing', `${actionDef.id} UI missing command ${ui.command}`);
      });
    });
  }));

  // RULE 2: collections must have CRUD + search + order.
  ctx.model.collections().forEach(collectionDef => {
    if (!commandIds.has(collectionDef.crud.create)) error('collection.no-create', `${collectionDef.id} missing create command ${collectionDef.crud.create}`);
    if (!commandIds.has(collectionDef.crud.delete)) error('collection.no-delete', `${collectionDef.id} missing delete command ${collectionDef.crud.delete}`);
    if (!collectionDef.search) error('collection.no-search', `${collectionDef.id} missing search`);
    if (!collectionDef.order) error('collection.no-order', `${collectionDef.id} missing order`);
  });

  // RULE 3: declared-but-disabled ability (entity asks for X, flag turned off).
  if ('rawEntities' in ctx.model) {
    const raw = (ctx.model as Models).rawEntities();
    raw.forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
      if (!ctx.flags.isOn(`ability.${abilityDef.id}`)) {
        warn('ability.disabled', `${entityDef.kind}.${abilityDef.id} is declared but its flag 'ability.${abilityDef.id}' is off`);
      }
    }));
  }

  // RULE 4: duplicate input bindings — same `on` + `key` + mods + selector. Predicate `when` ignored.
  const bindingKey = (c: CommandSpec) => {
    const b = c.input; if (!b) return null;
    return [b.on, b.key ?? '', b.ctrl ? 'C' : '', b.shift ? 'S' : '', b.alt ? 'A' : '', b.meta ? 'M' : '', b.selector ?? ''].join('|');
  };
  const seenBindings = new Map<string, CommandSpec>();
  ctx.contexts.commands.enabled().forEach(c => {
    const key = bindingKey(c); if (!key) return;
    const prev = seenBindings.get(key);
    if (prev) warn('binding.duplicate', `commands "${prev.id}" and "${c.id}" share input binding ${key}`);
    else seenBindings.set(key, c);
  });

  // RULE 5: paletteCommand collisions — same command id used as canonical action for 2+ actions.
  const paletteOwners = new Map<string, string>();
  ctx.model.entities().forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    abilityDef.actions.forEach(actionDef => {
      if (!actionDef.paletteCommand) return;
      const prev = paletteOwners.get(actionDef.paletteCommand);
      if (prev) error('action.palette-shared', `paletteCommand "${actionDef.paletteCommand}" is the canonical for both "${prev}" and "${actionDef.id}"`);
      else paletteOwners.set(actionDef.paletteCommand, actionDef.id);
    });
  }));

  // RULE 6: template existence — any name passed to templates.clone must have <template id="tpl-X">.
  const seenClones = (ctx.contexts.templates as ReturnType<typeof templateContext>)._cloned;
  seenClones.forEach(name => {
    if (!document.getElementById(`tpl-${name}`)) error('template.missing', `templates.clone("${name}") but no <template id="tpl-${name}"> exists`);
  });

  // (event.no-emit rule deferred — request events are often emitted inside handlers, which
  //  the validator can't statically discover. A future enhancement could mark used-emit names
  //  by wrapping emit per call-site, but for now we rely on runtime usage to confirm wiring.)

  // RULE 8: every command has an origin tag so we can unregister/inspect ownership.
  commands.forEach(c => {
    if (!c.origin) warn('command.no-origin', `command "${c.id}" has no origin — won't unregister when its system flag flips`);
  });

  // RULE 9: declared `requires` dependencies must be enabled.
  // A system that is on but whose dep is off will silently misbehave.
  ctx.flags.declared().forEach(name => {
    if (!ctx.flags.isOn(name)) return;
    const missing = ctx.flags.requires(name).filter(dep => !ctx.flags.isOn(dep));
    if (missing.length) {
      warn('requires.unmet', `"${name}" is on but its dependencies are off: ${missing.join(', ')}`);
    }
  });

  return issues;
}
/** Back-compat shim for any caller that still imports validateModel. */
export const validateModel = <Ctx>(_model: ModelDef<Ctx>, _commands: CommandSpec[]) => [] as string[];
