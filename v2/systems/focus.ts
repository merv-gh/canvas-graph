import { nodeRef, type Registry } from '../core';

export function registerFocus(system: Registry) {
  system('focus', ({ on, emit, selection, contexts, origin }) => {
    on('focus.node.focus', ({ id }) => emit('focus.item.focus', nodeRef(id)));
    on('focus.node.clear', () => emit('focus.item.clear'));
    on('focus.item.focus', ref => {
      selection.focus(ref);
      contexts.itemModes.set(origin, 'focused', [ref]);
      emit('focus.item.focused', ref);
      emit('focus.node.focused', { id: ref.kind === 'node' ? ref.id : null });
    });
    on('focus.item.clear', () => {
      selection.focus(null);
      contexts.itemModes.clear(origin);
      emit('focus.item.focused', null);
      emit('focus.node.focused', { id: null });
    });
  });
}
