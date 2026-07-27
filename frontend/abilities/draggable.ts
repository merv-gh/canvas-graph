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
    // batching ensures drag.item.move fires at most once per rAF).
    let pending: Position | null = null;
    let captured: { el: Element; id: number } | null = null;

    const applyMove = () => {
      const d = drag;
      const p = pending;
      if (!d || !p) return;
      pending = null;
      const t0 = perf.enabled() ? performance.now() : 0;
      const pointer = contexts.view.clientToSpace(Places.Stage, p);
      const Position = { x: d.start.x + pointer.x - d.pointer.x, y: d.start.y + pointer.y - d.pointer.y };
      if (d.ref.kind === 'node') {
        // Hot node path stays direct: no generic storage dispatch per frame.
        graphs.current.updateNode(d.ref.id, { Position });
        emit('graph.node.updated', { graphId: graphs.current.id, id: d.ref.id, patch: { Position }, visual: true });
      } else {
        // Plugin entities (containers today) own their storage. Generic update
        // makes their advertised draggable ability real and preserves cascades.
        emit('item.update', { ref: d.ref, patch: { Position } });
      }
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
        input: { on: 'pointerdown', selector: '[data-drag-handle]', when: event => !(event.target as Element).closest('.stage.ink-erasing, [data-command]'), prevent: true },
        payload: ({ event, target }) => {
          const e = event as PointerEvent;
          // Pointer capture keeps pointermove firing even after the pointer
          // leaves the handle element — prevents event starvation at high speed.
          if (target instanceof Element && typeof (target as HTMLElement).setPointerCapture === 'function') {
            (target as HTMLElement).setPointerCapture(e.pointerId);
            captured = { el: target, id: e.pointerId };
          }
          const ref = itemRefFrom(target);
          return ref ? { ref, x: e.clientX, y: e.clientY } : undefined;
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
      // Release pointer capture.
      if (captured) {
        try { (captured.el as HTMLElement).releasePointerCapture?.(captured.id); } catch { /* already released */ }
        captured = null;
      }
      // Single item.update on drop — fires facts, syncs storage / outline / hierarchy.
      if (d) {
        const item = graphs.current.getItem(d.ref) as Positioned | undefined;
        if (item?.Position && d.ref.kind === 'node') emit('item.update', { ref: d.ref, patch: { Position: item.Position } });
        if (item?.Position) emit('drag.item.moved', { ref: d.ref });
      }
      drag = null;
      pending = null;
    });
  });
}
