import { itemIdFrom, itemRefFrom, type Registry } from '../core';
import { Slots, type CommandSource } from '../types';
import { ability, action } from './shared';
import type { Collapsable } from './shapes';
// Uses the generic 'item.update' framework event — no CustomEvents add here.

export const collapsible = <T extends Collapsable>() => ability<T>('collapsible', [action<T>({
  id: 'item.collapse',
  label: 'Collapse',
  paletteCommand: 'item.collapse.toggle',
  ui: [{
    surface: 'entity',
    command: 'item.collapse.toggle',
    kind: 'button',
    slot: Slots.HeaderStart,
    className: 'node-action node-toggle',
    text: item => item.Collapsed ? '+' : '-',
    label: item => item.Collapsed ? 'Expand' : 'Collapse',
  }],
})]);

export function registerCollapsible(system: Registry) {
  system('ability.collapsible', ({ contexts, graphs, selection }) => {
    const refFromSource = (source: CommandSource) => itemRefFrom(source.target) ?? selection.selected();

    contexts.commands.register([{
      id: 'item.collapse.toggle',
      label: 'Toggle collapse',
      event: 'item.update',
      group: 'item',
      shortcut: 'C',
      input: { on: 'keydown', key: 'c', prevent: true },
      available: source => !!refFromSource(source ?? {}),
      payload: source => {
        const ref = refFromSource(source);
        if (!ref) return undefined;
        const item = graphs.current.getItem(ref) as Collapsable | undefined;
        if (!item) return undefined;
        return { ref, patch: { Collapsed: !item.Collapsed } };
      },
    }]);
  }, { requires: ['ability.selectable'] });
}
