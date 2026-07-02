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
  system('ability.draggable', ({ on, emit, contexts, graphs }) => {
    let drag: { ref: ItemRef; pointer: Position; start: Position } | null = null;
    let pending: Position | null = null;
    let scheduled = false;
    const applyPending = () => {
      scheduled = false;
      if (!drag || !pending) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, pending);
      pending = null;
      const Position = { x: drag.start.x + pointer.x - drag.pointer.x, y: drag.start.y + pointer.y - drag.pointer.y };
      emit('item.update', { ref: drag.ref, patch: { Position } });
      emit('drag.item.moved', { ref: drag.ref });
    };
    const scheduleMove = (point: Position) => {
      pending = point;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(applyPending);
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
    on('drag.item.move', ({ x, y }) => { if (drag) scheduleMove({ x, y }); });
    on('drag.item.end', () => {
      if (pending) applyPending();
      drag = null;
      pending = null;
    });
  });
}
