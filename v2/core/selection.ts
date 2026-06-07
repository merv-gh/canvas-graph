import type { GraphStore } from '../model';
import type { Bus, Id, ItemRef, NodeEntity } from '../types';
import { edgeRef, nodeRef, sameItemRef } from './item-ref';

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

export function createSelectionStore(graphs: GraphStore, bus: Bus): SelectionStore {
  const sel = new Map<Id, ItemRef | null>();
  const foc = new Map<Id, ItemRef | null>();
  const gid = (override?: Id) => override ?? graphs.current.id;
  const clearSelection = (graphId: Id) => {
    sel.set(graphId, null);
    bus.emit('selection.item.selected', null);
    bus.emit('selection.node.selected', { id: null });
  };
  const clearFocus = (graphId: Id) => {
    foc.set(graphId, null);
    bus.emit('focus.item.focused', null);
    bus.emit('focus.node.focused', { id: null });
  };
  const clearDeleted = (graphId: Id, target: ItemRef) => {
    if (sameItemRef(sel.get(graphId) ?? null, target)) clearSelection(graphId);
    if (sameItemRef(foc.get(graphId) ?? null, target)) clearFocus(graphId);
  };
  bus.on('graph.node.deleted', ({ graphId, id }) => {
    clearDeleted(graphId, nodeRef(id));
  });
  bus.on('graph.edge.deleted', ({ graphId, id }) => clearDeleted(graphId, edgeRef(id)));
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
