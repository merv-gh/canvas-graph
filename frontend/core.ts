import type { GraphStore } from './model';
import { affordancesContext } from './core/affordances';
import { cancellationContext } from './core/cancellation';
import { commandsContext, inputRouter } from './core/commands';
import { decorationsContext } from './core/decorations';
import { createFlags, type FlagKind, type FlagsApi } from './core/flags';
import { hierarchyContext } from './core/hierarchy';
import { localStorageIo, type IoApi } from './core/io';
import { keyboardCaptureContext } from './core/keyboard';
import { createModelRegistry } from './core/model-registry';
import { createAppPerf, installGraphPerf, type PerfApi } from './core/perf';
import { propertiesContext } from './core/properties';
import { createSelectionStore, type SelectionStore } from './core/selection';
import { createSim, type SimApi } from './core/sim';
import { storageContext, type StorageApi } from './core/storage';
import { foldContext, type FoldStore } from './core/fold';
import { createFrameLoop, type FrameLoop } from './core/frame-loop';
import { templateContext } from './core/templates';
import { viewContext } from './core/view';
import {
  type AnyEvent,
  type AppEvents,
  type Bus,
  type CommandSpec,
  type CommandSpecInput,
  type EventName,
  type EventOf,
  type FeatureFlags,
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
export { edgeRef, itemKey, refKey, nodeRef, sameItemRef } from './core/item-ref';
export { decorationsContext, type DecorationsApi, type ItemMode, type Overlay } from './core/decorations';
export { hierarchyContext, createNesting, type HierarchyApi, type HierarchyItem, type HierarchySource, type HierarchyParent, type HierarchyNode, type NestApi } from './core/hierarchy';
export { keyboardCaptureContext, type KeyboardCapture } from './core/keyboard';
export { clamp, nodeRect, rectsIntersect, clientPoint, isStageSurface } from './core/view';
export { emptyState, kbdHint } from './core/templates';
export { grouped } from './core/util';
export { factScope } from './core/redraw';
export { createModelRegistry } from './core/model-registry';
export { createPerfApi, type PerfApi, type PerfCallEdge, type PerfCountRow, type PerfInputRow, type PerfSampleRow, type PerfSnapshot, type PerfTimelineRow, type PerfTimingRow } from './core/perf';
export { boundsOf, unionRect, expandRect, rectCenter } from './core/geometry';
export { introspect, type IntrospectKind, type IntrospectNode, type IntrospectEdge, type IntrospectRelation, type IntrospectRef, type IntrospectSnapshot } from './core/introspect';
export { storageContext, type StorageApi, type StorageApply } from './core/storage';
export { foldContext, itemFoldId, foldHidden, type FoldStore } from './core/fold';
export { snapshot, snapshotTree, flattenSnapshotTree, type Snapshot, type SnapshotNode } from './core/snapshot';
export { traceToTest, defaultEventFilter, type Assertion, type TestGenOptions } from './core/test-gen';
export { semanticTitle, mergeSemantics, hasCompleteSemantics, hasFailurePlan, type DataScale, type SemanticFields } from './core/semantics';
export type Contexts = ReturnType<typeof createContexts>;
export type Models = ReturnType<typeof createModelRegistry>;
export type ModelCtx = { graphs: GraphStore };
export type RenderApi = { flushes(): number; lastTrigger(): string; factsPerFrame(): number };
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
  perf: PerfApi;
  frameLoop: FrameLoop;
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
  /** Shorthand: declare a stage tool panel tagged with this system's origin. */
  declarePanel(panel: import('./types').PanelDef): void;
  /** Publish a typed devtools/test surface on window.app without app.ts knowing the system. */
  expose<K extends keyof AppCtx>(key: K, value: AppCtx[K]): void;
};
export type AppSystem = (ctx: SystemCtx) => void | Disposer;
export type RegistryEntryOptions = {
  /** Other system / ability / feature names that must be enabled for this entry to function well.
   *  DX will warn if this entry is enabled but a required dep is off. */
  requires?: string[];
  /** Override the registry's default flag kind for this entry. Used by `withKind`. */
  kind?: FlagKind;
};
export type Registry = ((name: string, setup: AppSystem, opts?: RegistryEntryOptions) => void) & {
  start(ctx: AppCtx): void;
  stop(ctx: AppCtx, name: string): void;
  names(): string[];
  enabledNames(flags: FlagsApi): string[];
  requires(name: string): string[];
  /** Post-register the requires list for an already-declared entry. */
  setRequires(name: string, requires: string[]): void;
  /** Per-entry kind, set at registration via opts.kind or registry default. */
  kindOf(name: string): FlagKind | undefined;
};

declare global { interface Window { app?: AppCtx } }

export const systemOf = (id: string) => id.split('.')[0] || 'app';

export const uiValue = <T,>(value: UiValue<T> | undefined, item: T, fallback = '') =>
  typeof value === 'function' ? value(item) : value ?? fallback;

