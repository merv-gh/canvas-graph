import { nodeRect, type Registry } from './core';
import type { CreateHints, EdgeCreateDraft, NodeDraft } from './model';
import { Places } from './types';

declare module './types' {
  interface CustomEvents {
    'editing.node.create': NodeDraft & CreateHints;
    'editing.edge.create': EdgeCreateDraft;
  }
}

/* features.ts is reserved for cross-system *orchestration* — flows that touch multiple domains.
   It is intentionally NOT where redraws live: the render system installs a bus.onAny scheduler
   that turns data mutations into coalesced redraws. If a feature is just "X happened → redraw",
   delete the listener; it's already handled. */
export function registerFeatures(feature: Registry) {
  // System-design feature disabled for release. Graph share/import (`?g=`, `?in=`,
  // mermaid paste) now lives in `systems/share.ts`, decoupled from it.
  feature('nodeLifecycle', (ctx) => {
    const { on, emit, contexts, graphs, selection } = ctx;
    const rectContains = (outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) =>
      inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
    const createdNodeIsOffscreen = (id: string) => {
      const node = graphs.current.getNode(id);
      const visible = contexts.view.visibleRect(Places.Stage);
      return !!node && !!visible && !rectContains(visible, nodeRect(node));
    };

    /** A / Shift+A ask the active layout for its spatial grammar. Tree keeps the
     *  established child / sibling-fan-out behavior; Vertical and Horizontal
     *  advance their primary axis and use Shift for an indented connected
     *  branch; Radial drills outward or fans spokes. Pointer toolbar activation
     *  remains a standalone node because a generic “Add node” click must not
     *  hide an edge mutation. */
    const attachedDraft = (alternate: boolean) => {
      const selected = selection.selectedNode();
      const base = { Label: { text: `Node ${graphs.current.nodes().length + 1}` } };
      if (!selected) return base;
      const layout = ctx.layout?.creation(selected.id, alternate);
      return layout
        ? { ...base, ...layout }
        : { ...base, relativeTo: selected.id, connectFrom: selected.id, ...(alternate ? { keepFocus: true } : {}) };
    };
    contexts.commands.register([
      {
        id: 'editing.node.create',
        label: 'Create node',
        group: 'editing',
        shortcut: 'A',
        input: { on: 'keydown', key: 'a', prevent: true },
        payload: source => source.origin === 'pointer'
          ? { Label: { text: `Node ${graphs.current.nodes().length + 1}` } }
          : attachedDraft(false),
      },
      {
        id: 'editing.node.create.keep',
        label: 'Create attached node (keep selection)',
        event: 'editing.node.create',
        group: 'editing',
        shortcut: 'Shift+A',
        input: { on: 'keydown', key: 'A', shift: true, prevent: true },
        available: () => !!selection.selectedNode(),
        payload: () => attachedDraft(true),
      },
    ]);

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
      if (hints?.connectFrom) emit('graph.edge.create', { From: hints.connectFrom, To: id, EdgeKind: hints.connectKind });
      if (createdNodeIsOffscreen(id)) emit('view.fit.item', { kind: 'node', id });
    });
  }, { requires: ['graph', 'ability.selectable', 'focus'] });
  feature('edgeLifecycle', ({ on, emit, contexts, graphs, selection }) => {
    contexts.commands.register([{
      id: 'editing.edge.create',
      label: 'Create edge',
      group: 'edge',
      shortcut: 'E',
      input: { on: 'keydown', key: 'e', prevent: true },
      // No `available` filter: the picker itself emits an app.notice when a step
      // has no candidates. Keeps the command discoverable from palette and log.
      picker: {
        title: 'Create edge',
        steps: [
          {
            id: 'From',
            prompt: 'Pick source node',
            filter: () => ref => ref.kind === 'node',
            seed: () => {
              const ref = selection.selected();
              return ref?.kind === 'node' ? ref : null;
            },
          },
          {
            id: 'To',
            prompt: 'Pick target node',
            filter: values => ref => ref.kind === 'node' && ref.id !== values.From?.id,
          },
        ],
        validate: values => {
          if (graphs.current.nodes().length < 2) return 'Create at least two nodes before creating an edge.';
          if (!values.From || !values.To) return 'Pick both source and target.';
          if (values.From.id === values.To.id) return 'Source and target must be different nodes.';
          return undefined;
        },
        payload: values => ({ From: values.From?.id ?? '', To: values.To?.id ?? '' }),
      },
    }]);

    on('editing.edge.create', draft => {
      const From = draft.From ?? '';
      const To = draft.To ?? '';
      if (!From || !To || From === To) return;
      if (!graphs.current.getNode(From) || !graphs.current.getNode(To)) return;
      emit('graph.edge.create', { From, To, Label: draft.Label });
    });
    on('commandPicker.submit', ({ commandId }) => {
      if (commandId === 'editing.edge.create') emit('app.notice', { message: 'Edge created.' });
    });
  }, { requires: ['graph'] });
  // Compatibility name retained for persisted/test flags. This feature no
  // longer runs whole-graph Tidy: that made every neighbouring node jump after
  // an add or delete. Creation only re-frames the already-positioned graph.
  // Sectioned containers retain their local structural placement inside the
  // edited boundary; explicit Tidy/Grid/Radial remain user commands.
  feature('autoLayout', ({ on, emit }) => {
    let pending = false;
    const scheduleFit = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        emit('view.fit.all');
      });
    };
    on('graph.node.created', scheduleFit);
    on('container.children.changed', ({ id }) => emit('layout.apply.sections', { id }));
  }, { requires: ['graph', 'layout'] });
}
