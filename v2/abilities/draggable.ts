import { itemIdFrom, type Registry } from '../core';
import { Places } from '../types';
import type { Id, NodeEntity, Position } from '../types';
import { ability, action } from './shared';

export const draggable = <T extends NodeEntity>() => ability<T>('draggable', [action<T>({
  id: 'node.drag',
  label: 'Drag node with pointer',
  ui: [{ surface: 'entity', command: 'drag.node.start', kind: 'handler', slot: 'header', attrs: { 'data-drag-handle': '' } }],
})]);

export function registerDraggable(system: Registry) {
  system('ability.draggable', ({ on, emit, contexts, graphs }) => {
    let drag: { id: Id; pointer: Position; start: Position } | null = null;

    contexts.commands.register([
      {
        id: 'drag.node.start',
        label: 'Start drag',
        event: 'drag.node.start',
        group: 'drag',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-drag-handle]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
        payload: ({ event, target }) => ({ id: itemIdFrom(target), x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'drag.node.move',
        label: 'Move dragged node',
        event: 'drag.node.move',
        group: 'drag',
        hidden: true,
        input: { on: 'pointermove', when: () => !!drag, prevent: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      { id: 'drag.node.end', label: 'End drag', event: 'drag.node.end', group: 'drag', hidden: true, input: { on: 'pointerup', when: () => !!drag } },
    ]);

    on('drag.node.start', ({ id, x, y }) => {
      const node = graphs.current.getNode(id);
      if (node?.Position) drag = { id, pointer: contexts.view.clientToSpace(Places.Stage, { x, y }), start: { ...node.Position } };
    });
    on('drag.node.move', ({ x, y }) => {
      if (!drag) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
      emit('graph.node.update', { id: drag.id, patch: { Position: { x: drag.start.x + pointer.x - drag.pointer.x, y: drag.start.y + pointer.y - drag.pointer.y } } });
      emit('drag.node.moved', { id: drag.id });
    });
    on('drag.node.end', () => { drag = null; });
  });
}