export type BusOriginIndex = {
  /** Origins that subscribed to `name` at least once and haven't fully torn down. */
  _subscribersOf(name: string): string[];
  /** Origins that emitted `name` at least once this session. */
  _emittersOf(name: string): string[];
  /** Event names this origin still subscribes to. */
  _subscriptionsOf(origin: string): string[];
  /** Event names this origin has emitted at least once. */
  _emissionsOf(origin: string): string[];
  /** Record a subscribe / unsubscribe. Used by registry.start's scopedBus. */
  _trackSubscribe(name: string, origin: string): void;
  _untrackSubscribe(name: string, origin: string): void;
  /** Record an emit. Used by registry.start's scopedBus and SystemCtx.emit/forward. */
  _trackEmit(name: string, origin: string): void;
};
type InstrumentedBus = Bus & BusOriginIndex & { _subscribed: Set<string>; _emitted: Set<string> };
function eventBus(perf?: PerfApi): InstrumentedBus {
  const listeners = new Map<EventName, ((data: unknown, event: AnyEvent) => void)[]>();
  const any: ((event: AnyEvent) => void)[] = [];
  const listenerCounts = new Map<string, number>();
  const subscribed = new Set<string>();
  const emitted = new Set<string>();
  const subscribersOf = new Map<string, Map<string, number>>();
  const subscriptionsOf = new Map<string, Set<string>>();
  const emittersOf = new Map<string, Set<string>>();
  const emissionsOf = new Map<string, Set<string>>();
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
    perf?.count(`Bus.emit.${String(name)}`);
    const fireAny = () => [...any].forEach(fn => fn(event));
    const fireNamed = () => [...(listeners.get(name) || [])].forEach(fn => fn(event.data, event));
    if (perf?.enabled()) {
      perf.measure(`Bus.any.${String(name)}`, fireAny);
      perf.measure(`Bus.listeners.${String(name)}`, fireNamed);
    } else {
      fireAny();
      fireNamed();
    }
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
    _subscribersOf: (name) => [...(subscribersOf.get(name)?.keys() ?? [])],
    _emittersOf: (name) => [...(emittersOf.get(name) ?? [])],
    _subscriptionsOf: (origin) => [...(subscriptionsOf.get(origin) ?? [])],
    _emissionsOf: (origin) => [...(emissionsOf.get(origin) ?? [])],
    _trackSubscribe(name, origin) {
      const counts = subscribersOf.get(name) ?? subscribersOf.set(name, new Map()).get(name)!;
      counts.set(origin, (counts.get(origin) ?? 0) + 1);
      (subscriptionsOf.get(origin) ?? subscriptionsOf.set(origin, new Set()).get(origin)!).add(name);
    },
    _untrackSubscribe(name, origin) {
      const counts = subscribersOf.get(name);
      if (!counts) return;
      const next = (counts.get(origin) ?? 0) - 1;
      if (next > 0) { counts.set(origin, next); return; }
      counts.delete(origin);
      if (!counts.size) subscribersOf.delete(name);
      const set = subscriptionsOf.get(origin);
      set?.delete(name);
      if (set && !set.size) subscriptionsOf.delete(origin);
    },
    _trackEmit(name, origin) {
      (emittersOf.get(name) ?? emittersOf.set(name, new Set()).get(name)!).add(origin);
      (emissionsOf.get(origin) ?? emissionsOf.set(origin, new Set()).get(origin)!).add(name);
    },
  };
}

type OriginScoped = { unregisterOrigin(origin: string): void };

function createContexts(bus: Bus, flags: FlagsApi, io: IoApi, perf: PerfApi, frameLoop: FrameLoop) {
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);
  const properties = propertiesContext();
  const affordances = affordancesContext(bus);
  const cancellation = cancellationContext(bus);
  const decorations = decorationsContext(bus);
  const hierarchy = hierarchyContext();
  const keyboard = keyboardCaptureContext();
  const commands = commandsContext(bus, origin => !origin || flags.isOn(origin), io);
  const input = inputRouter(commands, perf, frameLoop);
  const storage = storageContext(bus);
  const fold = foldContext(bus, io);
  const placeContext = {
    set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
    el: (place: Place) => places.get(place) ?? null,
  };
  let lastDxIssues: DxIssue[] = [];
  let runner: () => DxIssue[] = () => lastDxIssues;
  const dx = {
    issues: () => lastDxIssues,
    run: () => runner(),
    setIssues(issues: DxIssue[]) { lastDxIssues = issues; },
    setRunner(fn: () => DxIssue[]) { runner = fn; },
  };
  const teardown: OriginScoped[] = [commands, affordances, cancellation, decorations, hierarchy, keyboard, storage];
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
    decorations,
    hierarchy,
    keyboard,
    storage,
    fold,
    teardown,
  };
}

/** Registry runs setup functions in insertion order, filtering by feature flag.
 *  Each setup gets `origin: <name>` injected so any commands it registers are tagged.
 *  The `defaultKind` tags every entry's flag unless `opts.kind` overrides it —
 *  lets demo/DX group entries without hardcoded name lists, while still letting
 *  a single registry hold system/ability/feature entries side by side. */
