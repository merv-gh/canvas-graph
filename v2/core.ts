import type { GraphStore } from './model';
import { affordancesContext } from './core/affordances';
import { cancellationContext } from './core/cancellation';
import { commandsContext, inputRouter } from './core/commands';
import { createFlags, type FlagKind, type FlagsApi } from './core/flags';
import { hierarchyContext } from './core/hierarchy';
import { localStorageIo, type IoApi } from './core/io';
import { itemModesContext } from './core/item-modes';
import { itemOverlaysContext } from './core/item-overlays';
import { itemTargetsContext } from './core/item-targets';
import { keyboardCaptureContext } from './core/keyboard';
import { createModelRegistry } from './core/model-registry';
import { propertiesContext } from './core/properties';
import { createSelectionStore, type SelectionStore } from './core/selection';
import { createSim, type SimApi } from './core/sim';
import { templateContext } from './core/templates';
import { viewContext } from './core/view';
import {
  type AnyEvent,
  type Bus,
  type CommandSpec,
  type EventName,
  type ModelDef,
  type Place,
  type ResolvedCollectionDef,
  type UiValue,
  type DxIssue,
} from './types';

// Re-exports (keep the public surface stable for systems/abilities).
export { localStorageIo, memoryIo, STORAGE_KEYS, type IoApi } from './core/io';
export { collectionCreateCommand, collectionDeleteCommand, collectionKind, collectionSelectCommand, singular } from './core/collection-commands';
export { createFlags, type FlagKind, type FlagsApi } from './core/flags';
export { createSelectionStore, type SelectionStore } from './core/selection';
export { createSim, type SimApi, type Trace, type TraceEvent } from './core/sim';
export { parseShortcut, shortcutOf, commandShortcut } from './core/shortcuts';
export { itemIdFrom, itemRefFrom, appendRenderable, itemParentAttr, itemParentFromAttr, tagItem } from './core/dom';
export { edgeRef, itemKey, nodeRef, sameItemRef } from './core/item-ref';
export { itemModesContext, type ItemMode } from './core/item-modes';
export { itemOverlaysContext, type ItemOverlay } from './core/item-overlays';
export { itemTargetsContext, type ItemTarget, type ItemTargetProvider } from './core/item-targets';
export { hierarchyContext, type HierarchyProvider } from './core/hierarchy';
export { keyboardCaptureContext, type KeyboardCapture } from './core/keyboard';
export { clamp, nodeRect, clientPoint, isStageSurface } from './core/view';
export { emptyState, kbdHint } from './core/templates';
export { grouped } from './core/util';
export { factScope } from './core/redraw';
export { createModelRegistry } from './core/model-registry';
export { boundsOf, unionRect, expandRect, rectCenter } from './core/geometry';
export { createNesting, type NestApi } from './core/nesting';

export type Contexts = ReturnType<typeof createContexts>;
export type Models = ReturnType<typeof createModelRegistry>;
export type ModelCtx = { graphs: GraphStore };
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
} & import('./types').CustomExposable;
export type AppCollectionDef<T> = ResolvedCollectionDef<T, ModelCtx>;
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

export const uiValue = <T,>(value: UiValue<T> | undefined, item: T, fallback = '') =>
  typeof value === 'function' ? value(item) : value ?? fallback;

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

/** Contexts that own per-origin state must drop it when a system is disabled.
 *  Implementations live next to the context; registry teardown walks them generically. */
type OriginScoped = { unregisterOrigin(origin: string): void };

function createContexts(bus: Bus, flags: FlagsApi, io: IoApi) {
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);
  const properties = propertiesContext();
  const affordances = affordancesContext(bus);
  const cancellation = cancellationContext(bus);
  const itemModes = itemModesContext(bus);
  const itemOverlays = itemOverlaysContext(bus);
  const itemTargets = itemTargetsContext();
  const hierarchy = hierarchyContext();
  const keyboard = keyboardCaptureContext();
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
  const teardown: OriginScoped[] = [commands, affordances, cancellation, itemModes, itemOverlays, itemTargets, hierarchy, keyboard];
  return {
    commands,
    input,
    places: placeContext,
    templates,
    view,
    properties,
    dx,
    affordances,
    cancellation,
    itemModes,
    itemOverlays,
    itemTargets,
    hierarchy,
    keyboard,
    teardown,
  };
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
    ctx.contexts.teardown.forEach(c => c.unregisterOrigin(name));
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
        expose: <K extends keyof AppCtx>(key: K, value: AppCtx[K]) => { ctx[key] = value; },
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
  model: ModelDef<ModelCtx>,
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
