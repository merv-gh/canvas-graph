import { isStageSurface, itemIdFrom, type Registry } from '../core';
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
  system('ability.selectable', ({ on, emit, contexts, graphs, selection }) => {
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || selection.selected() || '';
    const nextNodeId = () => {
      const nodes = graphs.current.nodes();
      const index = Math.max(0, nodes.findIndex(node => node.id === selection.selected()));
      return nodes[(index + 1) % nodes.length]?.id ?? nodes[0]?.id ?? '';
    };

    contexts.commands.register([
      {
        id: 'selection.node.select',
        label: 'Select node',
        event: 'selection.node.select',
        group: 'selection',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-node-id]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
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
        id: 'selection.node.clear',
        label: 'Clear selection',
        event: 'selection.node.clear',
        group: 'selection',
        available: () => !!selection.selected(),
        input: { on: 'pointerdown', selector: `[data-place="${Places.Stage}"]`, when: isStageSurface },
      },
    ]);

    on('selection.node.select', ({ id }) => { selection.select(id); emit('selection.node.selected', { id }); });
    on('selection.node.clear', () => { selection.select(null); emit('selection.node.selected', { id: null }); });
  });
}
