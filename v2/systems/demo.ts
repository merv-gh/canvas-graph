import type { Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'demo.run-self': void;
  }
}

/** demo.run-self renders the live composition graph: every system, ability, and
 *  feature flagged ON appears as a node connected to a 'core' root. The list is
 *  derived from flags.declared() — adding a new system or ability shows up here
 *  automatically. Disabled flags are skipped. */
export function registerDemo(system: Registry) {
  system('demo', ({ on, emit, contexts, graphs, flags, selection, contribute }) => {
    contribute({ surface: 'top', command: 'demo.render-self', kind: 'button', text: '★ Self', order: 60 });
    contexts.commands.register([{
      id: 'demo.render-self',
      label: 'Render self-graph',
      event: 'demo.run-self',
      group: 'demo',
    }]);

    on('demo.run-self', () => {
      graphs.current.nodes().slice().forEach(node => emit('graph.node.delete', { id: node.id }));
      emit('editing.node.create', { Label: { text: 'core' } });
      const root = selection.selectedNode()?.id;
      if (!root) return;
      emit('focus.node.focus', { id: root });

      const buckets = (['system', 'ability', 'feature'] as const)
        .flatMap(kind => flags.declared(kind).filter(name => flags.isOn(name)));

      buckets.forEach(name => emit('editing.node.create', {
        Label: { text: name },
        connectFrom: root,
        keepFocus: true,
      }));

      emit('layout.apply.tidy');
      emit('view.fit.all');

      console.info('[demo] self-graph rendered via bus', {
        roots: 1,
        nodes: buckets.length + 1,
        kinds: { system: flags.declared('system').length, ability: flags.declared('ability').length, feature: flags.declared('feature').length },
      });
    });
  });
}
