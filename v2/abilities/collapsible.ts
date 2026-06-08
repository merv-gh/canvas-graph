import { itemIdFrom, nodeRef, type Registry } from '../core';
import type { NodeEntity } from '../model';
import type { CommandSource } from '../types';
import { ability, action } from './shared';
// Uses the generic 'item.update' framework event — no CustomEvents add here.

export const collapsible = <T extends NodeEntity>() => ability<T>('collapsible', [action<T>({
  id: 'node.collapse',
  label: 'Collapse node',
  paletteCommand: 'node.collapse.toggle',
  ui: [{
    surface: 'entity',
    command: 'node.collapse.toggle',
    kind: 'button',
    slot: 'header:start',
    className: 'node-action node-toggle',
    text: node => node.Collapsed ? '+' : '-',
    label: node => node.Collapsed ? 'Expand node' : 'Collapse node',
  }],
})]);

export function registerCollapsible(system: Registry) {
  system('ability.collapsible', ({ contexts, graphs, selection }) => {
    const selectedNode = () => selection.selectedNode();
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || selectedNode()?.id || '';

    contexts.commands.register([{
      id: 'node.collapse.toggle',
      label: 'Toggle node collapse',
      event: 'item.update',
      group: 'node',
      shortcut: 'C',
      input: { on: 'keydown', key: 'c', prevent: true },
      available: source => !!nodeId(source ?? {}) || !!selectedNode(),
      payload: source => {
        const id = nodeId(source) || selectedNode()?.id || graphs.current.nodes()[0]?.id || '';
        const node = graphs.current.getNode(id)!;
        return { ref: nodeRef(id), patch: { Collapsed: !node.Collapsed } };
      },
    }]);
  });
}
