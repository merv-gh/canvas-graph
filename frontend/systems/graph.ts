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
import type { Id } from '../types';

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
    'graph.node.created': { graphId: Id; id: Id; hints?: CreateHints };
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
  system('graph', ({ on, emit, graphs, contexts, selection, origin, contribute }) => {
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
    const exportBody = (json: string) => () => {
      const panel = document.createElement('section');
      panel.className = 'export-json';
      const intro = document.createElement('p');
      intro.textContent = 'Export an editable graph file or an image of the current canvas view.';
      const actions = document.createElement('div');
      actions.className = 'export-actions';
      const option = (label: string, command: string, detail: string, primary = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = command;
        button.className = `export-option${primary ? ' primary' : ''}`;
        const strong = document.createElement('strong');
        strong.textContent = label;
        const small = document.createElement('small');
        small.textContent = detail;
        button.append(strong, small);
        return button;
      };
      actions.append(
        option('Canvas Graph JSON', 'graph.export.file.json', 'Editable backup', true),
        option('SVG', 'graph.export.svg', 'Current view · vector'),
        option('PNG', 'graph.export.png', 'Current view · 2×'),
      );
      const raw = document.createElement('details');
      raw.className = 'export-raw';
      const summary = document.createElement('summary');
      summary.textContent = 'View raw JSON';
      const textarea = document.createElement('textarea');
      textarea.readOnly = true;
      textarea.value = json;
      textarea.setAttribute('aria-label', 'Exported graph JSON');
      raw.append(summary, textarea);
      panel.append(intro, actions, raw);
      return panel;
    };

    const safeName = () => (graphs.current.name || 'canvas-graph')
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canvas-graph';
    const download = (blob: Blob, extension: string) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeName()}.${extension}`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Keep the object URL alive long enough for WebKit and embedded browsers
      // to begin consuming it after the synthetic anchor click.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const currentViewSvg = () => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const clone = stage.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.tool-panel, .item-overlays, .item-toolbar, .picker-prompt')
        .forEach(element => element.remove());
      clone.removeAttribute('data-place');
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.position = 'relative';
      clone.style.overflow = 'hidden';
      const css = [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; }
      }).join('\n');
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      wrapper.className = 'shell';
      const theme = stage.closest('.shell')?.getAttribute('data-theme');
      if (theme) wrapper.setAttribute('data-theme', theme);
      const style = document.createElement('style');
      style.textContent = css;
      wrapper.append(style, clone);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      foreign.setAttribute('width', '100%');
      foreign.setAttribute('height', '100%');
      foreign.append(wrapper);
      svg.append(foreign);
      return { source: new XMLSerializer().serializeToString(svg), width, height };
    };
    const currentViewPng = () => new Promise<Blob | null>(resolve => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) { resolve(null); return; }
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');
      if (!context) { resolve(null); return; }
      context.scale(2, 2);
      const styles = getComputedStyle(stage);
      const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      const bg = color('--bg', '#f5f5f5');
      const panel = color('--panel', '#fbfbfb');
      const ink = color('--ink', '#242424');
      const muted = color('--text-muted', '#6e6e6e');
      const line = color('--line-strong', '#aeaeae');
      const accent = color('--accent', '#424242');
      const edgeColor = color('--edge', '#787878');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);
      context.fillStyle = color('--line', '#dedede');
      for (let x = 0; x < width; x += 32) for (let y = 0; y < height; y += 32) context.fillRect(x, y, 1, 1);
      const view = contexts.view.get();
      const screen = (point: { x: number; y: number }) => ({
        x: (point.x - view.x) * view.scale,
        y: (point.y - view.y) * view.scale,
      });
      const snapshot = graphs.current.snapshot();
      const containers = (snapshot.extensions?.containers ?? []) as Array<{
        Label?: { text?: string }; Position?: { x: number; y: number }; Size?: { w: number; h: number };
      }>;
      containers.forEach(container => {
        if (!container.Position || !container.Size) return;
        const center = screen(container.Position);
        const w = container.Size.w * view.scale, h = container.Size.h * view.scale;
        context.fillStyle = accent;
        context.globalAlpha = 0.06;
        context.strokeStyle = accent;
        context.setLineDash([5, 4]);
        context.fillRect(center.x - w / 2, center.y - h / 2, w, h);
        context.globalAlpha = 1;
        context.strokeRect(center.x - w / 2, center.y - h / 2, w, h);
        context.setLineDash([]);
        context.fillStyle = ink;
        context.font = '700 10px monospace';
        context.fillText(container.Label?.text ?? 'Container', center.x - w / 2 + 8, center.y - h / 2 + 15);
      });
      const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
      context.strokeStyle = edgeColor;
      context.fillStyle = edgeColor;
      context.lineWidth = 2;
      snapshot.edges.forEach(edge => {
        const from = nodes.get(edge.From), to = nodes.get(edge.To);
        if (!from?.Position || !to?.Position) return;
        const a = screen(from.Position), b = screen(to.Position);
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        context.beginPath(); context.moveTo(b.x, b.y);
        context.lineTo(b.x - 10 * Math.cos(angle - Math.PI / 6), b.y - 10 * Math.sin(angle - Math.PI / 6));
        context.lineTo(b.x - 10 * Math.cos(angle + Math.PI / 6), b.y - 10 * Math.sin(angle + Math.PI / 6));
        context.closePath(); context.fill();
        if (edge.Label?.text) {
          context.fillStyle = muted; context.font = '10px monospace';
          context.fillText(edge.Label.text, (a.x + b.x) / 2 + 5, (a.y + b.y) / 2 - 6);
          context.fillStyle = edgeColor;
        }
      });
      snapshot.nodes.forEach(node => {
        if (!node.Position) return;
        const center = screen(node.Position);
        const w = (node.Size?.w ?? 200) * view.scale, h = (node.Size?.h ?? 80) * view.scale;
        context.fillStyle = panel; context.strokeStyle = line; context.lineWidth = 1.5;
        context.beginPath();
        if (node.NodeType === 'circle') context.ellipse(center.x, center.y, w / 2, h / 2, 0, 0, Math.PI * 2);
        else context.rect(center.x - w / 2, center.y - h / 2, w, h);
        context.fill(); context.stroke();
        context.fillStyle = ink; context.textAlign = 'center';
        context.font = `700 ${Math.max(9, Math.round(14 * view.scale))}px sans-serif`;
        context.fillText(node.Label?.text ?? node.id, center.x, center.y - (node.Description ? 4 : -4), Math.max(20, w - 14));
        if (node.Description && h >= 38) {
          context.fillStyle = muted;
          context.font = `${Math.max(7, Math.round(10 * view.scale))}px sans-serif`;
          context.fillText(node.Description, center.x, center.y + 13, Math.max(20, w - 14));
        }
        context.textAlign = 'start';
      });
      canvas.toBlob(resolve, 'image/png');
    });

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
      emit('modal.open', { title: 'Export graph', visual: 'properties', body: exportBody(json) });
      emit('graph.exported', { json });
    });
    on('graph.export.file.json', () => {
      const json = JSON.stringify(graphs.current.snapshot(), null, 2);
      download(new Blob([json], { type: 'application/json' }), 'json');
      emit('app.notice', { message: 'Graph backup downloaded.' });
    });
    on('graph.export.svg', () => {
      const exported = currentViewSvg();
      if (!exported) return;
      download(new Blob([exported.source], { type: 'image/svg+xml;charset=utf-8' }), 'svg');
      emit('app.notice', { message: 'SVG view downloaded.' });
    });
    on('graph.export.png', () => {
      void currentViewPng().then(blob => {
        if (blob) download(blob, 'png');
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
      const { relativeTo, keepFocus, connectFrom, connectKind, ...store } = draft as typeof draft & CreateHints;
      const anchorNode = relativeTo ? graphs.current.getNode(relativeTo) : (selection.selectedNode() as GraphNode | undefined);
      const node = graphs.current.createNode(store, {
        at: safeCreationPoint(),
        nearPosition: anchorNode?.Position,
      });
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id, hints: { keepFocus, connectFrom, connectKind, relativeTo } });
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
      if (!graphs.current.getNode(draft.From) || !graphs.current.getNode(draft.To)) return;
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
        const from = graphs.current.getNode(edge.From);
        const to = graphs.current.getNode(edge.To);
        if (!from?.Position || !to?.Position) return [];
        return [{
          ref: edgeRef(edge.id),
          label: edge.Label?.text || `${from.Label.text} to ${to.Label.text}`,
          anchor: {
            x: (from.Position.x + to.Position.x) / 2,
            y: (from.Position.y + to.Position.y) / 2,
          },
        }];
      });
      return [...nodes, ...edges];
    });
    contribute({ surface: 'top', command: 'graph.export.json', kind: 'button', text: 'Export', order: 22, group: 'file' });
    return () => {
      if (pendingRename) clearTimeout(pendingRename.timer);
      offTargets();
    };
  });
}
