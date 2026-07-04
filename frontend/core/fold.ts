import type { Bus, ItemRef } from '../types';
import type { IoApi } from './io';
import { STORAGE_KEYS } from './io';

/** Fold id for an *item* (node / container / …). Collapse is just fold applied
 *  to an item target — same store, same `.changed` fact, same chevron. Keyed by
 *  graph id so the same node id in two graphs folds independently. */
export const itemFoldId = (ref: ItemRef, graphId: string) => `fold:${graphId}:${ref.kind}:${ref.id}`;

/** True when any ancestor of `ref` is folded — i.e. `ref` is hidden inside a
 *  collapsed container. The one predicate for "is this currently visible": used
 *  by render (skip drawing), jump/Tab (skip navigating to hidden items), and
 *  fit (skip hidden bounds). */
export const foldHidden = (
  ref: ItemRef,
  parentChain: (r: ItemRef) => ItemRef[],
  fold: FoldStore,
  graphId: string,
): boolean => parentChain(ref).some(ancestor => fold.folded(itemFoldId(ancestor, graphId)));

/** Stored fold state by id. Open is the default (`isOpen` returns true unless
 *  set false), so any new id "just works" until the user explicitly folds it.
 *  Persisted via io so reloads remember. The single home for "less ⟷ more
 *  detail" state across every target: panels, the app shell (zen), and items
 *  (collapse) — presentation state, never graph data (Principle 10). */
export type FoldStore = {
  isOpen(id: string, defaultOpen?: boolean): boolean;
  /** Convenience inverse of `isOpen` (default-open) — "is this folded?". */
  folded(id: string): boolean;
  set(id: string, open: boolean): void;
  toggle(id: string, defaultOpen?: boolean): void;
  all(): Record<string, boolean>;
};

declare module './io' {
  // Augmenting the readonly STORAGE_KEYS const isn't possible in TS, so we
  // declare the key at the call site instead. Kept here as a marker that the
  // 'frontend.fold' key lives in the io adapter's keyspace.
}

/** Generic fold/collapse state, shared between UI surfaces (outline sections,
 *  left panel, future inspector pane, …). Lives next to selection / view as a
 *  presentation-layer store — not graph data. */
export function foldContext(bus: Bus, io: IoApi): FoldStore {
  const KEY = 'frontend.fold';
  const state: Record<string, boolean> = io.get<Record<string, boolean>>(KEY, {});
  const isOpen = (id: string, defaultOpen = true) =>
    Object.prototype.hasOwnProperty.call(state, id) ? state[id] : defaultOpen;
  const set = (id: string, open: boolean) => {
    state[id] = open;
    bus.emit('fold.changed', { id, open });
  };
  const toggle = (id: string, defaultOpen = true) => set(id, !isOpen(id, defaultOpen));
  // Item-fold ids embed the graph id (`fold:<graphId>:…`) — drop them when the
  // graph goes, or the persisted map accretes dead keys forever. One synthetic
  // fold.changed lets the io system persist the pruned map.
  bus.on('graph.deleted', ({ id }) => {
    const prefix = `fold:${id}:`;
    const dead = Object.keys(state).filter(key => key.startsWith(prefix));
    if (!dead.length) return;
    dead.forEach(key => { delete state[key]; });
    bus.emit('fold.changed', { id: prefix, open: true });
  });
  return { isOpen, folded: (id) => !isOpen(id, true), set, toggle, all: () => ({ ...state }) };
}
