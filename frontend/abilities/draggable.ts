import { itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { ItemRef, Position } from '../types';
import { ability, action } from './shared';
import type { Positioned } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'drag.item.start': { ref: ItemRef; x: number; y: number };
    'drag.item.move': { x: number; y: number };
    'drag.item.end': void;
    'drag.item.moved': { ref: ItemRef };
  }
}

/** Draggable — any item with a `Position` can be moved by pointer drag.
 *  The ability declares the drag handle slot; the renderer places it. */
export const draggable = <T extends Positioned>() => ability<T>('draggable', [action<T>({
  id: 'item.drag',
  label: 'Drag with pointer',
  ui: [{
    surface: 'entity',
    command: 'drag.item.start',
    kind: 'handler',
    slot: Slots.Drag,
    attrs: { 'data-drag-handle': '', role: 'button', 'aria-label': 'Drag item', title: 'Drag item' },
  }],
})]);

export function registerDraggable(system: Registry) {
  system('ability.draggable', ({ on, emit, contexts, graphs, perf }) => {
    let drag: { ref: ItemRef; pointer: Position; start: Position } | null = null;
    // Only the last pointer position matters per frame (commands.ts COALESCE
    // batching ensures drag.item.move fires at most once per rAF).  We apply
    // the update inline — no frameLoop schedule — so the render-stage draw
    // runs synchronously and we save an extra rAF cycle vs. scheduling a
    // separate drag.commit callback.
    let pending: Position | null = null;

    const applyMove = () => {
      const d = drag;
      const p = pending;
      if (!d || !p) return;
      pending = null;
      const t0 = perf.enabled() ? performance.now() : 0;
      const pointer = contexts.view.clientToSpace(Places.Stage, p);
      const Position = { x: d.start.x + pointer.x - d.pointer.x, y: d.start.y + pointer.y - d.pointer.y };
      // Silent store write — no item.update, no storage handler dispatch.
      graphs.current.updateNode(d.ref.id, { Position });
      // Emit the fact to drive the normal render path (mark → frameLoop →
      // flushDirty → debug log).  Named listeners (present, node-visuals,
      // node-autosize) are cheap: present is a no-op unless active,
      // node-visuals defers to microtask, node-autosize skips Position-only.
      const gid = graphs.current.id;
      emit('graph.node.updated', { graphId: gid, id: d.ref.id, patch: { Position } });
      if (perf.enabled()) {
        perf.count('Drag.move');
        perf.sample('Drag.move.ms', performance.now() - t0);
      }
    };

    contexts.commands.register([
      {
        id: 'drag.item.start',
        label: 'Start drag',
        group: 'drag',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-drag-handle]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
        payload: ({ event, target }) => {
          const ref = itemRefFrom(target);
          return ref ? { ref, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY } : undefined;
        },
      },
      {
        id: 'drag.item.move',
        label: 'Move dragged item',
        group: 'drag',
        hidden: true,
        input: { on: 'pointermove', when: () => !!drag, prevent: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      { id: 'drag.item.end', label: 'End drag', group: 'drag', hidden: true, input: { on: 'pointerup', when: () => !!drag } },
    ]);

    on('drag.item.start', ({ ref, x, y }) => {
      const item = graphs.current.getItem(ref) as Positioned | undefined;
      if (item?.Position) drag = { ref, pointer: contexts.view.clientToSpace(Places.Stage, { x, y }), start: { ...item.Position } };
    });
    on('drag.item.move', ({ x, y }) => {
      if (!drag) return;
      pending = { x, y };
      applyMove();
    });
    on('drag.item.end', () => {
      const d = drag;
      if (pending && d) applyMove();
      // Single item.update on drop — fires facts, syncs storage / outline / hierarchy.
      if (d) {
        const node = graphs.current.getNode(d.ref.id) as Positioned | undefined;
        if (node?.Position) emit('item.update', { ref: d.ref, patch: { Position: node.Position } });
      }
      drag = null;
      pending = null;
    });
  });
}
