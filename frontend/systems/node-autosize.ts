import type { Registry } from '../core';
import type { GraphNode } from '../model';
import { estimateTextSize } from './text-layout';

/** Sizes a node's box to fit its title + description (and every newline within),
 *  so text never overflows and boxes look proportional to their content.
 *
 *  Auto-sizing yields to manual resize: we remember the last size we applied per
 *  node; if the current size differs from that, the user dragged the resize
 *  handle and we stop touching it. Text edits on an auto-sized node re-fit it. */
export function registerNodeAutosize(system: Registry) {
  system('node.autosize', ({ on, emit, graphs }) => {
    const autoSized = new Map<string, { w: number; h: number }>();
    const sameSize = (a?: { w: number; h: number }, b?: { w: number; h: number }) =>
      !!a && !!b && a.w === b.w && a.h === b.h;

    const fit = (node: GraphNode) =>
      estimateTextSize({ title: node.Label?.text ?? '', description: node.Description });

    const apply = (id: string) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      const prev = autoSized.get(id);
      // Manual resize detected — current size is not what we last set. Back off.
      if (node.Size && prev && !sameSize(node.Size, prev)) return;
      const next = fit(node);
      autoSized.set(id, next);
      if (!sameSize(node.Size, next)) emit('item.update', { ref: { kind: 'node', id }, patch: { Size: next } });
    };

    on('graph.node.created', ({ id }) => apply(id));
    on('graph.node.updated', ({ id }) => apply(id));
    // Bulk import (`graph.import.snapshot` → replace) never emits per-node
    // `created`, so size every node once the imported graph lands.
    on('graph.imported', () => { autoSized.clear(); graphs.current.nodes().forEach(node => apply(node.id)); });
  }, { requires: ['graph'] });
}
