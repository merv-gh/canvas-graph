import {
  type CreateHints,
  type EdgeDraft,
  type EdgeEntity,
  type EdgePatch,
  type GraphNode,
  type GraphStore,
  type NodeDraft,
  type NodePatch,
} from '../model';
import { edgeRef, itemIdFrom, nodeRef, type Registry } from '../core';
import { Places } from '../types';
import type { Id } from '../types';

/** graph — the *behavior* of the built-in domain. The node / edge / graph
 *  entity declarations live in `model/entities.ts`; this system owns their
 *  commands, lifecycle handlers, storage (item.update → graph mutation), and
 *  the hierarchy source that makes nodes + edges navigable/jumpable. */

declare module '../types' {
  interface CustomEvents {
    'graph.exported': { json: string };
    'graph.export.json': void;
    'graph.edge.reverse': { id: Id };
    'graph.create': void;
    'graph.created': { id: Id };
    'graph.delete': { id: Id };
    'graph.deleted': { id: Id; nextId: Id };
    'graph.switch': { id: Id };
    'graph.switched': { id: Id };
    'graph.node.create': NodeDraft & CreateHints;
    'graph.node.created': { graphId: Id; id: Id; hints?: CreateHints };
    'graph.node.update': { id: Id; patch: NodePatch };
    'graph.node.updated': { graphId: Id; id: Id };
    'graph.node.delete': { id: Id };
    'graph.node.deleted': { graphId: Id; id: Id };
    'graph.edge.create': EdgeDraft;
    'graph.edge.created': { graphId: Id; id: Id; edge: EdgeEntity };
    'graph.edge.update': { id: Id; patch: EdgePatch };
    'graph.edge.updated': { graphId: Id; id: Id };
    'graph.edge.delete': { id: Id };
    'graph.edge.deleted': { graphId: Id; id: Id };
  }
}

const nextGraphId = (graphs: GraphStore) =>
  graphs.all().find(g => g.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

export function registerGraph(system: Registry) {
  system('graph', ({ on, emit, graphs, contexts, selection, origin }) => {
    contexts.storage.register('node', origin, (ref, patch) => {
      if (graphs.current.updateNode(ref.id, patch as NodePatch)) {
        emit('graph.node.updated', { graphId: graphs.current.id, id: ref.id });
      }
    });
    contexts.storage.register('edge', origin, (ref, patch) => {
      if (graphs.current.updateEdge(ref.id, patch as EdgePatch)) {
        emit('graph.edge.updated', { graphId: graphs.current.id, id: ref.id });
      }
    });
    const selectedEdgeId = () => {
      const ref = selection.selected();
      return ref?.kind === 'edge' ? ref.id : '';
    };

    contexts.commands.register([
      { id: 'graph.export.json', label: 'Export graph JSON', group: 'graph' },
      { id: 'graph.edge.reverse', label: 'Reverse edge', group: 'edge', shortcut: 'Shift+E', available: () => !!selectedEdgeId(), payload: () => ({ id: selectedEdgeId() }) },
      {
        id: 'graph.create',
        label: 'Create graph',
        group: 'graph',
        shortcut: 'N',
        input: { on: 'keydown', key: 'n', prevent: true },
      },
      {
        id: 'graph.switch.next',
        label: 'Switch graph',
        event: 'graph.switch',
        group: 'graph',
        shortcut: 'Alt+G',
        input: { on: 'keydown', key: 'g', alt: true, prevent: true },
        payload: () => ({ id: nextGraphId(graphs) }),
      },
      {
        id: 'graph.switch',
        label: 'Switch graph',
        group: 'graph',
        hidden: true,
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
      },
      {
        id: 'graph.delete',
        label: 'Delete graph',
        group: 'graph',
        available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
      },
      {
        id: 'graph.node.delete',
        label: 'Delete node',
        group: 'graph',
        available: source => !!itemIdFrom(source?.target) || !!selection.selectedNode(),
        payload: source => ({ id: itemIdFrom(source.target) || selection.selectedNode()?.id || '' }),
      },
      {
        id: 'graph.edge.delete',
        label: 'Delete edge',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target) || !!selectedEdgeId(),
        payload: source => ({ id: itemIdFrom(source.target) || selectedEdgeId() }),
      },
    ]);

    on('graph.export.json', () => {
      const json = JSON.stringify({
        nodes: graphs.current.nodes().map(({ id, Label, Position, Size }) => ({ id, Label, Position, Size })),
        edges: graphs.current.edges().map(({ id, From, To, Label }) => ({ id, From, To, Label })),
      });
      const clipboard = globalThis.navigator?.clipboard;
      void clipboard?.writeText?.(json)?.catch?.(() => {});
      emit('graph.exported', { json });
    });

    on('graph.edge.reverse', ({ id }) => {
      const edge = graphs.current.getEdge(id);
      if (!edge) return;
      if (graphs.current.updateEdge(id, { From: edge.To, To: edge.From })) {
        emit('graph.edge.updated', { graphId: graphs.current.id, id });
      }
    });

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

    // Nodes + edges are the navigable items of a graph — register them as a
    // hierarchy source so jump / picker / fit / outline can address them.
    const offTargets = contexts.hierarchy.sources.register(origin, () => {
      const nodes = graphs.current.nodes().map(node => ({
        ref: nodeRef(node.id),
        label: node.Label.text || node.id,
        anchor: node.Position ?? { x: 0, y: 0 },
      }));
      const edges = graphs.current.edges().flatMap(edge => {
        const from = graphs.current.getNode(edge.From);
        const to = graphs.current.getNode(edge.To);
        if (!from?.Position || !to?.Position) return [];
        return [{
          ref: edgeRef(edge.id),
          label: edge.Label?.text || `${from.Label.text} to ${to.Label.text}`,
          anchor: {
            x: (from.Position.x + to.Position.x) / 2,
            y: (from.Position.y + to.Position.y) / 2,
          },
        }];
      });
      return [...nodes, ...edges];
    });
    return () => { offTargets(); };
  });
}
