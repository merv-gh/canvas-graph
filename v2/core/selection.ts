import type { GraphStore } from '../model';
import type { Bus, Id, NodeEntity } from '../types';

export type SelectionStore = {
  selected(graphId?: Id): Id | null;
  focused(graphId?: Id): Id | null;
  selectedNode(graphId?: Id): NodeEntity | undefined;
  select(id: Id | null, graphId?: Id): void;
  focus(id: Id | null, graphId?: Id): void;
};

/** Selection and focus live outside Graph so a graph can be displayed without one,
 *  and so multiple stores (e.g. per-view) can coexist. Keyed by graph id. */
export function createSelectionStore(graphs: GraphStore, bus: Bus): SelectionStore {
  const sel = new Map<Id, Id | null>();
  const foc = new Map<Id, Id | null>();
  const gid = (override?: Id) => override ?? graphs.current.id;
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
