import { itemRefFrom, nodeRect, nodeRef, refKey, type Registry } from './core';
import type { CreateHints, EdgeCreateDraft, NodeDraft } from './model';
import { Places } from './types';

declare module './types' {
  interface CustomEvents {
    'editing.node.create': NodeDraft & CreateHints;
    'editing.edge.create': EdgeCreateDraft;
    'node.convert.container': { id: string };
    'container.convert.node': { id: string };
  }
}

/* features.ts is reserved for cross-system *orchestration* — flows that touch multiple domains.
   It is intentionally NOT where redraws live: the render system installs a bus.onAny scheduler
   that turns data mutations into coalesced redraws. If a feature is just "X happened → redraw",
   delete the listener; it's already handled. */
export function registerFeatures(feature: Registry) {
  feature('nodeToContainer', ({ on, emit, contexts, graphs, selection }) => {
    const nodeId = (target?: Element | null) => {
      const ref = itemRefFrom(target) ?? selection.selected();
      return ref?.kind === 'node' ? ref.id : undefined;
    };
    contexts.commands.register([
      {
        id: 'node.convert.container',
        label: 'Convert node to container',
        group: 'container',
        available: source => !!nodeId(source?.target),
        payload: source => ({ id: nodeId(source.target) ?? '' }),
      },
      {
        id: 'container.convert.node',
        label: 'Convert container to node',
        group: 'container',
        available: source => {
          const ref = itemRefFrom(source?.target) ?? selection.selected();
          return ref?.kind === 'container';
        },
        payload: source => {
          const ref = itemRefFrom(source.target) ?? selection.selected();
          return { id: ref?.kind === 'container' ? ref.id : '' };
        },
      },
    ]);
    on('node.convert.container', ({ id }) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      const ref = nodeRef(id);
      const parent = contexts.hierarchy.parentRefOf(ref);
      const parentContainer = parent?.kind === 'container'
        ? graphs.current.getItem<{ ChildSections?: Record<string, string> }>(parent)
        : undefined;
      const sectionId = parentContainer?.ChildSections?.[refKey(ref)];
      const incident = graphs.current.edgesOf(id).map(edge => ({ id: edge.id, From: edge.From, To: edge.To }));
      let offCreated = () => {};
      offCreated = on('container.created', ({ id: containerId }) => {
        offCreated();
        incident.forEach(edge => emit('graph.edge.update', {
          id: edge.id,
          patch: {
            ...(edge.From === id ? { From: containerId } : {}),
            ...(edge.To === id ? { To: containerId } : {}),
          },
        }));
        if (parent?.kind === 'container') emit('container.add-child', {
          containerId: parent.id,
          childRef: { kind: 'container', id: containerId },
          sectionId,
        });
      });
      emit('editing.container.create', {
        Label: { text: node.Label.text },
        at: node.Position ? { ...node.Position } : { x: 0, y: 0 },
        Size: { w: Math.max(220, node.Size.w), h: Math.max(140, node.Size.h) },
        AutoFit: false,
        Color: node.Color,
      });
      // Endpoint ids have moved before deletion, so node cleanup cannot
      // cascade the preserved relations.
      emit('graph.node.delete', { id });
    });
    on('container.convert.node', ({ id }) => {
      const container = graphs.current.getItem<{
        Label: { text: string };
        Position: { x: number; y: number };
        Color?: NodeDraft['Color'];
        Children?: unknown[];
      }>({ kind: 'container', id });
      if (!container) return;
      const ref = { kind: 'container' as const, id };
      const parent = contexts.hierarchy.parentRefOf(ref);
      const parentContainer = parent?.kind === 'container'
        ? graphs.current.getItem<{ ChildSections?: Record<string, string> }>(parent)
        : undefined;
      const sectionId = parentContainer?.ChildSections?.[refKey(ref)];
      const incident = graphs.current.edgesOf(id).map(edge => ({ id: edge.id, From: edge.From, To: edge.To }));
      let convertedNodeId = '';
      let offCreated = () => {};
      offCreated = on('graph.node.created', ({ id: nodeId }) => {
        offCreated();
        convertedNodeId = nodeId;
        incident.forEach(edge => emit('graph.edge.update', {
          id: edge.id,
          patch: {
            ...(edge.From === id ? { From: nodeId } : {}),
            ...(edge.To === id ? { To: nodeId } : {}),
          },
        }));
        if (parent?.kind === 'container') emit('container.add-child', {
          containerId: parent.id,
          childRef: nodeRef(nodeId),
          sectionId,
        });
      });
      const childCount = container.Children?.length ?? 0;
      emit('graph.node.create', {
        Label: { text: container.Label.text },
        Position: { ...container.Position },
        NodeType: 'square',
        Color: container.Color,
        keepView: true,
      });
      if (childCount) emit('container.ungroup', { id });
      else emit('graph.container.delete', { id });
      if (convertedNodeId) emit('selection.item.select', nodeRef(convertedNodeId));
      if (childCount) emit('app.notice', {
        message: `Converted to node; released ${childCount} contained item${childCount === 1 ? '' : 's'}.`,
        level: 'info',
      });
    });
  }, { requires: ['graph', 'containers'] });

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
          ? { Label: { text: `Node ${graphs.current.nodes().length + 1}` }, keepView: true }
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
      if (!hints?.keepView && createdNodeIsOffscreen(id)) emit('view.fit.item', { kind: 'node', id });
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
    on('graph.node.created', ({ hints }) => { if (!hints?.keepView) scheduleFit(); });
    on('container.children.changed', ({ id }) => emit('layout.apply.sections', { id }));
  }, { requires: ['graph', 'layout'] });
}
