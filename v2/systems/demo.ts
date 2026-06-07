import type { Registry } from '../core';

export function registerDemo(system: Registry) {
  system('demo', ({ on, emit, contexts, graphs, selection, contribute }) => {
    contribute({ surface: 'top', command: 'demo.render-self', kind: 'button', text: '★ Self', order: 60 });
    contexts.commands.register([{
      id: 'demo.render-self',
      label: 'Render self-graph',
      event: 'demo.run-self',
      group: 'demo',
    }]);

    on('demo.run-self', () => {
      const stats = { events: 0, nodeEvents: 0, edgeEvents: 0, focusEvents: 0, layoutEvents: 0 };
      graphs.current.nodes().slice().forEach(node => {
        emit('graph.node.delete', { id: node.id }); stats.events++; stats.nodeEvents++;
      });
      emit('editing.node.create', { Label: { text: 'core' } }); stats.events++; stats.nodeEvents++;
      const root = selection.selected();
      if (!root) return;
      emit('focus.node.focus', { id: root }); stats.events++; stats.focusEvents++;

      const groups: Array<{ prefix: string; items: string[] }> = [
        { prefix: '',         items: ['render', 'input', 'main', 'log', 'outline', 'modal', 'commandModal',
                                       'domain', 'graph', 'view.zoom', 'view.pan', 'focus', 'layout', 'dx', 'demo'] },
        { prefix: 'ability.', items: ['selectable', 'draggable', 'nudgeable', 'collapsible', 'editable', 'configurable'] },
        { prefix: 'feature.', items: ['nodeLifecycle'] },
      ];

      groups.forEach(({ prefix, items }) => items.forEach(name => {
        emit('editing.node.create', {
          Label: { text: prefix + name },
          connectFrom: root,
          keepFocus: true,
        });
        stats.events += 2;
        stats.nodeEvents++;
        stats.edgeEvents++;
      }));

      emit('layout.apply.tidy'); stats.events++; stats.layoutEvents++;
      emit('view.fit.all'); stats.events++;

      console.info('[demo] self-graph rendered via bus', {
        ...stats,
        passedThrough: 'editing.node.create + connectFrom + keepFocus + layout.apply.tidy + view.fit.all',
        gapsRemaining: [
          'Edge labels (e.g. "depends-on") not yet set on connectFrom-created edges — need a hint.',
          'Long titles overflow the fixed node size — need auto-size from content.',
          'No way yet to encode "this node represents a flag with state X" — could be a properties-driven badge.',
        ],
      });
    });
  });
}
