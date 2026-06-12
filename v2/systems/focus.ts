import { nodeRef, type Registry } from '../core';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'focus.item.focus': ItemRef;
    'focus.item.clear': void;
    'focus.item.focused': ItemRef | null;
    'focus.node.focus': { id: Id };
    'focus.node.clear': void;
    'focus.node.focused': { id: Id | null };
  }
}

export function registerFocus(system: Registry) {
  system('focus', ({ on, emit, selection, contexts, origin }) => {
    on('focus.node.focus', ({ id }) => emit('focus.item.focus', nodeRef(id)));
    on('focus.node.clear', () => emit('focus.item.clear'));
    on('focus.item.focus', ref => {
      selection.focus(ref);
      contexts.decorations.modes.set(origin, 'focused', [ref]);
      emit('focus.item.focused', ref);
      emit('focus.node.focused', { id: ref.kind === 'node' ? ref.id : null });
    });
    on('focus.item.clear', () => {
      selection.focus(null);
      contexts.decorations.unregisterOrigin(origin);
      emit('focus.item.focused', null);
      emit('focus.node.focused', { id: null });
    });
  }, { requires: ['graph'] });
}
