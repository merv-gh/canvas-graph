import { itemRefFrom, type Registry } from '../core';
import type { ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'item.context.open': ItemRef;
  }
}

/** One item surface: the context command and period shortcut both open the
 * compact inspector rendered by configurable. Actions and editable properties
 * therefore cannot drift into separate modal designs. */
export function registerContextActions(system: Registry) {
  system('context.actions', ({ on, emit, contexts, selection }) => {
    const refFrom = (target?: Element | null) => itemRefFrom(target) ?? selection.selected() ?? undefined;
    contexts.commands.register([{
      id: 'item.context.open',
      label: 'Open item actions',
      group: 'item',
      shortcut: '.',
      input: { on: 'keydown', key: '.', prevent: true },
      available: source => !!refFrom(source?.target),
      payload: source => refFrom(source.target),
    }]);
    on('item.context.open', ref => emit('item.properties.open', ref));
  }, { requires: ['ability.selectable'] });
}
