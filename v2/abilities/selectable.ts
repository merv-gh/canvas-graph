import { isStageSurface, itemIdFrom, itemRefFrom, nodeRef, type Registry } from '../core';
import type { CommandSource, Id, ItemRef } from '../types';
import { ability, action } from './shared';
import type { Identified } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'selection.item.select': ItemRef;
    'selection.item.clear': void;
    'selection.item.delete': void;
    'selection.item.selected': ItemRef | null;
    'selection.node.select': { id: Id };
    'selection.node.clear': void;
    'selection.node.selected': { id: Id | null };
  }
}

/** Selectable — every entity that has an id can have this. The pointerdown
 *  handler is registered globally (looks for [data-item-kind][data-item-id]) so
 *  no template slot is required; declaring the ability is enough.
 *  Keyboard reachability: the entity-surface UI handler is the affordance; no
 *  paletteCommand because there's no concept of "select THIS item via keyboard"
 *  outside of Tab cycling (which lives as its own standalone command). */
export const selectable = <T extends Identified>() => ability<T>('selectable', [action<T>({
  id: 'item.select',
  label: 'Select item',
  ui: [{ surface: 'entity', command: 'selection.item.select', kind: 'handler' }],
})]);

export function registerSelectable(system: Registry) {
  system('ability.selectable', ({ on, emit, contexts, graphs, selection, origin }) => {
    const selectedNodeId = () => selection.selectedNode()?.id ?? null;
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || selectedNodeId() || '';
    const nextNodeId = () => {
      const nodes = graphs.current.nodes();
      const index = Math.max(0, nodes.findIndex(node => node.id === selectedNodeId()));
      return nodes[(index + 1) % nodes.length]?.id ?? nodes[0]?.id ?? '';
    };
    const previousNodeId = () => {
      const nodes = graphs.current.nodes();
      const index = nodes.findIndex(node => node.id === selectedNodeId());
      return nodes[(index <= 0 ? nodes.length : index) - 1]?.id ?? nodes[0]?.id ?? '';
    };

    contexts.commands.register([
      {
        id: 'selection.item.select',
        label: 'Select item',
        group: 'selection',
        hidden: true,
        input: {
          on: 'pointerdown',
          selector: '[data-item-kind][data-item-id]',
          when: event => !(event.target as Element).closest('[data-command], [data-drag-handle], [data-resize-handle]'),
          prevent: true,
          stop: true,
        },
        payload: source => itemRefFrom(source.target) ?? nodeRef(nodeId(source)),
      },
      {
        id: 'selection.node.select',
        label: 'Select node',
        group: 'selection',
        hidden: true,
        payload: source => ({ id: nodeId(source) }),
      },
      {
        id: 'selection.node.next',
        label: 'Select next node',
        event: 'selection.node.select',
        group: 'selection',
        shortcut: 'Tab',
        input: { on: 'keydown', key: 'Tab', prevent: true },
        available: () => graphs.current.nodes().length > 0,
        payload: () => ({ id: nextNodeId() }),
      },
      {
        id: 'selection.node.previous',
        label: 'Select previous node',
        event: 'selection.node.select',
        group: 'selection',
        shortcut: 'Shift+Tab',
        input: { on: 'keydown', key: 'Tab', shift: true, prevent: true },
        available: () => graphs.current.nodes().length > 0,
        payload: () => ({ id: previousNodeId() }),
      },
      {
        id: 'selection.node.clear',
        label: 'Clear selection',
        group: 'selection',
        available: () => !!selection.selected(),
      },
      {
        id: 'selection.item.delete',
        label: 'Delete selection',
        group: 'selection',
        shortcut: 'X',
        input: { on: 'keydown', key: 'x', prevent: true },
        // Any selection is potentially deletable. Each kind's owner handles its
        // own delete listener; the command stays open so containers / future
        // kinds can hook in without selectable knowing the kind exists.
        available: () => !!selection.selected(),
      },
    ]);

    on('selection.node.select', ({ id }) => emit('selection.item.select', nodeRef(id)));
    on('selection.node.clear', () => emit('selection.item.clear'));
    on('selection.item.select', ref => {
      selection.select(ref);
      contexts.decorations.modes.set(origin, 'selected', [ref]);
      emit('selection.item.selected', ref);
      emit('selection.node.selected', { id: ref.kind === 'node' ? ref.id : null });
      emit('focus.item.focus', ref);
    });
    on('selection.item.clear', () => {
      selection.select(null);
      contexts.decorations.unregisterOrigin(origin);
      emit('selection.item.selected', null);
      emit('selection.node.selected', { id: null });
      emit('focus.item.clear');
    });
    on('selection.item.delete', () => {
      const ref = selection.selected();
      if (ref?.kind === 'node') emit('graph.node.delete', { id: ref.id });
      if (ref?.kind === 'edge') emit('graph.edge.delete', { id: ref.id });
    });
    contexts.cancellation.register({
      origin,
      priority: -10,
      active: () => !!selection.selected(),
      cancel: () => emit('selection.item.clear'),
    });
  });
}
