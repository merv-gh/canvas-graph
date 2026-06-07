import type { Registry } from './core';

/* features.ts is reserved for cross-system *orchestration* — flows that touch multiple domains.
   It is intentionally NOT where redraws live: the render system installs a bus.onAny scheduler
   that turns data mutations into coalesced redraws. If a feature is just "X happened → redraw",
   delete the listener; it's already handled. */
export function registerFeatures(feature: Registry) {
  feature('nodeLifecycle', ({ on, emit }) => {
    // editing.node.create is a user intent; graph.node.create is the storage command.
    on('editing.node.create', draft => emit('graph.node.create', draft));
    // After creation, select + focus the new node so the user can edit it immediately.
    on('graph.node.created', ({ id }) => {
      emit('selection.node.select', { id });
      emit('focus.node.focus', { id });
    });
  });

  feature.setRequires('nodeLifecycle', ['graph', 'ability.selectable', 'focus']);
}
