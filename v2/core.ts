import type { GraphStore } from './model';
import { affordancesContext } from './core/affordances';
import { commandsContext, inputRouter } from './core/commands';
import { itemIdFrom, itemRefFrom, appendRenderable } from './core/dom';
import { createFlags, type FlagKind, type FlagsApi } from './core/flags';
import { localStorageIo, type IoApi } from './core/io';
import { propertiesContext } from './core/properties';
import { createSelectionStore, type SelectionStore } from './core/selection';
import { createSim, type SimApi } from './core/sim';
import { templateContext } from './core/templates';
import { clamp, nodeRect, viewContext, clientPoint, isStageSurface } from './core/view';
import {
  FACT_SUFFIXES,
  type ActionDef,
  type AffordanceDef,
  type AnyEvent,
  type Bus,
  type CollectionDef,
  type CommandSpec,
  type EntityDef,
  type EventName,
  type ItemRef,
  type ModelDef,
  type Place,
  type RedrawScope,
  type UiValue,
  type DxIssue,
} from './types';

// Re-exports (keep the public surface stable for systems/abilities).
export { localStorageIo, memoryIo, STORAGE_KEYS, type IoApi } from './core/io';
export { createFlags, type FlagKind, type FlagsApi } from './core/flags';
export { createSelectionStore, type SelectionStore } from './core/selection';
export { createSim, type SimApi, type Trace, type TraceEvent } from './core/sim';
export { parseShortcut, shortcutOf } from './core/shortcuts';
export { itemIdFrom, itemRefFrom, appendRenderable } from './core/dom';
export { clamp, nodeRect, clientPoint, isStageSurface } from './core/view';

export type Contexts = ReturnType<typeof createContexts>;
export type Models = ReturnType<typeof createModelRegistry>;
export type ModelCtx = { graphs: GraphStore };
/** Narrow slice of AppCtx that collection.commands() factories receive. Keeps the
 *  collection author from depending on the full ctx — only stable hooks. */
export type CollectionCommandsApi = {
  graphs: GraphStore;
  selection: SelectionStore;
  view: Contexts['view'];
  contexts: Contexts;
};
export type RenderApi = { flushes(): number };
export type DxApi = { run(): DxIssue[] };
export type AppCtx = {
  bus: Bus;
  graphs: GraphStore;
  contexts: Contexts;
  model: Models;
  flags: FlagsApi;
  selection: SelectionStore;
  io: IoApi;
  sim: SimApi;
  dx?: DxApi;
  render?: RenderApi;
};
export type AppCollectionDef<T> = CollectionDef<T, ModelCtx, CollectionCommandsApi>;
type Disposer = () => void;
export type SystemCtx = AppCtx & Pick<Bus, 'on' | 'emit' | 'forward'> & {
  /** Stable name of the currently-starting system / ability — used to tag commands for unregister. */
  origin: string;
  /** Shorthand: contribute an affordance tagged with this system's origin. */
  contribute(aff: import('./types').SystemAffordance): void;
  /** Publish a typed devtools/test surface on window.v2 without app.ts knowing the system. */
  expose<K extends keyof AppCtx>(key: K, value: AppCtx[K]): void;
};
export type AppSystem = (ctx: SystemCtx) => void | Disposer;
export type RegistryEntryOptions = {
  /** Other system / ability / feature names that must be enabled for this entry to function well.
   *  DX will warn if this entry is enabled but a required dep is off. */
  requires?: string[];
};
export type Registry = ((name: string, setup: AppSystem, opts?: RegistryEntryOptions) => void) & {
  start(ctx: AppCtx): void;
  stop(ctx: AppCtx, name: string): void;
  names(): string[];
  enabledNames(flags: FlagsApi): string[];
  requires(name: string): string[];
  /** Post-register the requires list for an already-declared entry. */
  setRequires(name: string, requires: string[]): void;
};

declare global { interface Window { v2?: AppCtx } }

export const systemOf = (id: string) => id.split('.')[0] || 'app';

/** Classify an event name by suffix.
 *  - '.changed'  → 'nodes'  (camera/view repaint only, no entity churn)
 *  - any other fact suffix → 'both' (data changed; lists + canvas both need refresh)
 *  - non-fact     → null    (request events, render.*, app.start etc.) */
export const factScope = (name: string): RedrawScope | null => {
  for (const suffix of FACT_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    return suffix === '.changed' ? 'nodes' : 'both';
  }
  return null;
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
  return c ? shortcutOfImported(c) : null;
};
// Local alias to avoid pulling shortcuts.ts into the public re-export path twice.
import { shortcutOf as shortcutOfImported } from './core/shortcuts';

export const uiValue = <T,>(value: UiValue<T> | undefined, item: T, fallback = '') =>
  typeof value === 'function' ? value(item) : value ?? fallback;

export const entityUi = <T,>(entityDef: EntityDef<T>, slot?: string) =>
  entityDef.abilities.flatMap(abilityDef => abilityDef.actions.flatMap(actionDef =>
    actionDef.ui
      .filter(ui => ui.surface === 'entity' && (slot == null || ui.slot === slot))
      .map(ui => ({ action: actionDef as ActionDef<T>, ui: ui as AffordanceDef<T> })),
  ));

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

