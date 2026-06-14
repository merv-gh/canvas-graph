import { introspect, type IntrospectKind, type IntrospectRef, type Registry } from '../core';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'demo.run-self': void;
  }
}

/** Self-graph: the live composition of the app rendered as nodes + edges + one
 *  container per kind so the picture stays readable. Sources its data
 *  exclusively from `introspect(ctx)`, so adding a new system / ability /
 *  feature / entity / collection shows up here with zero edits. */
export function registerDemo(system: Registry) {
  system('demo', (ctx) => {
    const { on, emit, graphs, contribute } = ctx;
    contribute({ surface: 'top', command: 'demo.render-self', kind: 'button', text: '★ Self', order: 60 });
    ctx.contexts.commands.register([{
      id: 'demo.render-self',
      label: 'Render self-graph',
      event: 'demo.run-self',
      group: 'demo',
    }]);

    const NODE_KINDS: IntrospectKind[] = ['system', 'ability', 'feature', 'entity', 'collection'];
    const EDGE_RELATIONS = new Set(['requires', 'declares', 'lists']);
    /** Plural human label per kind — used as the container title. */
    const KIND_LABEL: Record<IntrospectKind, string> = {
      system: 'Systems',
      ability: 'Abilities',
      feature: 'Features',
      entity: 'Entities',
      collection: 'Collections',
      command: 'Commands',
      event: 'Events',
    };
    const refKey = (ref: IntrospectRef) => `${ref.kind}:${ref.id}`;
    const containerIds = () =>
      (graphs.current.itemsOfKind('container') as { id: Id }[]).map(c => c.id);

    on('demo.run-self', () => {
      const graph = graphs.current;
      // Clear previous self-graph: nodes (with their incident edges) and containers.
      graph.nodes().slice().forEach(node => emit('graph.node.delete', { id: node.id }));
      containerIds().forEach(id => emit('graph.container.delete', { id }));

      const snapshot = introspect(ctx);
      const wantedNodes = snapshot.nodes.filter(n => NODE_KINDS.includes(n.kind));

      // One container per kind. Capture each newly created container id by
      // diffing before/after — keeps demo independent of the container
      // system's id-generation strategy.
      const containerOfKind = new Map<IntrospectKind, Id>();
      NODE_KINDS.forEach((kind, i) => {
        const before = new Set(containerIds());
        emit('editing.container.create', {
          Label: { text: KIND_LABEL[kind] },
          // Stagger initial positions so tidy doesn't pile them on top of each
          // other before laying out per-scope.
          at: { x: i * 600, y: 0 },
        });
        const created = containerIds().find(id => !before.has(id));
        if (created) containerOfKind.set(kind, created);
      });

      const idOf = new Map<string, Id>();
      wantedNodes.forEach(n => {
        // Node label is just the id — the parent container already names the kind.
        const created = graph.createNode({ Label: { text: n.id } });
        idOf.set(refKey(n), created.id);
        const containerId = containerOfKind.get(n.kind);
        if (containerId) {
          emit('container.add-child', { containerId, childRef: { kind: 'node', id: created.id } as ItemRef });
        }
        emit('graph.node.created', { graphId: graph.id, id: created.id });
      });

      snapshot.edges.forEach(e => {
        if (!EDGE_RELATIONS.has(e.relation)) return;
        const from = idOf.get(refKey(e.from));
        const to = idOf.get(refKey(e.to));
        if (!from || !to || from === to) return;
        const created = graph.createEdge({ From: from, To: to, Label: { text: e.relation } });
        emit('graph.edge.created', { graphId: graph.id, id: created.id, edge: created });
      });

      // Tidy is scope-aware (layout.ts `partitionByScope`) — each container's
      // children lay out inside the container's local frame, root-scope items
      // lay out around (0,0). Then fit-all so everything is visible.
      emit('layout.apply.tidy');
      emit('view.fit.all');

      console.info('[demo] self-graph rendered', {
        nodes: wantedNodes.length,
        containers: containerOfKind.size,
        edges: snapshot.edges.filter(e => EDGE_RELATIONS.has(e.relation)).length,
      });
    });
  }, { requires: ['graph', 'render', 'containers'] });
}