export function registry(defaultKind: FlagKind = 'system'): Registry {
  const entries: { name: string; setup: AppSystem; requires: string[]; kind: FlagKind }[] = [];
  const running = new Map<string, Disposer[]>();
  const register = ((name: string, setup: AppSystem, opts: RegistryEntryOptions = {}) => {
    entries.push({ name, setup, requires: opts.requires ?? [], kind: opts.kind ?? defaultKind });
  }) as Registry;
  const stopEntry = (ctx: AppCtx, name: string) => {
    [...(running.get(name) ?? [])].reverse().forEach(dispose => dispose());
    running.delete(name);
    ctx.contexts.teardown.forEach(c => c.unregisterOrigin(name));
  };
  register.start = (ctx) => {
    entries.forEach(entry => {
      ctx.flags.declare(entry.name, true, entry.requires, entry.kind);
      if (!ctx.flags.isOn(entry.name) || running.has(entry.name)) return;
      const disposers: Disposer[] = [];
      const index = ctx.bus as Partial<BusOriginIndex>;
      const origin = entry.name;
      const trackedOn = <K extends EventName>(name: K, fn: (data: AppEvents[K], event: EventOf<K>) => void) => {
        const wrapped = ((data: AppEvents[K], event: EventOf<K>) => ctx.perf.enabled()
          ? ctx.perf.measure(`Bus.listener.${origin}.${String(name)}`, () => fn(data, event))
          : fn(data, event)) as typeof fn;
        const off = ctx.bus.on(name, wrapped);
        index._trackSubscribe?.(name, origin);
        let alive = true;
        const wrappedOff = () => {
          if (!alive) return;
          alive = false;
          off();
          index._untrackSubscribe?.(name, origin);
        };
        disposers.push(wrappedOff);
        return wrappedOff;
      };
      const trackedEmit = ((name: EventName, ...args: unknown[]) => {
        index._trackEmit?.(name, origin);
        return (ctx.bus.emit as (n: EventName, ...a: unknown[]) => void)(name, ...args);
      }) as Bus['emit'];
      const trackedForward: Bus['forward'] = (name, data) => {
        index._trackEmit?.(name, origin);
        return ctx.bus.forward(name, data);
      };
      const scopedBus: Bus = {
        on: trackedOn,
        onAny(fn) {
          const off = ctx.bus.onAny(fn);
          disposers.push(off);
          return off;
        },
        emit: trackedEmit,
        forward: trackedForward,
      };
      const api: SystemCtx = {
        ...ctx,
        bus: scopedBus,
        on: trackedOn,
        emit: trackedEmit,
        forward: trackedForward,
        origin,
        contribute: (aff) => ctx.contexts.affordances.contribute({ ...aff, origin: aff.origin ?? origin }),
        declarePanel: (panel) => ctx.contexts.affordances.declarePanel({ ...panel, origin: panel.origin ?? origin }),
        expose: <K extends keyof AppCtx>(key: K, value: AppCtx[K]) => { ctx[key] = value; },
      };
      // Adapt register so commands without `origin` get tagged with the current system name.
      const original = ctx.contexts.commands.register;
      const taggedRegister = (specs: CommandSpecInput[]) => original(specs, entry.name);
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
  register.kindOf = (name) => entries.find(e => e.name === name)?.kind;
  return register;
}

/** Wrap a Registry so every call() injects a fixed `kind`. The wrapped object
 *  still delegates start/stop/names/etc. to the base, so multiple wrappers
 *  share one underlying registry — one flat list of entries, three external
 *  call surfaces tagged system / ability / feature. */
export function withKind(base: Registry, kind: FlagKind): Registry {
  const wrapped: Registry = ((name: string, setup: AppSystem, opts: RegistryEntryOptions = {}) =>
    base(name, setup, { ...opts, kind })) as Registry;
  wrapped.start = base.start;
  wrapped.stop = base.stop;
  wrapped.names = base.names;
  wrapped.enabledNames = base.enabledNames;
  wrapped.requires = base.requires;
  wrapped.setRequires = base.setRequires;
  wrapped.kindOf = base.kindOf;
  return wrapped;
}

export function createAppContext(
  graphs: GraphStore,
  model: ModelDef<ModelCtx>,
  initialFlags: FeatureFlags = {},
  io: IoApi = localStorageIo(),
): AppCtx {
  const perf = createAppPerf(initialFlags);
  installGraphPerf(graphs, perf);
  const bus = eventBus(perf);
  const flags = createFlags(bus, initialFlags, io);
  const selection = createSelectionStore(graphs, bus);
  const frameLoop = createFrameLoop();
  return {
    bus, graphs, flags, selection, io, perf,
    frameLoop,
    sim: createSim(bus),
    contexts: createContexts(bus, flags, io, perf, frameLoop),
    model: createModelRegistry(model as ModelDef<ModelCtx>, flags),
  };
}