type InstrumentedBus = Bus & { _subscribed: Set<string>; _emitted: Set<string> };
function eventBus(): InstrumentedBus {
  const listeners = new Map<EventName, ((data: unknown, event: AnyEvent) => void)[]>();
  const any: ((event: AnyEvent) => void)[] = [];
  const listenerCounts = new Map<string, number>();
  const subscribed = new Set<string>();
  const emitted = new Set<string>();
  const addSubscribed = (name: string) => {
    listenerCounts.set(name, (listenerCounts.get(name) ?? 0) + 1);
    subscribed.add(name);
  };
  const removeSubscribed = (name: string) => {
    const next = (listenerCounts.get(name) ?? 0) - 1;
    if (next > 0) listenerCounts.set(name, next);
    else { listenerCounts.delete(name); subscribed.delete(name); }
  };
  const remove = <T,>(list: T[], item: T) => {
    const index = list.indexOf(item);
    if (index >= 0) list.splice(index, 1);
  };
  const dispatch = (name: EventName, data: unknown) => {
    emitted.add(name);
    const event = { name, data, at: performance.now() } as AnyEvent;
    [...any].forEach(fn => fn(event));
    [...(listeners.get(name) || [])].forEach(fn => fn(event.data, event));
  };
  return {
    on(name, fn) {
      let active = true;
      const wrapped = fn as (data: unknown, event: AnyEvent) => void;
      addSubscribed(name);
      (listeners.get(name) || listeners.set(name, []).get(name)!).push(wrapped);
      return () => {
        if (!active) return;
        active = false;
        remove(listeners.get(name) ?? [], wrapped);
        removeSubscribed(name);
      };
    },
    onAny(fn) {
      let active = true;
      any.push(fn);
      return () => {
        if (!active) return;
        active = false;
        remove(any, fn);
      };
    },
    emit(name, ...args) { dispatch(name, args[0]); },
    forward(name, data) { dispatch(name, data); },
    _subscribed: subscribed,
    _emitted: emitted,
  };
}

function createContexts(bus: Bus, flags: FlagsApi, io: IoApi) {
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);
  const properties = propertiesContext();
  const affordances = affordancesContext(bus);
  const commands = commandsContext(bus, origin => !origin || flags.isOn(origin), io);
  const input = inputRouter(commands);
  const placeContext = {
    set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
    el: (place: Place) => places.get(place) ?? null,
  };
  // DX inspection surface — `dx` system writes here at boot for tests/devtools to read.
  let lastDxIssues: DxIssue[] = [];
  const dx = {
    issues: () => lastDxIssues,
    _set(issues: DxIssue[]) { lastDxIssues = issues; },
  };
  return { commands, input, places: placeContext, templates, view, properties, dx, affordances };
}

/** Registry runs setup functions in insertion order, filtering by feature flag.
 *  Each setup gets `origin: <name>` injected so any commands it registers are tagged.
 *  The `kind` tags every flag the registry declares — lets demo/DX group entries
 *  without hardcoded name lists. */
export function registry(kind: FlagKind = 'system'): Registry {
  const entries: { name: string; setup: AppSystem; requires: string[] }[] = [];
  const running = new Map<string, Disposer[]>();
  const register = ((name: string, setup: AppSystem, opts: RegistryEntryOptions = {}) => {
    entries.push({ name, setup, requires: opts.requires ?? [] });
  }) as Registry;
  const stopEntry = (ctx: AppCtx, name: string) => {
    [...(running.get(name) ?? [])].reverse().forEach(dispose => dispose());
    running.delete(name);
    ctx.contexts.commands.unregisterOrigin(name);
    ctx.contexts.affordances.unregisterOrigin(name);
  };
  register.start = (ctx) => {
    entries.forEach(entry => {
      ctx.flags.declare(entry.name, true, entry.requires, kind);
      if (!ctx.flags.isOn(entry.name) || running.has(entry.name)) return;
      const disposers: Disposer[] = [];
      const scopedBus: Bus = {
        on(name, fn) {
          const off = ctx.bus.on(name, fn);
          disposers.push(off);
          return off;
        },
        onAny(fn) {
          const off = ctx.bus.onAny(fn);
          disposers.push(off);
          return off;
        },
        emit: ctx.bus.emit,
        forward: ctx.bus.forward,
      };
      const api: SystemCtx = {
        ...ctx,
        bus: scopedBus,
        on: scopedBus.on,
        emit: ctx.bus.emit,
        forward: ctx.bus.forward,
        origin: entry.name,
        contribute: (aff) => ctx.contexts.affordances.contribute({ ...aff, origin: aff.origin ?? entry.name }),
        expose: (key, value) => { (ctx as Record<string, unknown>)[key as string] = value; },
      };
      // Adapt register so commands without `origin` get tagged with the current system name.
      const original = ctx.contexts.commands.register;
      const taggedRegister = (specs: CommandSpec[]) => original(specs, entry.name);
      const restore = ctx.contexts.commands.register;
      ctx.contexts.commands.register = taggedRegister as typeof original;
      try {
        const dispose = entry.setup(api);
        if (dispose) disposers.push(dispose);
        running.set(entry.name, disposers);
      } finally { ctx.contexts.commands.register = restore; }
    });
  };
  register.stop = stopEntry;
  register.names = () => entries.map(entry => entry.name);
  register.enabledNames = (flags) => entries.map(e => e.name).filter(name => flags.isOn(name));
  register.requires = (name) => entries.find(e => e.name === name)?.requires ?? [];
  register.setRequires = (name, requires) => {
    const e = entries.find(e => e.name === name);
    if (e) e.requires = requires;
  };
  return register;
}

export function createAppContext(
  graphs: GraphStore,
  model: ModelDef<ModelCtx, CollectionCommandsApi>,
  flags: FlagsApi = createFlags(),
  io: IoApi = localStorageIo(),
): AppCtx {
  const bus = eventBus();
  const selection = createSelectionStore(graphs, bus);
  return {
    bus, graphs, flags, selection, io,
    sim: createSim(bus),
    contexts: createContexts(bus, flags, io),
    model: createModelRegistry(model as ModelDef<ModelCtx>, flags),
  };
}
