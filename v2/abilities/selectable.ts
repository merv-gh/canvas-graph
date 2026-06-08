import { isStageSurface, itemIdFrom, itemRefFrom, nodeRef, type Registry } from '../core';
import { Places } from '../types';
import type { CommandSource, NodeEntity } from '../types';
import { ability, action } from './shared';

export const selectable = <T extends NodeEntity>() => ability<T>('selectable', [action<T>({
  id: 'node.select',
  label: 'Select node',
  paletteCommand: 'selection.node.next',
  ui: [{ surface: 'entity', command: 'selection.node.select', kind: 'handler' }],
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
        event: 'selection.item.select',
        group: 'selection',
        hidden: true,
        input: {
          on: 'pointerdown',
          selector: '[data-item-kind][data-item-id]',
          when: event => !(event.target as Element).closest('[data-command], [data-drag-handle]'),
          prevent: true,
          stop: true,
        },
        payload: source => itemRefFrom(source.target) ?? nodeRef(nodeId(source)),
      },
      {
        id: 'selection.node.select',
        label: 'Select node',
        event: 'selection.node.select',
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
        // No own Escape / pointerdown binding — selection registers a
        // Cancellable so the global cancellation system clears it on Esc or
        // stage background click. Command stays callable from palette.
        id: 'selection.node.clear',
        label: 'Clear selection',
        event: 'selection.node.clear',
        group: 'selection',
        available: () => !!selection.selected(),
      },
      {
        id: 'selection.item.delete',
        label: 'Delete selection',
        event: 'selection.item.delete',
        group: 'selection',
        shortcut: 'X',
        input: { on: 'keydown', key: 'x', prevent: true },
        available: () => {
          const ref = selection.selected();
          return ref?.kind === 'node' || ref?.kind === 'edge';
        },
      },
    ]);

    on('selection.node.select', ({ id }) => emit('selection.item.select', nodeRef(id)));
    on('selection.node.clear', () => emit('selection.item.clear'));
    on('selection.item.select', ref => {
      selection.select(ref);
      contexts.itemModes.set(origin, 'selected', [ref]);
      emit('selection.item.selected', ref);
      emit('selection.node.selected', { id: ref.kind === 'node' ? ref.id : null });
      emit('focus.item.focus', ref);
    });
    on('selection.item.clear', () => {
      selection.select(null);
      contexts.itemModes.unregisterOrigin(origin);
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
      // Background mode — only fires when nothing more specific (modal,
      // picker, edit, jump) is active for the same Escape / stage click.
      priority: -10,
      active: () => !!selection.selected(),
      cancel: () => emit('selection.item.clear'),
    });
  });
}
