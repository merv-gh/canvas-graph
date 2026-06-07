import type { GraphNode } from '../model';
import type { Registry } from '../core';
import { Places } from '../types';

export function registerGraph(system: Registry) {
  system('graph', ({ on, emit, graphs, contexts, selection }) => {
    on('graph.create', () => {
      const graph = graphs.create();
      graphs.switch(graph.id);
      emit('graph.created', { id: graph.id });
      emit('graph.switched', { id: graph.id });
    });
    on('graph.switch', ({ id }) => {
      const graph = graphs.switch(id);
      emit('graph.switched', { id: graph.id });
    });
    on('graph.node.create', draft => {
      const { relativeTo, keepFocus, connectFrom, ...store } = draft as typeof draft & { relativeTo?: string; keepFocus?: boolean; connectFrom?: string };
      const anchorNode = relativeTo ? graphs.current.getNode(relativeTo) : (selection.selectedNode() as GraphNode | undefined);
      const node = graphs.current.createNode(store, {
        at: contexts.view.spaceCenter(Places.Stage),
        nearPosition: anchorNode?.Position,
      });
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id, hints: { keepFocus, connectFrom, relativeTo } });
    });
    on('graph.node.update', ({ id, patch }) => {
      if (graphs.current.updateNode(id, patch)) emit('graph.node.updated', { graphId: graphs.current.id, id });
    });
    on('graph.node.delete', ({ id }) => {
      const incident = graphs.current.edgesOf(id).map(e => e.id);
      if (graphs.current.deleteNode(id)) {
        incident.forEach(eid => emit('graph.edge.deleted', { graphId: graphs.current.id, id: eid }));
        emit('graph.node.deleted', { graphId: graphs.current.id, id });
      }
    });
    on('graph.edge.create', draft => {
      if (!draft.From || !draft.To || draft.From === draft.To) return;
      if (!graphs.current.getNode(draft.From) || !graphs.current.getNode(draft.To)) return;
      const edge = graphs.current.createEdge(draft);
      emit('graph.edge.created', { graphId: graphs.current.id, id: edge.id, edge });
    });
    on('graph.edge.update', ({ id, patch }) => {
      if (graphs.current.updateEdge(id, patch)) emit('graph.edge.updated', { graphId: graphs.current.id, id });
    });
    on('graph.edge.delete', ({ id }) => {
      if (graphs.current.deleteEdge(id)) emit('graph.edge.deleted', { graphId: graphs.current.id, id });
    });
    on('graph.delete', ({ id }) => {
      const next = graphs.delete(id);
      emit('graph.deleted', { id, nextId: next.id });
      emit('graph.switched', { id: next.id });
    });
  });
}
