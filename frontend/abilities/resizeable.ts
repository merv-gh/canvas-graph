import { itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { EntityDef, ItemRef, Position, Rect, Size } from '../types';
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
  system('ability.resizeable', ({ on, emit, contexts, graphs, model }) => {
    let resize: { ref: ItemRef; pointer: Position; topLeft: Position } | null = null;
    const itemRect = (ref: ItemRef, item: Sized & { Position?: Position }): Rect | null => {
      const entity = model.entity(ref.kind) as EntityDef<unknown> | undefined;
      const rendered = entity?.render?.bounds?.(item);
      if (rendered) return rendered;
      if (!item.Position) return null;
      return {
        x: item.Position.x - item.Size.w / 2,
        y: item.Position.y - item.Size.h / 2,
        w: item.Size.w,
        h: item.Size.h,
      };
    };

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
      if (!item?.Size) return;
      const rect = itemRect(ref, item);
      if (!rect) return;
      resize = {
        ref,
        pointer: contexts.view.clientToSpace(Places.Stage, { x, y }),
        topLeft: { x: rect.x, y: rect.y },
      };
    });
    on('resize.item.move', ({ x, y }) => {
      if (!resize) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
      const w = Math.max(40, pointer.x - resize.topLeft.x);
      const h = Math.max(40, pointer.y - resize.topLeft.y);
      const Position = { x: resize.topLeft.x + w / 2, y: resize.topLeft.y + h / 2 };
      // Setting Size also flips AutoFit off — storage systems that don't track
      // AutoFit just ignore the field.
      emit('item.update', { ref: resize.ref, patch: { Size: { w, h }, Position, AutoFit: false } });
      emit('resize.item.changed', { ref: resize.ref });
    });
    on('resize.item.end', () => { resize = null; });
  }, { requires: ['ability.selectable'] });
}
