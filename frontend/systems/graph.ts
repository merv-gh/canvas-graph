import {
  type CreateHints,
  type EdgeDraft,
  type EdgeEntity,
  type EdgePatch,
  type GraphNode,
  type GraphSnapshot,
  type GraphStore,
  type NodeDraft,
  type NodePatch,
} from '../model';
import { edgeRef, itemIdFrom, nodeRef, type Registry } from '../core';
import { Places } from '../types';
import type { Id, ItemRef } from '../types';
import { createGraphExport } from './graph-export';

/** graph — the *behavior* of the built-in domain. The node / edge / graph
 *  entity declarations live in `model/entities.ts`; this system owns their
 *  commands, lifecycle handlers, storage (item.update → graph mutation), and
 *  the hierarchy source that makes nodes + edges navigable/jumpable. */

declare module '../types' {
  interface CustomEvents {
    'graph.exported': { json: string };
    'graph.export.json': void;
    'graph.export.file.json': void;
    'graph.export.svg': void;
    'graph.export.png': void;
    'graph.import.snapshot': GraphSnapshot;
    'graph.imported': { graphId: Id };
    'graph.edge.reverse': { id: Id };
    'graph.create': void;
    'graph.created': { id: Id };
    'graph.duplicate': { id: Id };
    'graph.duplicated': { id: Id; sourceId: Id };
    'graph.delete.request': { id: Id; confirm?: boolean };
    'graph.delete.confirm': void;
    'graph.delete.cancel': void;
    'graph.delete': { id: Id };
    'graph.deleted': { id: Id; nextId: Id };
    'graph.switch': { id: Id };
    'graph.switched': { id: Id };
    'graph.rename.input': { id: Id; name: string };
    'graph.rename.commit': void;
    'graph.rename': { id: Id; name: string };
    'graph.renamed': { id: Id; name: string };
    'graph.node.create': NodeDraft & CreateHints;
    'graph.node.created': { graphId: Id; id: Id; hints?: CreateHints; styleExplicit?: boolean };
    'graph.node.update': { id: Id; patch: NodePatch };
    'graph.node.updated': { graphId: Id; id: Id; patch?: NodePatch; visual?: boolean };
    'graph.node.delete': { id: Id };
    'graph.node.deleted': { graphId: Id; id: Id };
    'graph.edge.create': EdgeDraft;
    'graph.edge.created': { graphId: Id; id: Id; edge: EdgeEntity };
    'graph.edge.update': { id: Id; patch: EdgePatch };
    'graph.edge.updated': { graphId: Id; id: Id };
    'graph.edge.delete': { id: Id };
    'graph.edge.deleted': { graphId: Id; id: Id };
  }
}

