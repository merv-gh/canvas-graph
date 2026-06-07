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
    // Hints can opt out of focus move (so a script can fan out N children from one root) or
    // request an edge from a specific node (will be wired once the Edge entity lands).
    on('graph.node.created', ({ id, hints }) => {
      emit('selection.node.select', { id });
      if (!hints?.keepFocus) emit('focus.node.focus', { id });
      if (hints?.connectFrom) emit('graph.edge.create', { From: hints.connectFrom, To: id });
    });
  });
  feature('edgeLifecycle', ({ on, emit, graphs }) => {
    on('editing.edge.create', draft => {
      const From = draft.From ?? '';
      const To = draft.To ?? '';
      if (!From || !To || From === To) return;
      if (!graphs.current.getNode(From) || !graphs.current.getNode(To)) return;
      emit('graph.edge.create', { From, To, Label: draft.Label });
    });
  });

  feature.setRequires('nodeLifecycle', ['graph', 'ability.selectable', 'focus']);
  feature.setRequires('edgeLifecycle', ['graph']);
}
