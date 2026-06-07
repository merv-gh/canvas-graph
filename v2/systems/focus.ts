import type { Registry } from '../core';

export function registerFocus(system: Registry) {
  system('focus', ({ on, emit, selection }) => {
    on('focus.node.focus', ({ id }) => { selection.focus(id); emit('focus.node.focused', { id }); });
    on('focus.node.clear', () => { selection.focus(null); emit('focus.node.focused', { id: null }); });
  });
}
