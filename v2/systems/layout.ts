import type { Registry } from '../core';

export function registerLayout(system: Registry) {
  system('layout', ({ on, emit, contexts, graphs, selection, contribute }) => {
    contribute({ surface: 'top', command: 'layout.apply.tidy', kind: 'button', text: 'Tidy', order: 65 });
    contribute({ surface: 'top', command: 'layout.apply.radial', kind: 'button', text: 'Radial', order: 66 });
    contexts.commands.register([
      { id: 'layout.apply.radial', label: 'Radial layout', event: 'layout.apply.radial', group: 'layout', input: { on: 'keydown', key: 'r', prevent: true } },
      { id: 'layout.apply.grid',   label: 'Grid layout',   event: 'layout.apply.grid',   group: 'layout', input: { on: 'keydown', key: 'G', shift: true, prevent: true } },
      { id: 'layout.apply.tidy',   label: 'Tidy tree layout', event: 'layout.apply.tidy', group: 'layout', input: { on: 'keydown', key: 't', prevent: true } },
    ]);

    on('layout.apply.radial', () => {
      const g = graphs.current;
      const focusedId = selection.focusedNode()?.id ?? selection.selectedNode()?.id;
      const all = g.nodes();
      const root = focusedId ? g.getNode(focusedId) : all[0];
      if (!root) return;
      const others = all.filter(n => n.id !== root.id);
      const radius = Math.max(160, 60 + others.length * 22);
      const center = root.Position ?? { x: 0, y: 0 };
      others.forEach((n, i) => {
        const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
        emit('graph.node.update', { id: n.id, patch: { Position: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius } } });
      });
    });

    on('layout.apply.grid', () => {
      const all = graphs.current.nodes();
      const cols = Math.max(1, Math.ceil(Math.sqrt(all.length)));
      const colSize = 200, rowSize = 100;
      const startX = -((cols - 1) * colSize) / 2;
      const startY = -((Math.ceil(all.length / cols) - 1) * rowSize) / 2;
      all.forEach((n, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        emit('graph.node.update', { id: n.id, patch: { Position: { x: startX + col * colSize, y: startY + row * rowSize } } });
      });
    });

    on('layout.apply.tidy', () => {
      const g = graphs.current;
      const all = g.nodes();
      const inDeg = new Map<string, number>(all.map(n => [n.id, 0]));
      g.edges().forEach(e => inDeg.set(e.To, (inDeg.get(e.To) ?? 0) + 1));
      const roots = all.filter(n => (inDeg.get(n.id) ?? 0) === 0);
      if (!roots.length) return;
      const level = new Map<string, number>();
      const queue: string[] = [];
      roots.forEach(r => { level.set(r.id, 0); queue.push(r.id); });
      while (queue.length) {
        const id = queue.shift()!;
        const lv = level.get(id)!;
        g.edges().filter(e => e.From === id).forEach(e => {
          if (!level.has(e.To)) { level.set(e.To, lv + 1); queue.push(e.To); }
        });
      }
      const byLevel = new Map<number, string[]>();
      all.forEach(n => {
        const lv = level.get(n.id) ?? 0;
        (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)!).push(n.id);
      });
      const rowH = 130;
      byLevel.forEach((ids, lv) => {
        const spread = (ids.length - 1) * 180;
        ids.forEach((id, i) => {
          emit('graph.node.update', { id, patch: { Position: { x: -spread / 2 + i * 180, y: lv * rowH } } });
        });
      });
    });
  });
}
