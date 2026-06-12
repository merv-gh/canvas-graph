import type { GraphStore, NodeEntity } from '../model';
import type { Bus, Id, ItemRef } from '../types';
import { edgeRef, nodeRef, sameItemRef } from './item-ref';

/** Selection is a *set* (choosing is a higher concept than single-select — a
 *  single selection is just a set of one). The set is ordered; the last member
 *  is the **primary** (`selected()`), which every single-item consumer reads, so
 *  the multi-set is backward-compatible. `selectedNode`/`focusedNode` are typed
 *  projections of the primary. Focus stays single (the anchor you act from).
 *
 *  The store is the single emitter of `selection.changed` — every mutation
 *  commits one fact carrying the whole set, and `selectable` reacts to it
 *  (decorations + focus). Lives outside Graph (presentation state), keyed by
 *  graph id, so the same graph can be shown twice with different choices. */
export type SelectionStore = {
  /** Primary = last chosen. Null when the set is empty. */
  selected(graphId?: Id): ItemRef | null;
  /** The whole chosen set, in insertion order (primary last). */
  selectedAll(graphId?: Id): ItemRef[];
  has(ref: ItemRef, graphId?: Id): boolean;
  focused(graphId?: Id): ItemRef | null;
  selectedNode(graphId?: Id): NodeEntity | undefined;
  focusedNode(graphId?: Id): NodeEntity | undefined;
  /** Replace the set with `[ref]`, or clear when null (back-compat single-select). */
  select(ref: ItemRef | null, graphId?: Id): void;
  /** Replace the set wholesale. */
  choose(refs: ItemRef[], graphId?: Id): void;
  add(ref: ItemRef, graphId?: Id): void;
  remove(ref: ItemRef, graphId?: Id): void;
  toggle(ref: ItemRef, graphId?: Id): void;
  focus(ref: ItemRef | null, graphId?: Id): void;
};

export function createSelectionStore(graphs: GraphStore, bus: Bus): SelectionStore {
  const sel = new Map<Id, ItemRef[]>();
  const foc = new Map<Id, ItemRef | null>();
  const gid = (override?: Id) => override ?? graphs.current.id;
  const setOf = (graphId: Id) => sel.get(graphId) ?? [];

  /** Single fact for any set change: carries the whole set. `selectable` turns
   *  it into decorations + focus; single-item consumers read the primary. */
  const commit = (graphId: Id) => {
    const arr = setOf(graphId);
    const primary = arr[arr.length - 1] ?? null;
    bus.emit('selection.item.selected', primary);
    bus.emit('selection.node.selected', { id: primary?.kind === 'node' ? primary.id : null });
    bus.emit('selection.changed', { refs: arr });
  };
  const write = (graphId: Id, refs: ItemRef[]) => { sel.set(graphId, refs); commit(graphId); };

  const clearFocus = (graphId: Id) => {
    foc.set(graphId, null);
    bus.emit('focus.item.focused', null);
    bus.emit('focus.node.focused', { id: null });
  };
  const clearDeleted = (graphId: Id, target: ItemRef) => {
    const arr = setOf(graphId);
    const next = arr.filter(ref => !sameItemRef(ref, target));
    if (next.length !== arr.length) write(graphId, next);
    if (sameItemRef(foc.get(graphId) ?? null, target)) clearFocus(graphId);
  };
  bus.on('graph.node.deleted', ({ graphId, id }) => clearDeleted(graphId, nodeRef(id)));
  bus.on('graph.edge.deleted', ({ graphId, id }) => clearDeleted(graphId, edgeRef(id)));

  const node = (ref: ItemRef | null, graphId?: Id) => {
    if (!ref || ref.kind !== 'node') return undefined;
    return graphs.get(gid(graphId))?.node(ref.id);
  };
  return {
    selected: (graphId) => { const a = setOf(gid(graphId)); return a[a.length - 1] ?? null; },
    selectedAll: (graphId) => [...setOf(gid(graphId))],
    has: (ref, graphId) => setOf(gid(graphId)).some(r => sameItemRef(r, ref)),
    focused: (graphId) => foc.get(gid(graphId)) ?? null,
    selectedNode: (graphId) => { const a = setOf(gid(graphId)); return node(a[a.length - 1] ?? null, graphId); },
    focusedNode: (graphId) => node(foc.get(gid(graphId)) ?? null, graphId),
    select(ref, graphId) { write(gid(graphId), ref ? [ref] : []); },
    choose(refs, graphId) {
      // Dedupe by ref identity, preserving order (last occurrence = primary).
      const seen = new Set<string>();
      const unique: ItemRef[] = [];
      for (const ref of refs) {
        const key = `${ref.kind}:${ref.id}:${(ref.parent ?? []).join('/')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(ref);
      }
      write(gid(graphId), unique);
    },
    add(ref, graphId) {
      const g = gid(graphId);
      if (setOf(g).some(r => sameItemRef(r, ref))) { write(g, [...setOf(g).filter(r => !sameItemRef(r, ref)), ref]); return; }
      write(g, [...setOf(g), ref]);
    },
    remove(ref, graphId) {
      const g = gid(graphId);
      write(g, setOf(g).filter(r => !sameItemRef(r, ref)));
    },
    toggle(ref, graphId) {
      const g = gid(graphId);
      const has = setOf(g).some(r => sameItemRef(r, ref));
      write(g, has ? setOf(g).filter(r => !sameItemRef(r, ref)) : [...setOf(g), ref]);
    },
    focus(ref, graphId) { foc.set(gid(graphId), ref); },
  };
}