const nextGraphId = (graphs: GraphStore) =>
  graphs.all().find(g => g.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

export function registerGraph(system: Registry) {
  system('graph', ({ on, emit, graphs, contexts, model, selection, origin, contribute }) => {
    let pendingGraphDelete: Id | null = null;
    let pendingRename: { id: Id; timer: ReturnType<typeof setTimeout> } | null = null;
    const flushRename = () => {
      if (!pendingRename) return;
      const { id, timer } = pendingRename;
      pendingRename = null;
      clearTimeout(timer);
      const graph = graphs.get(id);
      if (graph) emit('graph.renamed', { id, name: graph.name });
    };
    contexts.storage.register('node', origin, (ref, patch) => {
      if (graphs.current.updateNode(ref.id, patch as NodePatch)) {
        emit('graph.node.updated', { graphId: graphs.current.id, id: ref.id, patch: patch as NodePatch });
      }
    });
    contexts.storage.register('edge', origin, (ref, patch) => {
      if (graphs.current.updateEdge(ref.id, patch as EdgePatch)) {
        emit('graph.edge.updated', { graphId: graphs.current.id, id: ref.id });
      }
    });
    const selectedEdgeId = () => {
      const ref = selection.selected();
      return ref?.kind === 'edge' ? ref.id : '';
    };
    const graphExport = createGraphExport({ contexts, graphs });

    contexts.commands.register([
      { id: 'graph.export.json', label: 'Export graph', group: 'graph' },
      { id: 'graph.export.file.json', label: 'Download Canvas Graph JSON', group: 'graph', hidden: true },
      { id: 'graph.export.svg', label: 'Download canvas as SVG', group: 'graph', hidden: true },
      { id: 'graph.export.png', label: 'Download canvas as PNG', group: 'graph', hidden: true },
      { id: 'graph.edge.reverse', label: 'Reverse edge', group: 'edge', shortcut: 'Shift+E', available: () => !!selectedEdgeId(), payload: () => ({ id: selectedEdgeId() }) },
      {
        id: 'graph.create',
        label: 'Create graph',
        group: 'graph',
        shortcut: 'N',
        input: { on: 'keydown', key: 'n', prevent: true },
      },
      {
        id: 'graph.switch.next',
        label: 'Switch graph',
        event: 'graph.switch',
        group: 'graph',
        shortcut: 'Alt+G',
        input: { on: 'keydown', key: 'g', alt: true, prevent: true },
        payload: () => ({ id: nextGraphId(graphs) }),
      },
      {
        id: 'graph.switch',
        label: 'Switch graph',
        group: 'graph',
        hidden: true,
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
      },
      {
        id: 'graph.duplicate',
        label: 'Duplicate graph',
        group: 'graph',
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
      },
      {
        id: 'graph.rename.input',
        label: 'Type graph name',
        group: 'graph',
        hidden: true,
        input: { on: 'input', selector: '[data-graph-title]' },
        payload: ({ target }) => ({
          id: (target as HTMLInputElement).dataset.graphId ?? graphs.current.id,
          name: (target as HTMLInputElement).value,
        }),
      },
      {
        id: 'graph.rename.commit', label: 'Save graph name', group: 'graph', hidden: true,
        input: { on: 'change', selector: '[data-graph-title]' },
      },
      {
        id: 'graph.rename', label: 'Rename graph', group: 'graph', hidden: true,
        payload: ({ target }) => ({
          id: (target as HTMLInputElement).dataset.graphId ?? graphs.current.id,
          name: (target as HTMLInputElement).value,
        }),
      },
      {
        id: 'graph.delete',
        label: 'Delete graph',
        event: 'graph.delete.request',
        group: 'graph',
        available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
        payload: source => ({
          id: itemIdFrom(source.target) || graphs.current.id,
          confirm: source.origin !== 'programmatic',
        }),
      },
      {
        id: 'graph.delete.confirm', label: 'Confirm graph deletion', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-graph-delete-confirm]' },
      },
      {
        id: 'graph.delete.cancel', label: 'Cancel graph deletion', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-graph-delete-cancel]' },
      },
      {
        id: 'graph.node.delete',
        label: 'Delete node',
        group: 'graph',
        available: source => !!itemIdFrom(source?.target) || !!selection.selectedNode(),
        payload: source => ({ id: itemIdFrom(source.target) || selection.selectedNode()?.id || '' }),
      },
      {
        id: 'graph.edge.delete',
        label: 'Delete edge',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target) || !!selectedEdgeId(),
        payload: source => ({ id: itemIdFrom(source.target) || selectedEdgeId() }),
      },
    ]);

    on('graph.export.json', () => {
      const json = JSON.stringify(graphs.current.snapshot());
      emit('modal.open', { title: 'Export graph', visual: 'properties', body: graphExport.exportBody(json) });
      emit('graph.exported', { json });
    });
    on('graph.export.file.json', () => {
      const json = JSON.stringify(graphs.current.snapshot(), null, 2);
      graphExport.download(new Blob([json], { type: 'application/json' }), 'json');
      emit('app.notice', { message: 'Graph backup downloaded.' });
    });
    on('graph.export.svg', () => {
      const exported = graphExport.currentViewSvg();
      if (!exported) return;
      graphExport.download(new Blob([exported.source], { type: 'image/svg+xml;charset=utf-8' }), 'svg');
      emit('app.notice', { message: 'SVG view downloaded.' });
    });
    on('graph.export.png', () => {
      void graphExport.currentViewPng().then(blob => {
        if (blob) graphExport.download(blob, 'png');
        emit('app.notice', { message: blob ? 'PNG view downloaded.' : 'PNG export failed.', level: blob ? undefined : 'warn' });
      });
    });

    on('graph.import.snapshot', snapshot => {
      // Keep the replacement and synchronous post-import work (auto-sizing,
      // layout, fit) in one history step. The microtask ends the transaction
      // after the caller's composed import flow has finished.
      emit('history.replace.start');
      graphs.current.replace(snapshot);
      emit('graph.imported', { graphId: graphs.current.id });
      emit('graph.switched', { id: graphs.current.id });
      queueMicrotask(() => emit('history.replace.end'));
    });

    on('graph.edge.reverse', ({ id }) => {
      const edge = graphs.current.getEdge(id);
      if (!edge) return;
      if (graphs.current.updateEdge(id, { From: edge.To, To: edge.From })) {
        emit('graph.edge.updated', { graphId: graphs.current.id, id });
      }
    });

    on('graph.create', () => {
      flushRename();
      const graph = graphs.create();
      graphs.switch(graph.id);
      emit('graph.created', { id: graph.id });
      emit('graph.switched', { id: graph.id });
    });
    on('graph.duplicate', ({ id }) => {
      flushRename();
      const source = graphs.get(id);
      if (!source) return;
      const copy = graphs.create();
      copy.replace(source.snapshot());
      copy.rename(`${source.name} copy`);
      graphs.switch(copy.id);
      emit('graph.duplicated', { id: copy.id, sourceId: source.id });
      emit('graph.switched', { id: copy.id });
      emit('app.notice', { message: `Duplicated “${source.name}”.` });
    });
    const deletePreview = (id: Id) => () => {
      const graph = graphs.get(id);
      const panel = document.createElement('section');
      panel.className = 'delete-preview';
      const warning = document.createElement('p');
      warning.textContent = `Delete “${graph?.name ?? id}” and its ${graph?.nodes().length ?? 0} nodes? This cannot be undone.`;
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.command = 'graph.delete.cancel';
      cancel.dataset.graphDeleteCancel = '';
      cancel.textContent = 'Keep graph';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'danger graph-delete-confirm';
      confirm.dataset.command = 'graph.delete.confirm';
      confirm.dataset.graphDeleteConfirm = '';
      confirm.textContent = 'Delete graph';
      actions.append(cancel, confirm);
      panel.append(warning, actions);
      return panel;
    };
    on('graph.delete.request', ({ id, confirm }) => {
      flushRename();
      if (!confirm) { emit('graph.delete', { id }); return; }
      pendingGraphDelete = id;
      emit('modal.open', { title: 'Delete graph?', visual: 'properties', body: deletePreview(id) });
    });
    on('graph.delete.confirm', () => {
      const id = pendingGraphDelete;
      if (!id) return;
      pendingGraphDelete = null;
      emit('graph.delete', { id });
      emit('modal.close');
    });
    on('graph.delete.cancel', () => { pendingGraphDelete = null; emit('modal.close'); });
    on('modal.closed', () => { pendingGraphDelete = null; });
    on('graph.switch', ({ id }) => {
      if (id === graphs.current.id) return;
      flushRename();
      const graph = graphs.switch(id);
      emit('graph.switched', { id: graph.id });
    });
    on('graph.rename.input', ({ id, name }) => {
      const graph = graphs.get(id);
      if (!graph?.rename(name)) return;
      if (pendingRename) clearTimeout(pendingRename.timer);
      const timer = setTimeout(() => {
        if (pendingRename?.timer === timer) flushRename();
      }, 180);
      pendingRename = { id, timer };
    });
    on('graph.rename.commit', flushRename);
    on('graph.rename', ({ id, name }) => {
      flushRename();
      const graph = graphs.get(id);
      if (graph?.rename(name)) emit('graph.renamed', { id, name: graph.name });
    });
    // The empty-state invitation and the first node share one spatial promise:
    // the exact stage centre. Floating chrome overlays the canvas; it must not
    // silently redefine the graph's coordinate centre.
    const safeCreationPoint = () => contexts.view.spaceCenter(Places.Stage);
    on('graph.node.create', draft => {
      const { relativeTo, keepFocus, connectFrom, connectKind, keepView, ...store } = draft as typeof draft & CreateHints;
      const typeDef = model.nodeType(store.NodeType ?? 'text');
      if (!store.Size && typeDef?.defaultSize) store.Size = { ...typeDef.defaultSize };
      const styleExplicit = store.NodeType !== undefined || store.Color !== undefined
        || store.Fill !== undefined || store.BorderColor !== undefined;
      const anchorNode = relativeTo ? graphs.current.getNode(relativeTo) : (selection.selectedNode() as GraphNode | undefined);
      const node = graphs.current.createNode(store, {
        at: safeCreationPoint(),
        nearPosition: anchorNode?.Position,
      });
      emit('graph.node.created', {
        graphId: graphs.current.id, id: node.id, styleExplicit,
        hints: { keepFocus, connectFrom, connectKind, relativeTo, keepView },
      });
    });
    on('graph.node.update', ({ id, patch }) => {
      if (graphs.current.updateNode(id, patch)) emit('graph.node.updated', { graphId: graphs.current.id, id, patch });
    });
    on('graph.node.delete', ({ id }) => {
      const incident = graphs.current.edgesOf(id).map(e => e.id);
      if (graphs.current.deleteNode(id)) {
        incident.forEach(eid => emit('graph.edge.deleted', { graphId: graphs.current.id, id: eid }));
        emit('graph.node.deleted', { graphId: graphs.current.id, id });
      }
    });
    on('graph.edge.create', draft => {
      if (!draft.From || !draft.To || draft.From === draft.To) return;
      if (!graphs.current.refById(draft.From) || !graphs.current.refById(draft.To)) return;
      const edge = graphs.current.createEdge(draft);
      emit('graph.edge.created', { graphId: graphs.current.id, id: edge.id, edge });
    });
    on('graph.edge.update', ({ id, patch }) => {
      if (graphs.current.updateEdge(id, patch)) emit('graph.edge.updated', { graphId: graphs.current.id, id });
    });
    on('graph.edge.delete', ({ id }) => {
      if (graphs.current.deleteEdge(id)) emit('graph.edge.deleted', { graphId: graphs.current.id, id });
    });
    on('graph.delete', ({ id }) => {
      const next = graphs.delete(id);
      emit('graph.deleted', { id, nextId: next.id });
      emit('graph.switched', { id: next.id });
    });

    // Nodes + edges are the navigable items of a graph — register them as a
    // hierarchy source so jump / picker / fit / outline can address them.
    const offTargets = contexts.hierarchy.sources.register(origin, () => {
      const nodes = graphs.current.nodes().map(node => ({
        ref: nodeRef(node.id),
        label: node.Label.text || node.id,
        anchor: node.Position ?? { x: 0, y: 0 },
      }));
      const edges = graphs.current.edges().flatMap(edge => {
        const fromRef = graphs.current.refById(edge.From);
        const toRef = graphs.current.refById(edge.To);
        const endpointAnchor = (ref: ItemRef | undefined) => {
          if (!ref) return null;
          const item = graphs.current.getItem<{ Position?: { x: number; y: number } }>(ref);
          const bounds = item && model.entity(ref.kind)?.render?.bounds?.(item as never);
          if (bounds) return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
          return item?.Position ?? null;
        };
        const from = endpointAnchor(fromRef);
        const to = endpointAnchor(toRef);
        if (!from || !to) return [];
        const fromLabel = fromRef ? (graphs.current.getItem<{ Label?: { text?: string } }>(fromRef)?.Label?.text || edge.From) : edge.From;
        const toLabel = toRef ? (graphs.current.getItem<{ Label?: { text?: string } }>(toRef)?.Label?.text || edge.To) : edge.To;
        return [{
          ref: edgeRef(edge.id),
          label: edge.Label?.text || `${fromLabel} to ${toLabel}`,
          anchor: {
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2,
          },
        }];
      });
      return [...nodes, ...edges];
    });
    contribute({ surface: 'top', command: 'graph.export.json', kind: 'button', icon: 'export', text: 'Export', order: 22, group: 'overflow' });
    return () => {
      if (pendingRename) clearTimeout(pendingRename.timer);
      offTargets();
    };
  });
}
