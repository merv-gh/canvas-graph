import type { AnyEvent, Bus, EventName } from '../types';
import type { PerfApi } from './perf';

/** DX index over the bus: who subscribes to / emits what, by origin. Populated
 *  by the registry's scopedBus wrappers; read by dx and sim probes. */
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
export type InstrumentedBus = Bus & BusOriginIndex & { _subscribed: Set<string>; _emitted: Set<string> };

/** Nested-dispatch ceiling. Legit chains (request → fact → feature → …) sit in
 *  single digits; hitting this means an event cycle — fail loud, with the name. */
const MAX_EMIT_DEPTH = 256;

export function eventBus(perf?: PerfApi): InstrumentedBus {
  // Copy-on-write listener lists: on/off REPLACE the array instead of splicing,
  // so dispatch iterates its snapshot without a per-emit clone, and a handler
  // that (un)subscribes mid-dispatch can't corrupt the iteration.
  const listeners = new Map<EventName, readonly ((data: unknown, event: AnyEvent) => void)[]>();
  let any: readonly ((event: AnyEvent) => void)[] = [];
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
  let depth = 0;
  const dispatch = (name: EventName, data: unknown) => {
    emitted.add(name);
    if (++depth > MAX_EMIT_DEPTH) {
      depth--;
      throw new Error(`[bus] emit depth exceeded ${MAX_EMIT_DEPTH} at "${String(name)}" — event cycle (a handler re-emitting what triggered it?)`);
    }
    try {
      const event = { name, data, at: performance.now() } as AnyEvent;
      const anySnapshot = any;
      const namedSnapshot = listeners.get(name);
      const fireAny = () => { for (const fn of anySnapshot) fn(event); };
      const fireNamed = () => { if (namedSnapshot) for (const fn of namedSnapshot) fn(event.data, event); };
      if (perf?.enabled()) {
        perf.count(`Bus.emit.${String(name)}`);
        perf.measure(`Bus.any.${String(name)}`, fireAny);
        perf.measure(`Bus.listeners.${String(name)}`, fireNamed);
      } else {
        fireAny();
        fireNamed();
      }
    } finally { depth--; }
  };
  return {
    on(name, fn) {
      let active = true;
      // Unique wrapper per subscription, so subscribing the same fn twice stays
      // two independent registrations under copy-on-write removal.
      const wrapped = ((data: unknown, event: AnyEvent) => (fn as (d: unknown, e: AnyEvent) => void)(data, event));
      addSubscribed(name);
      listeners.set(name, [...(listeners.get(name) ?? []), wrapped]);
      return () => {
        if (!active) return;
        active = false;
        const next = (listeners.get(name) ?? []).filter(entry => entry !== wrapped);
        if (next.length) listeners.set(name, next); else listeners.delete(name);
        removeSubscribed(name);
      };
    },
    onAny(fn) {
      let active = true;
      any = [...any, fn];
      return () => {
        if (!active) return;
        active = false;
        any = any.filter(entry => entry !== fn);
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
