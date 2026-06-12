import { itemFoldId, itemRefFrom, type Registry } from '../core';
import { Slots, type CommandSource } from '../types';
import { ability, action } from './shared';
import type { Identified } from './shapes';

/** Collapsible — fold an item ("less detail"). Collapse is fold *state* (the
 *  shared `fold` store, Principle 18), not item data: toggling emits
 *  `fold.toggle` for the item's fold id, exactly like an outline section or zen.
 *  The item's rendered appearance (collapsed badge / `.collapsed` class) shows
 *  the open/closed state. */
export const collapsible = <T extends Identified>() => ability<T>('collapsible', [action<T>({
  id: 'item.collapse',
  label: 'Fold',
  paletteCommand: 'item.collapse.toggle',
  ui: [{
    surface: 'entity',
    command: 'item.collapse.toggle',
    kind: 'button',
    slot: Slots.HeaderStart,
    className: 'node-action node-toggle',
    // Same fold chevron as outline sections. Static glyph — the affordance can't
    // read fold state; the item's collapsed appearance shows open/closed.
    text: '▾',
    label: 'Toggle fold',
  }],
})]);

export function registerCollapsible(system: Registry) {
  system('ability.collapsible', ({ contexts, graphs, selection }) => {
    const refFromSource = (source: CommandSource) => itemRefFrom(source.target) ?? selection.selected();

    contexts.commands.register([{
      id: 'item.collapse.toggle',
      label: 'Toggle fold',
      event: 'fold.toggle',
      group: 'item',
      shortcut: 'C',
      input: { on: 'keydown', key: 'c', prevent: true },
      available: source => !!refFromSource(source ?? {}),
      payload: source => {
        const ref = refFromSource(source);
        return ref ? { id: itemFoldId(ref, graphs.current.id) } : undefined;
      },
    }]);
  }, { requires: ['ability.selectable'] });
}
