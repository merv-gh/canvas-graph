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
    // `keepFocus` opts out of BOTH selection and focus moving — that's what
    // makes "Shift+A × N" build N siblings off a single anchor in N keystrokes
    // (Principle 17). connectFrom optionally wires an edge from the trigger.
    on('graph.node.created', ({ id, hints }) => {
      if (!hints?.keepFocus) {
        emit('selection.node.select', { id });
        emit('focus.node.focus', { id });
      }
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
