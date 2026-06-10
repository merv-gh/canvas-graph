import { itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { ItemRef, Position, Size } from '../types';
import { ability, action } from './shared';
import type { Sized } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'resize.item.start': { ref: ItemRef; x: number; y: number };
    'resize.item.move': { x: number; y: number };
    'resize.item.end': void;
    'resize.item.changed': { ref: ItemRef };
  }
}

/** Resizeable — any item with a `Size` can be resized by dragging a corner handle.
 *  The renderer must surface a `[data-resize-handle]` element somewhere on the
 *  item; the ability declaration only contributes the affordance metadata.
 *  Side effect on commit: a manual resize sets `AutoFit: false` on the item if
 *  the storage system supports auto-fit (containers do). Other kinds just get
 *  their Size updated. */
export const resizeable = <T extends Sized>() => ability<T>('resizeable', [action<T>({
  id: 'item.resize',
  label: 'Resize',
  ui: [{
    surface: 'entity',
    command: 'resize.item.start',
    kind: 'handler',
    slot: Slots.Resize,
    attrs: { 'data-resize-handle': '', role: 'button', 'aria-label': 'Resize item', title: 'Resize item' },
  }],
})]);

export function registerResizeable(system: Registry) {
  system('ability.resizeable', ({ on, emit, contexts, graphs }) => {
    let resize: { ref: ItemRef; pointer: Position; start: Size; centre: Position } | null = null;

    contexts.commands.register([
      {
        id: 'resize.item.start',
        label: 'Start resize',
        group: 'resize',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-resize-handle]', prevent: true, stop: true },
        payload: ({ event, target }) => {
          const ref = itemRefFrom(target);
          return ref ? { ref, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY } : undefined;
        },
      },
      {
        id: 'resize.item.move',
        label: 'Resize item',
        group: 'resize',
        hidden: true,
        input: { on: 'pointermove', when: () => !!resize, prevent: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'resize.item.end',
        label: 'End resize',
        group: 'resize',
        hidden: true,
        input: { on: 'pointerup', when: () => !!resize },
      },
    ]);

    on('resize.item.start', ({ ref, x, y }) => {
      const item = graphs.current.getItem(ref) as Sized & { Position?: Position } | undefined;
      if (!item?.Size || !item.Position) return;
      resize = {
        ref,
        pointer: contexts.view.clientToSpace(Places.Stage, { x, y }),
        start: { ...item.Size },
        centre: { ...item.Position },
      };
    });
    on('resize.item.move', ({ x, y }) => {
      if (!resize) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
      // Corner handle is at (centre + Size/2). New size = 2 * (pointer - centre).
      const w = Math.max(40, (pointer.x - resize.centre.x) * 2);
      const h = Math.max(40, (pointer.y - resize.centre.y) * 2);
      // Setting Size also flips AutoFit off — storage systems that don't track
      // AutoFit just ignore the field.
      emit('item.update', { ref: resize.ref, patch: { Size: { w, h }, AutoFit: false } });
      emit('resize.item.changed', { ref: resize.ref });
    });
    on('resize.item.end', () => { resize = null; });
  }, { requires: ['ability.selectable'] });
}
