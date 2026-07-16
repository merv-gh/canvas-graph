import { itemFoldId, itemRefFrom, type Registry } from '../core';
import { Slots, type CommandSource } from '../types';
import { ability, action } from './shared';
import type { Identified } from './shapes';

/** Collapsible — fold an item ("less detail"). Collapse is fold *state* (the
 *  shared `fold` store, Principle 18), not item data: toggling emits
 *  `fold.toggle` for the item's fold id, exactly like an outline section or zen.
 *  The item's rendered appearance (collapsed badge / `.collapsed` class) shows
 *  the open/closed state. */
export const collapsible = <T extends Identified>(when: (item: T) => boolean = () => true) => ability<T>('collapsible', [action<T>({
  id: 'item.collapse',
  label: 'Fold',
  paletteCommand: 'item.collapse.toggle',
  ui: [{
    surface: 'entity',
    command: 'item.collapse.toggle',
    kind: 'button',
    when,
    slot: Slots.HeaderStart,
    className: 'node-action node-toggle',
    // The floating toolbar replaces this with the state-aware maximize/minimize
    // glyph. Keep the expanded-state glyph for any inline entity surface.
    text: '⊟',
    label: 'Toggle fold',
  }],
})]);

export function registerCollapsible(system: Registry) {
  system('ability.collapsible', ({ on, contexts, graphs, selection }) => {
    const refFromSource = (source: CommandSource) => itemRefFrom(source.target) ?? selection.selected();
    const canFold = (ref: ReturnType<typeof refFromSource>) => {
      if (!ref) return false;
      if (ref.kind !== 'node') return true;
      return !!graphs.current.getNode(ref.id)?.Description?.trim();
    };

    contexts.commands.register([
      {
        id: 'item.collapse.toggle',
        label: 'Toggle fold',
        event: 'fold.toggle',
        group: 'item',
        shortcut: 'C',
        input: { on: 'keydown', key: 'c', prevent: true },
        available: source => canFold(refFromSource(source ?? {})),
        payload: source => {
          const ref = refFromSource(source);
          return canFold(ref) ? { id: itemFoldId(ref!, graphs.current.id) } : undefined;
        },
      },
      {
        id: 'item.collapse.open.dblclick',
        label: 'Unfold item on double-click',
        event: 'fold.toggle',
        group: 'item',
        hidden: true,
        input: { on: 'dblclick', selector: '[data-item-kind].collapsed', prevent: true, stop: true },
        payload: source => {
          const ref = itemRefFrom(source.target);
          return ref ? { id: itemFoldId(ref, graphs.current.id) } : undefined;
        },
      },
    ]);
    // Removing the last description also removes the node's fold state. A later
    // description edit must not unexpectedly resurrect an old collapsed state.
    on('graph.node.updated', ({ id, patch }) => {
      if (!patch || !('Description' in patch) || graphs.current.getNode(id)?.Description?.trim()) return;
      const foldId = itemFoldId({ kind: 'node', id }, graphs.current.id);
      if (contexts.fold.folded(foldId)) contexts.fold.set(foldId, true);
    });
  }, { requires: ['ability.selectable'] });
}
