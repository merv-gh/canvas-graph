import type { Registry } from './core';

export function registerFeatures(feature: Registry) {
  feature('nodeLifecycle', ({ on, emit }) => {
    on('editing.node.create', draft => emit('graph.node.create', draft));
    on('graph.node.created', ({ id }) => {
      emit('selection.node.select', { id });
      emit('focus.node.focus', { id });
    });

    on('graph.node.updated', () => emit('render.nodes.draw'));
    on('graph.node.deleted', () => emit('render.nodes.draw'));
    on('graph.switched', () => emit('render.nodes.draw'));
    on('selection.node.selected', () => emit('render.nodes.draw'));
    on('focus.node.focused', () => emit('render.nodes.draw'));

    on('graph.created', () => emit('outline.draw'));
    on('graph.deleted', () => emit('outline.draw'));
    on('graph.node.created', () => emit('outline.draw'));
    on('graph.node.deleted', () => emit('outline.draw'));
    on('graph.switched', () => emit('outline.draw'));
    on('selection.node.selected', () => emit('outline.draw'));
  });
}
