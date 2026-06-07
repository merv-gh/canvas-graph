import type { GraphStore } from '../model';
import type { Bus, Id, ItemRef, NodeEntity } from '../types';

/** Selection and focus are polymorphic: a graph can have a selected node, edge, or
 *  any future ItemKind. selectedNode/focusedNode are typed projections — they only
 *  return when the current ref's kind matches.
 *
 *  Lives outside Graph so a graph can be displayed without one, and so multiple
 *  stores (e.g. per-view) can coexist. Keyed by graph id. */
export type SelectionStore = {
  selected(graphId?: Id): ItemRef | null;
  focused(graphId?: Id): ItemRef | null;
  selectedNode(graphId?: Id): NodeEntity | undefined;
  focusedNode(graphId?: Id): NodeEntity | undefined;
  select(ref: ItemRef | null, graphId?: Id): void;
  focus(ref: ItemRef | null, graphId?: Id): void;
};

const nodeRef = (id: Id): ItemRef => ({ kind: 'node', id });
const sameParent = (a?: Id[], b?: Id[]) => {
  const aa = a ?? [];
  const bb = b ?? [];
  return aa.length === bb.length && aa.every((id, i) => id === bb[i]);
};
const sameRef = (a: ItemRef | null, b: ItemRef | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id && sameParent(a.parent, b.parent));

export function createSelectionStore(graphs: GraphStore, bus: Bus): SelectionStore {
  const sel = new Map<Id, ItemRef | null>();
  const foc = new Map<Id, ItemRef | null>();
  const gid = (override?: Id) => override ?? graphs.current.id;
  bus.on('graph.node.deleted', ({ graphId, id }) => {
    const target = nodeRef(id);
    if (sameRef(sel.get(graphId) ?? null, target)) { sel.set(graphId, null); bus.emit('selection.node.selected', { id: null }); }
    if (sameRef(foc.get(graphId) ?? null, target)) { foc.set(graphId, null); bus.emit('focus.node.focused', { id: null }); }
  });
  bus.on('graph.edge.deleted', ({ graphId, id }) => {
    const target: ItemRef = { kind: 'edge', id };
    if (sameRef(sel.get(graphId) ?? null, target)) sel.set(graphId, null);
    if (sameRef(foc.get(graphId) ?? null, target)) foc.set(graphId, null);
  });
  const node = (ref: ItemRef | null, graphId?: Id) => {
    if (!ref || ref.kind !== 'node') return undefined;
    return graphs.get(gid(graphId))?.node(ref.id);
  };
  return {
    selected: (graphId) => sel.get(gid(graphId)) ?? null,
    focused: (graphId) => foc.get(gid(graphId)) ?? null,
    selectedNode: (graphId) => node(sel.get(gid(graphId)) ?? null, graphId),
    focusedNode: (graphId) => node(foc.get(gid(graphId)) ?? null, graphId),
    select(ref, graphId) { sel.set(gid(graphId), ref); },
    focus(ref, graphId) { foc.set(gid(graphId), ref); },
  };
}
