import { introspect, type IntrospectKind, type IntrospectRef, type Registry } from '../core';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'demo.run-self': void;
    'demo.run-java': void;
    'demo.run-concurrency': void;
    'demo.run-jira': void;
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
        id: 'demo.render-java',
        label: 'Render Java memory model map',
        event: 'demo.run-java',
        group: 'demo',
      },
      {
        id: 'demo.render-concurrency',
        label: 'Render concurrency/process map',
        event: 'demo.run-concurrency',
        group: 'demo',
      },
      {
        id: 'demo.render-jira',
        label: 'Render JIRA workflow map',
        event: 'demo.run-jira',
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

    on('demo.run-java', () => {
      clearGraph();

      const runtime = makeContainer('Runtime Data Areas', { x: -520, y: 0 }, ['Heap', 'Thread stacks', 'Metaspace']);
      const execution = makeContainer('Execution + JMM', { x: 0, y: 0 }, ['Threads', 'Synchronization', 'Happens-before']);
      const toolchain = makeContainer('Toolchain', { x: 520, y: 0 }, ['Source', 'Bytecode', 'JIT']);

      const source = makeNode('Java source', 'text', 'Classes, methods, fields, and generic source-level intent.', toolchain);
      const bytecode = makeNode('Bytecode', 'square', '`javac` emits class files with symbolic refs and stack-machine ops.', toolchain);
      const jit = makeNode('JIT compiler', 'circle', 'Hot methods become optimized machine code; deopt keeps the story reversible.', toolchain);
      const heap = makeNode('Heap objects', 'square', 'Shared object graph: headers, fields, arrays, and references.', runtime);
      const stacks = makeNode('Thread stacks', 'text', 'Frames hold locals, operand stacks, return points, and monitor records.', runtime);
      const gc = makeNode('GC roots', 'circle', 'Stacks, statics, JNI refs, and VM roots seed reachability.', runtime);
      const threads = makeNode('Threads', 'circle', 'Each thread executes frames while sharing heap state.', execution);
      const sync = makeNode('Monitors + volatile', 'square', 'Synchronization creates ordering edges and visibility guarantees.', execution);
      const hb = makeNode('Happens-before', 'text', '- program order\n- monitor unlock -> lock\n- volatile write -> read', execution);

      [
        [source, bytecode, 'compile'],
        [bytecode, jit, 'hot path'],
        [threads, stacks, 'executes'],
        [stacks, heap, 'references'],
        [gc, heap, 'traces'],
        [threads, sync, 'coordinates'],
        [sync, hb, 'orders'],
        [hb, heap, 'visibility'],
        [jit, threads, 'runs code'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));

      emit('layout.apply.tidy');
      emit('view.fit.all');
    });

    on('demo.run-concurrency', () => {
      clearGraph();
      const shared = makeContainer('Shared Memory', { x: -420, y: 0 }, ['ordinary field', 'volatile flag', 'mutex-protected'], 'rows');
      const threads = makeContainer('Process Threads', { x: 260, y: 0 }, ['Thread A', 'Thread B', 'Scheduler'], 'columns');

      const write = makeNode('write x = 1', 'square', 'Ordinary write can be reordered unless a happens-before edge constrains it.', threads, 's1');
      const volatileWrite = makeNode('volatile ready = true', 'circle', 'Volatile write publishes prior writes to later volatile readers.', threads, 's1');
      const readFlag = makeNode('read ready', 'circle', 'Volatile read observes the publication edge.', threads, 's2');
      const readX = makeNode('read x', 'square', 'If ready is observed, `x` is visible through happens-before.', threads, 's2');
      const mutex = makeNode('mutex lock', 'circle', 'Mutual exclusion serializes the critical section.', shared, 's3');
      const counter = makeNode('counter++', 'square', 'Read-modify-write needs atomicity: lock, CAS, or atomic classes.', shared, 's3');
      const cache = makeNode('CPU cache / store buffer', 'text', 'Local execution can temporarily diverge from shared visibility.', shared, 's1');
      const scheduler = makeNode('time slice', 'text', 'Interleavings create many legal traces; synchronization prunes them.', threads, 's3');

      [
        [write, volatileWrite, 'program order'],
        [volatileWrite, readFlag, 'synchronizes-with'],
        [readFlag, readX, 'visibility'],
        [mutex, counter, 'guards'],
        [scheduler, write, 'runs A'],
        [scheduler, readFlag, 'runs B'],
        [cache, write, 'buffers'],
        [counter, readX, 'shared state'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));

      emit('layout.apply.tidy');
      emit('view.fit.all');
    });

    on('demo.run-jira', () => {
      clearGraph();
      const board = makeContainer('JIRA Workflow', { x: 0, y: 0 }, ['Backlog', 'In progress', 'Review', 'Done'], 'columns');
      const idea = makeNode('Clarify request', 'text', 'Question, acceptance criteria, and rough slices.', board, 's1');
      const build = makeNode('Implement slice', 'square', 'Code + local verification.', board, 's2');
      const review = makeNode('Review / QA', 'circle', 'Check behavior, edge cases, and regressions.', board, 's3');
      const done = makeNode('Release note', 'text', 'Merge once quality gates and story are clear.', board, 's4');
      [
        [idea, build, 'ready'],
        [build, review, 'PR'],
        [review, done, 'approved'],
      ].forEach(([From, To, label]) => emit('graph.edge.create', { From, To, Label: { text: label } }));
      emit('layout.apply.tidy');
      emit('view.fit.all');
    });
  }, { requires: ['graph', 'render', 'containers'] });
}
