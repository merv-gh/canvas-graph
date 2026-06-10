import { introspect, type IntrospectKind, type IntrospectRef, type Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'demo.run-self': void;
  }
}

/** Self-graph: the live composition of the app rendered as nodes + edges.
 *  Sources its data exclusively from `introspect(ctx)`, so adding a new
 *  system / ability / feature / entity / collection shows up here with zero
 *  edits. The drawn slice is intentionally compact (no event nodes, only the
 *  high-signal relations) so the picture stays legible. */
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
    const refKey = (ref: IntrospectRef) => `${ref.kind}:${ref.id}`;

    on('demo.run-self', () => {
      const graph = graphs.current;
      graph.nodes().slice().forEach(node => emit('graph.node.delete', { id: node.id }));

      const snapshot = introspect(ctx);
      const wantedNodes = snapshot.nodes.filter(n => NODE_KINDS.includes(n.kind));
      const idOf = new Map<string, string>();

      wantedNodes.forEach(n => {
        const created = graph.createNode({ Label: { text: `${n.kind}:${n.id}` } });
        idOf.set(refKey(n), created.id);
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

      emit('layout.apply.tidy');
      emit('view.fit.all');

      console.info('[demo] self-graph rendered', {
        nodes: wantedNodes.length,
        edges: snapshot.edges.filter(e => EDGE_RELATIONS.has(e.relation)).length,
      });
    });
  }, { requires: ['graph', 'render'] });
}
