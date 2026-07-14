import { introspect, type IntrospectKind, type IntrospectRef, type Registry } from '../core';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'demo.run-self': void;
    'demo.run-c4': void;
    'demo.run-math': void;
    'demo.run-workflow': void;
    'demo.loaded': { id: 'c4' | 'math' | 'workflow' };
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
    ctx.contexts.commands.register([
      {
        id: 'demo.render-self',
        label: 'Render self-graph',
        event: 'demo.run-self',
        group: 'demo',
      },
      {
        id: 'demo.render-c4',
        label: 'Open C4 software architecture example',
        event: 'demo.run-c4',
        group: 'demo',
      },
      {
        id: 'demo.render-math',
        label: 'Open radial expected-value map',
        event: 'demo.run-math',
        group: 'demo',
      },
      {
        id: 'demo.render-workflow',
        label: 'Open sequenced delivery workflow',
        event: 'demo.run-workflow',
        group: 'demo',
      },
    ]);

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
    const clearGraph = () => {
      graphs.current.nodes().slice().forEach(node => emit('graph.node.delete', { id: node.id }));
      containerIds().forEach(id => emit('graph.container.delete', { id }));
    };
    const makeContainer = (title: string, at: { x: number; y: number }, sections: string[], axis: 'rows' | 'columns' = 'rows') => {
      const before = new Set(containerIds());
      emit('editing.container.create', { Label: { text: title }, at });
      const id = containerIds().find(candidate => !before.has(candidate));
      if (id) {
        emit('item.update', {
          ref: { kind: 'container', id },
          patch: {
            SectionAxis: axis,
            Sections: sections.map((name, index) => ({ id: `s${index + 1}`, title: name, weight: 1 })),
          },
        });
      }
      return id;
    };
    const makeNode = (label: string, nodeType: 'text' | 'square' | 'circle', description: string, containerId?: string, sectionId?: string) => {
      const node = graphs.current.createNode({
        Label: { text: label },
        NodeType: nodeType,
        Description: description,
        Size: nodeType === 'text' ? { w: 190, h: 108 } : { w: 118, h: 118 },
      });
      if (containerId) emit('container.add-child', { containerId, childRef: { kind: 'node', id: node.id } as ItemRef, sectionId });
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id });
      return node.id;
    };

    on('demo.run-self', () => {
      const graph = graphs.current;
      // Clear previous self-graph: nodes (with their incident edges) and containers.
      clearGraph();

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

    on('demo.run-c4', () => {
      clearGraph();
      const context = makeContainer('C4 · System context', { x: 0, y: 0 }, ['People', 'System', 'External'], 'columns');
      const shop = makeContainer('C4 · Web shop containers', { x: 0, y: 0 }, ['Experience', 'Application', 'Data'], 'columns');
      if (context && shop) emit('container.add-child', { containerId: context, childRef: { kind: 'container', id: shop }, sectionId: 's2' });
      const customer = makeNode('Customer', 'circle', 'A person browsing products and placing an order.', context, 's1');
      const payment = makeNode('Payment provider', 'square', 'External card authorization and settlement.', context, 's3');
      const web = makeNode('Web application', 'text', 'Browser UI: catalog, basket, checkout.', shop, 's1');
      const api = makeNode('Commerce API', 'square', 'Owns pricing, orders, and checkout orchestration.', shop, 's2');
      const database = makeNode('Orders database', 'circle', 'Stores customers, baskets, and order state.', shop, 's3');
      [
        [customer, web, 'uses'],
        [web, api, 'HTTPS / JSON'],
        [api, database, 'reads + writes'],
        [api, payment, 'authorizes'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      emit('layout.apply.tidy');
      emit('view.fit.all');
      emit('demo.loaded', { id: 'c4' });
    });

    on('demo.run-math', () => {
      clearGraph();
      const expectation = makeNode('Expected value', 'circle', 'The probability-weighted center of a random variable.');
      const variable = makeNode('Random variable X', 'square', 'A rule that assigns a number to each possible outcome.');
      const outcomes = makeNode('Outcomes xᵢ', 'text', 'The values X can take: x₁, x₂, …');
      const probabilities = makeNode('Probabilities pᵢ', 'text', 'Weights satisfy pᵢ ≥ 0 and Σpᵢ = 1.');
      const formula = makeNode('E[X] = Σ xᵢpᵢ', 'square', 'Multiply each value by its probability, then add.');
      const longRun = makeNode('Long-run mean', 'circle', 'Across many repetitions, the sample mean approaches E[X].');
      const linearity = makeNode('Linearity', 'text', 'E[aX + bY] = aE[X] + bE[Y], even without independence.');
      [
        [expectation, variable, 'describes'],
        [expectation, outcomes, 'values'],
        [expectation, probabilities, 'weights'],
        [expectation, formula, 'compute'],
        [expectation, longRun, 'interprets'],
        [expectation, linearity, 'obeys'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      emit('layout.apply.radial');
      emit('view.fit.all');
      emit('demo.loaded', { id: 'math' });
    });

    on('demo.run-workflow', () => {
      clearGraph();
      const board = makeContainer('Delivery workflow', { x: 0, y: 0 }, ['Frame', 'Build', 'Check', 'Release'], 'columns');
      const request = makeNode('Frame the change', 'text', 'State the user outcome and the smallest acceptance check.', board, 's1');
      const implement = makeNode('Implement', 'square', 'Change one coherent slice and keep it reviewable.', board, 's2');
      const tests = makeNode('Automated checks', 'circle', 'Types, focused regression, then the full release gate.', board, 's3');
      const review = makeNode('Review', 'square', 'Inspect behavior, architecture boundaries, and failure paths.', board, 's3');
      const release = makeNode('Release', 'text', 'Publish the verified artifact and its concise change note.', board, 's4');
      [
        [request, implement, 'ready'],
        [implement, tests, 'verify'],
        [tests, review, 'green'],
        [review, release, 'approved'],
        [review, implement, 'changes requested'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      emit('layout.apply.tidy');
      emit('view.fit.all');
      emit('demo.loaded', { id: 'workflow' });
    });
    on('app.start', () => {
      const id = new URLSearchParams(location.search).get('demo');
      const event = id === 'c4' ? 'demo.run-c4'
        : id === 'math' ? 'demo.run-math'
        : id === 'workflow' ? 'demo.run-workflow'
        : null;
      if (event) queueMicrotask(() => emit(event));
    });
  }, { requires: ['graph', 'render', 'containers'] });
}
