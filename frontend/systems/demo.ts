import { introspect, type IntrospectKind, type IntrospectRef, type Registry } from '../core';
import type { EdgeKind, NodeColor, NodeType } from '../model/graph';
import type { Id, ItemRef } from '../types';
import type { ContainerType } from './container-entity';

declare module '../types' {
  interface CustomEvents {
    'demo.run-self': void;
    'demo.run-c4': void;
    'demo.run-math': void;
    'demo.run-workflow': void;
    'demo.run-flowchart': void;
    'demo.run-mindmap': void;
    'demo.run-game': void;
    'demo.run-uml': void;
    'demo.run-outline': void;
    'demo.run-transformer': void;
    'demo.run-kimi-k2': void;
    'demo.run-agent-observability': void;
    'demo.loaded': { id: 'c4' | 'math' | 'workflow' | 'flowchart' | 'mindmap' | 'game' | 'uml' | 'outline' | 'transformer' | 'kimi-k2' | 'agent-observability' };
  }
}

/** Self-graph: the live composition of the app rendered as nodes + edges + one
 *  container per kind so the picture stays readable. Sources its data
 *  exclusively from `introspect(ctx)`, so adding a new system / ability /
 *  feature / entity / collection shows up here with zero edits. */
export function registerDemo(system: Registry) {
  system('demo', (ctx) => {
    const { on, emit, graphs } = ctx;
    ctx.contexts.commands.register([
      {
        id: 'demo.render-self',
        label: 'Render self-graph',
        event: 'demo.run-self',
        group: 'demo',
        hidden: true,
      },
      {
        id: 'demo.render-c4',
        label: 'Open checkout microservices architecture',
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
        label: 'Open Jira issue workflow example',
        event: 'demo.run-workflow',
        group: 'demo',
      },
      {
        id: 'demo.render-flowchart',
        label: 'Open canonical flowchart example',
        event: 'demo.run-flowchart',
        group: 'demo',
      },
      {
        id: 'demo.render-mindmap',
        label: 'Open canonical mindmap example',
        event: 'demo.run-mindmap',
        group: 'demo',
      },
      {
        id: 'demo.render-game',
        label: 'Open vertical nested Game design map',
        event: 'demo.run-game',
        group: 'demo',
      },
      {
        id: 'demo.render-uml',
        label: 'Open UML class map example',
        event: 'demo.run-uml',
        group: 'demo',
      },
      {
        id: 'demo.render-outline',
        label: 'Open nested outline example',
        event: 'demo.run-outline',
        group: 'demo',
      },
      {
        id: 'demo.render-transformer',
        label: 'Open Transformer architecture example',
        event: 'demo.run-transformer',
        group: 'demo',
      },
      {
        id: 'demo.render-kimi-k2',
        label: 'Open Kimi K2 architecture example',
        event: 'demo.run-kimi-k2',
        group: 'demo',
      },
      {
        id: 'demo.render-agent-observability',
        label: 'Open multi-agent observability report example',
        event: 'demo.run-agent-observability',
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
    // Node creation schedules the normal auto-layout feature in a microtask.
    // Canonical demos need their authored layout to win after that generic
    // pass, and fitting must use those final positions.
    const finishDemo = (
      layout: 'layout.apply.tidy' | 'layout.apply.radial' | 'layout.apply.vertical' | 'layout.apply.horizontal' | 'layout.apply.tree' | null,
      id?: 'c4' | 'math' | 'workflow' | 'flowchart' | 'mindmap' | 'game' | 'uml' | 'outline' | 'transformer' | 'kimi-k2' | 'agent-observability',
      arrange?: () => void,
    ) => {
      queueMicrotask(() => {
        arrange?.();
        if (layout) emit(layout);
        emit('selection.item.clear');
        emit('view.fit.all');
        if (id) emit('demo.loaded', { id });
      });
    };
    const place = (id: Id | undefined, Position: { x: number; y: number }, Size?: { w: number; h: number }) => {
      if (!id) return;
      emit('item.update', { ref: { kind: 'node', id }, patch: { Position, ...(Size ? { Size } : {}) } });
    };
    const frame = (id: Id | undefined, Position: { x: number; y: number }, Size: { w: number; h: number }) => {
      if (!id) return;
      emit('item.update', { ref: { kind: 'container', id }, patch: { Position, Size, AutoFit: false } });
    };
    const makeContainer = (
      title: string,
      at: { x: number; y: number },
      sections: string[],
      axis: 'rows' | 'columns' = 'rows',
      ContainerType?: ContainerType,
      Color?: NodeColor,
    ) => {
      const before = new Set(containerIds());
      emit('editing.container.create', { Label: { text: title }, at, ContainerType, Color });
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
    // Per-type authored sizes; shapes and system types keep the 118px default.
    const NODE_SIZES: Partial<Record<NodeType, { w: number; h: number }>> = {
      text: { w: 190, h: 108 },
      'uml-class': { w: 250, h: 170 },
      'list-item': { w: 240, h: 48 },
      'section-header': { w: 280, h: 64 },
      input: { w: 220, h: 64 },
      output: { w: 220, h: 64 },
      embedding: { w: 220, h: 72 },
      dense: { w: 220, h: 72 },
      attention: { w: 220, h: 72 },
      moe: { w: 220, h: 72 },
      norm: { w: 220, h: 48 },
      operator: { w: 44, h: 44 },
      caption: { w: 360, h: 44 },
      agent: { w: 210, h: 96 },
      'timeline-step': { w: 240, h: 88 },
      'data-table': { w: 300, h: 190 },
      toggle: { w: 210, h: 84 },
      artifact: { w: 230, h: 100 },
      'approval-gate': { w: 180, h: 118 },
    };
    const makeNode = (label: string, nodeType: NodeType, description: string, containerId?: string, sectionId?: string, color?: NodeColor) => {
      const node = graphs.current.createNode({
        Label: { text: label },
        NodeType: nodeType,
        Color: color,
        Description: description,
        Size: NODE_SIZES[nodeType] ?? { w: 118, h: 118 },
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
      finishDemo('layout.apply.tidy');

      console.info('[demo] self-graph rendered', {
        nodes: wantedNodes.length,
        containers: containerOfKind.size,
        edges: snapshot.edges.filter(e => EDGE_RELATIONS.has(e.relation)).length,
      });
    });

    on('demo.run-c4', () => {
      clearGraph();
      emit('preset.set', { preset: 'c4' });
      const landscape = makeContainer('Commerce landscape', { x: 0, y: 0 }, []);
      const platform = makeContainer('Checkout platform', { x: 0, y: 0 }, [], 'rows', 'c4-system', 'blue');
      const edge = makeContainer('Edge', { x: -515, y: 0 }, [], 'rows', 'c4-container', 'gray');
      const services = makeContainer('Spring services', { x: -100, y: 0 }, [], 'rows', 'c4-container', 'green');
      const data = makeContainer('Data & events', { x: 440, y: 0 }, [], 'rows', 'c4-container', 'purple');
      if (landscape && platform) emit('container.add-child', { containerId: landscape, childRef: { kind: 'container', id: platform } });
      [edge, services, data].forEach(id => {
        if (platform && id) emit('container.add-child', { containerId: platform, childRef: { kind: 'container', id } });
      });
      const customer = makeNode('Web / mobile client', 'user-input', 'Customers browse, build a cart, and submit checkout.', landscape, undefined, 'gray');
      const stripe = makeNode('Stripe', 'rounded', 'External payment authorization and settlement.', landscape, undefined, 'gray');
      const gateway = makeNode('API Gateway', 'gateway', 'Routes authenticated requests.', edge, undefined, 'gray');
      const orders = makeNode('Spring · Order Service', 'service', 'Owns checkout orchestration and the order aggregate.', services, undefined, 'green');
      const inventory = makeNode('Spring · Inventory Service', 'service', 'Consumes order events and reserves available stock.', services, undefined, 'green');
      const payments = makeNode('Spring · Payment Service', 'service', 'Isolates the payment provider and idempotency policy.', services, undefined, 'green');
      const kafka = makeNode('Kafka · order-events', 'kafka', 'Durable order.created and inventory.reserved streams.', data, undefined, 'gray');
      const postgres = makeNode('Postgres · orders', 'database', 'Transactional order state and the outbox table.', data, undefined, 'blue');
      const redis = makeNode('Redis · carts', 'cache', 'Short-lived carts and checkout idempotency keys.', data, undefined, 'red');
      [
        [customer, gateway, 'HTTPS / JSON'],
        [gateway, orders, 'REST'],
        [orders, redis, 'read + write'],
        [orders, postgres, 'transaction + outbox'],
        [orders, kafka, 'publish order.created'],
        [kafka, inventory, 'consume'],
        [orders, payments, 'gRPC'],
        [payments, stripe, 'HTTPS'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      finishDemo(null, 'c4', () => {
        frame(landscape, { x: 0, y: 0 }, { w: 1650, h: 900 });
        frame(platform, { x: 0, y: 0 }, { w: 1300, h: 700 });
        frame(edge, { x: -515, y: 0 }, { w: 280, h: 540 });
        frame(services, { x: -100, y: 0 }, { w: 540, h: 540 });
        frame(data, { x: 440, y: 0 }, { w: 380, h: 540 });
        place(customer, { x: -730, y: -55 }, { w: 190, h: 82 });
        place(stripe, { x: 730, y: 145 }, { w: 180, h: 78 });
        place(gateway, { x: -515, y: 0 }, { w: 176, h: 176 });
        place(orders, { x: -100, y: -165 }, { w: 230, h: 86 });
        place(inventory, { x: -100, y: 0 }, { w: 230, h: 86 });
        place(payments, { x: -100, y: 165 }, { w: 230, h: 86 });
        place(kafka, { x: 440, y: -165 }, { w: 220, h: 86 });
        place(redis, { x: 440, y: 0 }, { w: 220, h: 86 });
        place(postgres, { x: 440, y: 165 }, { w: 220, h: 86 });
      });
    });

    on('demo.run-math', () => {
      clearGraph();
      emit('preset.set', { preset: 'basic' });
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
      finishDemo('layout.apply.radial', 'math');
    });

    on('demo.run-workflow', () => {
      clearGraph();
      emit('preset.set', { preset: 'jira' });
      const board = makeContainer('Jira · Issue lifecycle', { x: 0, y: 0 }, ['Backlog', 'Active', 'Done'], 'columns');
      const open = makeNode('Open', 'square', 'Triaged and ready for someone to start.', board, 's1', 'gray');
      const progress = makeNode('In progress', 'square', 'Work is actively underway.', board, 's2', 'yellow');
      const resolved = makeNode('Resolved', 'square', 'A fix is available and awaiting verification.', board, 's3', 'green');
      const closed = makeNode('Closed', 'square', 'Verification passed; no further work remains.', board, 's3', 'green');
      const reopened = makeNode('Reopened', 'square', 'Verification found the issue still reproducible.', board, 's1', 'gray');
      [open, progress, resolved, closed, reopened].forEach(id =>
        emit('item.update', { ref: { kind: 'node', id }, patch: { Fill: 'solid' } }));
      [
        [open, progress, 'start progress'],
        [progress, resolved, 'resolve'],
        [resolved, closed, 'verify'],
        [resolved, reopened, 'reopen'],
        [reopened, progress, 'resume'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      finishDemo(null, 'workflow', () => {
        frame(board, { x: 0, y: 0 }, { w: 1500, h: 560 });
        place(open, { x: -540, y: -100 });
        place(reopened, { x: -540, y: 130 });
        place(progress, { x: -80, y: 0 });
        place(resolved, { x: 390, y: -100 });
        place(closed, { x: 390, y: 130 });
      });
    });

    on('demo.run-flowchart', () => {
      clearGraph();
      emit('preset.set', { preset: 'flowchart' });
      const start = makeNode('Order received', 'pill', 'A customer submits an order.', undefined, undefined, 'green');
      const capture = makeNode('Capture order', 'parallelogram', 'Read customer, basket, and payment input.', undefined, undefined, 'purple');
      const valid = makeNode('Payment valid?', 'diamond', 'Authorize the selected payment method.', undefined, undefined, 'yellow');
      const fulfill = makeNode('Fulfill order', 'square', 'Reserve stock and send the warehouse request.', undefined, undefined, 'blue');
      const retry = makeNode('Request another method', 'rounded', 'Explain the decline and preserve the basket.', undefined, undefined, 'green');
      const done = makeNode('Confirmation sent', 'pill', 'Tell the customer the order is accepted.', undefined, undefined, 'green');
      [
        [start, capture, ''], [capture, valid, ''], [valid, fulfill, 'Yes'],
        [valid, retry, 'No'], [retry, capture, 'retry'], [fulfill, done, ''],
      ].forEach(([From, To, label]) => emit('graph.edge.create', {
        From, To, ...(label ? { Label: { text: label } } : {}), EdgeKind: 'plain',
      }));
      finishDemo(null, 'flowchart', () => {
        place(start, { x: 0, y: -420 });
        place(capture, { x: 0, y: -260 });
        place(valid, { x: 0, y: -70 });
        place(fulfill, { x: 300, y: 150 });
        place(retry, { x: -300, y: 150 });
        place(done, { x: 300, y: 340 });
      });
    });

    on('demo.run-mindmap', () => {
      clearGraph();
      emit('preset.set', { preset: 'mindmap' });
      const launch = makeNode('Product launch', 'rounded', 'One shared launch plan.', undefined, undefined, 'gray');
      const market = makeNode('Market', 'pill', 'Who needs this and why now?', undefined, undefined, 'blue');
      const product = makeNode('Product', 'pill', 'What must be ready?', undefined, undefined, 'green');
      const story = makeNode('Story', 'pill', 'How will people understand it?', undefined, undefined, 'orange');
      const rollout = makeNode('Rollout', 'pill', 'How do we release safely?', undefined, undefined, 'purple');
      const leaves: Array<[Id, Id]> = [
        [market, makeNode('Ideal customer', 'text', 'Primary segment and job.')],
        [market, makeNode('Alternatives', 'text', 'What they use today.')],
        [product, makeNode('Quality bar', 'text', 'Acceptance checks and polish.')],
        [product, makeNode('Support', 'text', 'Docs, onboarding, ownership.')],
        [story, makeNode('Positioning', 'text', 'One memorable promise.')],
        [story, makeNode('Proof', 'text', 'Demo, evidence, customer voice.')],
        [rollout, makeNode('Pilot', 'text', 'Small cohort and feedback loop.')],
        [rollout, makeNode('Metrics', 'text', 'Activation, reliability, retention.')],
      ];
      [market, product, story, rollout].forEach(branch => emit('graph.edge.create', { From: launch, To: branch }));
      leaves.forEach(([From, To]) => emit('graph.edge.create', { From, To }));
      finishDemo('layout.apply.radial', 'mindmap');
    });
    on('demo.run-game', () => {
      clearGraph();
      graphs.current.rename('Game');
      emit('graph.renamed', { id: graphs.current.id, name: graphs.current.name });

      const game = makeNode(
        'Game',
        'circle',
        '**Creative blueprint** connecting what the player experiences, hears, sees, and repeatedly does.',
      );
      const narrative = makeNode('Narrative', 'square', 'Meaning, dramatic structure, people, and the world that make play worth caring about.');
      const story = makeNode('Story', 'text', '**Premise · themes · structure · pacing**\n\nDefine the dramatic question, major beats, and how play advances them.');
      const characters = makeNode('Characters', 'text', '**Player · allies · rivals · NPCs**\n\nGive each a role, motivation, voice, relationships, and visible arc.');
      const world = makeNode('World & lore', 'text', '**Setting · history · factions · rules**\n\nBuild coherent context that can be discovered through action instead of exposition alone.');
      const quests = makeNode('Quests & dialogue', 'text', '**Objectives · choices · consequences**\n\nTurn narrative intent into playable goals and responsive conversations.');

      const audio = makeNode('Audio', 'square', 'The audible layer that establishes place, communicates state, and reinforces emotion and action.');
      const music = makeNode('Music', 'text', '**Themes · adaptive score · transitions**\n\nMove cleanly between exploration, tension, combat, success, and loss.');
      const sound = makeNode('Sound design', 'text', '**Ambience · Foley · UI · feedback**\n\nMake spaces believable and every important action readable without looking.');
      const voice = makeNode('Voice', 'text', '**Casting · performance · recording · localization**\n\nPreserve character intent across sessions, languages, and runtime variation.');
      const mix = makeNode('Runtime mix', 'text', '**Spatial audio · priority · ducking · loudness**\n\nKeep essential cues intelligible when many systems speak at once.');

      const visuals = makeNode('Visuals', 'square', 'The visual language that makes the world coherent, legible, performant, and emotionally distinct.');
      const art = makeNode('Art direction', 'text', '**Shape · color · material · composition**\n\nDefine a singular visual grammar and references for every production discipline.');
      const rendering = makeNode('Rendering & lighting', 'text', '**Pipeline · shaders · cameras · light**\n\nDeliver the intended look inside frame-time and platform constraints.');
      const models = makeNode('3D models', 'text', '**Characters · environments · props · LODs**\n\nAuthor production-ready assets with consistent scale, topology, collision, and budgets.');
      const animation = makeNode('Animation & VFX', 'text', '**Motion · state changes · particles · impact**\n\nCommunicate weight, intention, timing, danger, and reward.');

      const design = makeNode('Game Design', 'square', 'The rules and decisions that turn content into a learnable, replayable, and balanced experience.');
      const loop = makeNode('Core game loop', 'text', '**Act → feedback → reward → new decision**\n\nState the repeatable minute-to-minute promise before expanding scope.');
      const mechanics = makeNode('Mechanics & systems', 'text', '**Movement · combat · interaction · simulation**\n\nDefine rules, inputs, state, feedback, failure, and meaningful combinations.');
      const levels = makeNode('Level design', 'text', '**Space · encounter · pacing · navigation**\n\nTeach and test mechanics through readable routes, choices, landmarks, and escalation.');
      const progression = makeNode('Progression & balance', 'text', '**Difficulty · economy · unlocks · mastery**\n\nShape short- and long-term goals while keeping strategies viable and rewards meaningful.');

      const branches: Array<[string, string[]]> = [
        [narrative, [story, characters, world, quests]],
        [audio, [music, sound, voice, mix]],
        [visuals, [art, rendering, models, animation]],
        [design, [loop, mechanics, levels, progression]],
      ];
      branches.forEach(([category, details]) => {
        emit('graph.edge.create', { From: game, To: category });
        details.forEach(detail => emit('graph.edge.create', { From: category, To: detail }));
      });
      finishDemo('layout.apply.vertical', 'game');
    });

    // Preset demos activate their preset first: the preset owns the shell
    // style, the layout mode, and the default type for anything the user adds
    // afterwards. Explicit per-node types below are never patched by it.
    on('demo.run-uml', () => {
      clearGraph();
      emit('preset.set', { preset: 'uml' });
      const user = makeNode('User', 'uml-class', '- id: UUID\n- email: string\n- name: string\n\n+ authenticate(): boolean');
      const order = makeNode('Order', 'uml-class', '- id: UUID\n- items: LineItem[]\n- status: OrderStatus\n\n+ total(): Money');
      const payment = makeNode('PaymentService', 'uml-class', '+ charge(order, card): Receipt\n+ refund(receipt): void');
      const repository = makeNode('OrderRepository', 'uml-class', '+ save(order): void\n+ find(id): Order');
      [
        [user, order, 'places'],
        [order, payment, 'charged by'],
        [order, repository, 'persisted by'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      finishDemo('layout.apply.tree', 'uml');
    });

    on('demo.run-outline', () => {
      clearGraph();
      emit('preset.set', { preset: 'outline' });
      const header = makeNode('Launch plan', 'section-header', 'Everything that has to be true before launch day.');
      const positioning = makeNode('Positioning', 'list-item', 'One sentence a tired user would repeat.');
      const research = makeContainer('Research', { x: 0, y: 0 }, []);
      const interviews = makeNode('User interviews', 'list-item', '12 sessions, tagged by job-to-be-done.', research);
      const scan = makeNode('Competitor scan', 'list-item', 'Top 5 alternatives, pricing, gaps.', research);
      const pricing = makeContainer('Pricing', { x: 0, y: 0 }, []);
      if (research && pricing) emit('container.add-child', { containerId: research, childRef: { kind: 'container', id: pricing } });
      const wtp = makeNode('Willingness-to-pay calls', 'list-item', 'Van Westendorp on the shortlisted tiers.', pricing);
      const tiers = makeNode('Tier draft', 'list-item', 'Free / Pro / Team with usage caps.', pricing);
      const week = makeContainer('Launch week', { x: 0, y: 0 }, []);
      const announce = makeNode('Announcement', 'list-item', 'Blog post, changelog, social kit.', week);
      const docs = makeNode('Docs refresh', 'list-item', 'Quickstart plus migration guide.', week);
      // Children open to the right: one horizontal row per container, explicit
      // placement (a vertical layout pass would stack them). Containers
      // auto-fit their bounds around wherever the children land.
      finishDemo(null, 'outline', () => {
        place(header, { x: 0, y: -300 });
        place(positioning, { x: 0, y: -190 });
        place(interviews, { x: -330, y: -40 });
        place(scan, { x: -54, y: -40 });
        place(wtp, { x: 222, y: -40 });
        place(tiers, { x: 498, y: -40 });
        place(announce, { x: -138, y: 170 });
        place(docs, { x: 138, y: 170 });
      });
    });

    // Model architecture examples: ML block node types + per-node colors.
    on('demo.run-transformer', () => {
      clearGraph();
      graphs.current.rename('Transformer');
      emit('graph.renamed', { id: graphs.current.id, name: graphs.current.name });

      const srcTokens = makeNode('Source tokens', 'input', 'Token ids from the source sentence.', undefined, undefined, 'gray');
      const tgtTokens = makeNode('Target tokens (shifted right)', 'input', 'Decoder input during training.', undefined, undefined, 'gray');
      const srcEmbed = makeNode('Input embedding + positions', 'embedding', 'Vocab projection scaled by √d, plus positional signal.', undefined, undefined, 'purple');
      const tgtEmbed = makeNode('Output embedding + positions', 'embedding', 'Shares weights with the input embedding and the final linear layer.', undefined, undefined, 'purple');
      const selfAttn = makeNode('Encoder self-attention ×N', 'attention', 'Multi-head attention over the full source sequence.', undefined, undefined, 'red');
      const crossAttn = makeNode('Decoder cross-attention ×N', 'attention', 'Queries from the decoder attend to encoder outputs.', undefined, undefined, 'orange');
      const maskedAttn = makeNode('Masked self-attention ×N', 'attention', 'Causal mask keeps each position from seeing the future.', undefined, undefined, 'red');
      const encNorm = makeNode('Add & norm', 'norm', 'Residual connection plus layer normalization.', undefined, undefined, 'green');
      const ffn = makeNode('Feed-forward ×N', 'dense', 'Two linear layers with a ReLU (or GELU) between: d → 4d → d.', undefined, undefined, 'blue');
      const head = makeNode('Linear + softmax', 'output', 'Projects decoder state to vocab logits and samples the next token.', undefined, undefined, 'yellow');
      [
        [srcTokens, srcEmbed, 'ids'],
        [tgtTokens, tgtEmbed, 'ids'],
        [srcEmbed, selfAttn, 'Q K V'],
        [selfAttn, encNorm, 'residual'],
        [encNorm, ffn, 'encode'],
        [tgtEmbed, maskedAttn, 'Q K V'],
        [maskedAttn, crossAttn, 'decode'],
        [encNorm, crossAttn, 'memory K V'],
        [ffn, head, 'final state'],
        [crossAttn, head, 'final state'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      finishDemo('layout.apply.vertical', 'transformer');
    });

    // Kimi K2: a canonical architecture reading order rather than a dense
    // inventory. One vertical backbone, one repeated boundary, one expert fork.
    on('demo.run-kimi-k2', () => {
      clearGraph();
      graphs.current.rename('Kimi K2 · canonical architecture');
      emit('graph.renamed', { id: graphs.current.id, name: graphs.current.name });
      emit('preset.set', { preset: 'architecture' });

      const tokens = makeNode('Tokens · 128K context', 'input', 'Input token sequence.', undefined, undefined, 'gray');
      const embed = makeNode('Token embedding', 'embedding', 'Maps token ids into the model width.', undefined, undefined, 'purple');
      const denseFirst = makeNode('Dense transformer layer', 'dense', 'Layer 1 uses a dense feed-forward network.', undefined, undefined, 'blue');
      const repeated = makeContainer('Repeated transformer block · layers 2–61', { x: 0, y: 80 }, []);
      const mla = makeNode('Multi-head Latent Attention', 'attention', 'Compressed latent keys and values reduce KV-cache cost.', repeated, undefined, 'red');
      const router = makeNode('Sparse expert router', 'norm', 'Scores experts and selects the top eight per token.', repeated, undefined, 'green');
      const shared = makeNode('Shared expert · always active', 'dense', 'Handles common knowledge for every token.', repeated, undefined, 'blue');
      const routed = makeNode('384 routed experts · top 8', 'moe', 'Sparse specialists; only eight activate for each token.', repeated, undefined, 'orange');
      const sum = makeNode('⊕', 'operator', 'Merge shared and routed expert outputs.', repeated);
      const norm = makeNode('Residual + RMSNorm', 'norm', 'Merge the skip path and normalize.', repeated, undefined, 'green');
      const head = makeNode('Language-model head', 'output', 'Projects hidden state to next-token logits.', undefined, undefined, 'yellow');
      const caption = makeNode('Kimi K2 · 1.04T total parameters · 32B active per token', 'caption', 'Simplified architectural view.');
      if (repeated) {
        emit('item.update', {
          ref: { kind: 'container', id: repeated },
          patch: {
            Legend: [
              { color: 'blue', label: 'Shared expert' },
              { color: 'orange', label: 'Routed experts' },
            ],
            Multiplier: '60×',
          },
        });
      }
      ([
        [tokens, embed, 'ids', 'plain'],
        [embed, denseFirst, 'hidden', 'plain'],
        [denseFirst, mla, 'hidden', 'plain'],
        [mla, router, 'hidden', 'plain'],
        [router, shared, 'always', 'plain'],
        [router, routed, 'top-8', 'dashed'],
        [shared, sum, '', 'plain'],
        [routed, sum, '', 'plain'],
        [sum, norm, 'sum', 'plain'],
        [mla, norm, 'residual', 'residual'],
        [norm, head, 'final hidden', 'plain'],
      ] as [Id, Id, string, EdgeKind][]).forEach(([From, To, label, kind]) =>
        emit('graph.edge.create', { From, To, ...(label ? { Label: { text: label } } : {}), EdgeKind: kind }));
      finishDemo(null, 'kimi-k2', () => {
        frame(repeated, { x: 0, y: 80 }, { w: 760, h: 690 });
        place(tokens, { x: 0, y: -500 });
        place(embed, { x: 0, y: -390 });
        place(denseFirst, { x: 0, y: -275 });
        place(mla, { x: 0, y: -145 });
        place(router, { x: 0, y: -20 });
        place(shared, { x: -210, y: 115 });
        place(routed, { x: 210, y: 115 });
        place(sum, { x: 0, y: 235 });
        place(norm, { x: 0, y: 340 });
        place(head, { x: 0, y: 480 });
        place(caption, { x: 0, y: 570 });
      });
    });

    on('demo.run-agent-observability', () => {
      clearGraph();
      graphs.current.rename('Multi-agent run · observability report');
      emit('graph.renamed', { id: graphs.current.id, name: graphs.current.name });
      emit('preset.set', { preset: 'autonomous' });

      const investigator = makeNode('Investigator', 'agent', 'Architecture audit · done · 2.4k tokens', undefined, undefined, 'blue');
      const builder = makeNode('Builder', 'agent', 'Visualization prototype · retry 1/3', undefined, undefined, 'purple');
      const reviewer = makeNode('Reviewer', 'agent', 'Keyboard, layout, evidence · running', undefined, undefined, 'green');
      const audit = makeNode('Trace boundaries · 02:18', 'timeline-step', '18 modules · 3 leaks · critical path', undefined, undefined, 'gray');
      const prototype = makeNode('Draft v2 · 01:44', 'timeline-step', 'Loop cause and artifact lineage added.', undefined, undefined, 'purple');
      const verify = makeNode('Verify demo · 00:51', 'timeline-step', '320px reflow · selection · filters', undefined, undefined, 'green');
      const report = makeNode('architecture-review.md', 'artifact', 'Producer: Investigator\nConsumer: Orchestrator\nState: accepted', undefined, undefined, 'orange');
      const demo = makeNode('agent-run-observer.html', 'artifact', 'Producer: Builder\nVersion: v2\nState: verified', undefined, undefined, 'orange');
      const metrics = makeNode('Run metrics', 'data-table', 'Agent | Time | Tokens\nInvestigator | 3:12 | 2.4k\nBuilder | 3:18 | 2.9k\nReviewer | 1:39 | 1.1k', undefined, undefined, 'purple');
      const rawReasoning = makeNode('Show raw reasoning', 'toggle', 'Off · expose decisions and evidence instead.', undefined, undefined, 'green');
      const approval = makeNode('Implementation approval', 'approval-gate', 'Visual proposal complete. Product changes wait here.', undefined, undefined, 'yellow');

      ([
        [investigator, audit, 'owns', 'plain'], [audit, report, 'produces', 'plain'], [report, metrics, 'feeds', 'plain'],
        [builder, prototype, 'owns', 'plain'], [prototype, demo, 'produces v2', 'plain'], [demo, rawReasoning, 'policy', 'plain'],
        [reviewer, verify, 'owns', 'plain'], [verify, approval, 'evidence', 'plain'], [approval, prototype, 'retry if rejected', 'dashed'],
      ] as [Id, Id, string, EdgeKind][]).forEach(([From, To, label, EdgeKind]) =>
        emit('graph.edge.create', { From, To, Label: { text: label }, EdgeKind }));

      finishDemo(null, 'agent-observability', () => {
        place(investigator, { x: -560, y: -250 }); place(builder, { x: -560, y: 0 }); place(reviewer, { x: -560, y: 250 });
        place(audit, { x: -260, y: -250 }); place(prototype, { x: -260, y: 0 }); place(verify, { x: -260, y: 250 });
        place(report, { x: 30, y: -250 }); place(demo, { x: 30, y: 0 }); place(approval, { x: 30, y: 250 });
        place(metrics, { x: 380, y: -180 }); place(rawReasoning, { x: 380, y: 80 });
      });
    });

    on('app.start', () => {
      const id = new URLSearchParams(location.search).get('demo');
      const event = id === 'c4' ? 'demo.run-c4'
        : id === 'math' ? 'demo.run-math'
        : id === 'workflow' ? 'demo.run-workflow'
        : id === 'flowchart' ? 'demo.run-flowchart'
        : id === 'mindmap' ? 'demo.run-mindmap'
        : id === 'game' ? 'demo.run-game'
        : id === 'uml' ? 'demo.run-uml'
        : id === 'outline' ? 'demo.run-outline'
        : id === 'transformer' ? 'demo.run-transformer'
        : id === 'kimi-k2' ? 'demo.run-kimi-k2'
        : id === 'agent-observability' ? 'demo.run-agent-observability'
        : null;
      if (event) queueMicrotask(() => emit(event));
    });
  }, { requires: ['graph', 'render', 'containers'] });
}
