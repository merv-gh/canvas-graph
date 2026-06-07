import type { GraphEdge, GraphNode } from '../model';
import type { Registry } from '../core';
import { itemRefFrom } from '../core';
import { Places, type ItemRef } from '../types';

export function registerViewZoom(system: Registry) {
  system('view.zoom', ({ on, emit, contexts, graphs, selection, contribute }) => {
    contribute({ surface: 'top', command: 'view.zoom.out', kind: 'button', text: '−', slot: 'end', order: 10 });
    contribute({ surface: 'top', command: 'view.zoom.reset', kind: 'button', text: '100%', slot: 'end', order: 20 });
    contribute({ surface: 'top', command: 'view.zoom.in', kind: 'button', text: '+', slot: 'end', order: 30 });
    contribute({ surface: 'top', command: 'view.fit.all', kind: 'button', text: 'Fit', slot: 'end', order: 5 });
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());
    const centerZoom = (factor: number) => {
      contexts.view.zoomAtScreen(contexts.view.screenCenter(Places.Stage), factor);
      commit();
    };

    contexts.commands.register([
      {
        id: 'view.zoom.wheel',
        label: 'Wheel zoom',
        event: 'view.zoom.by',
        group: 'view',
        hidden: true,
        input: { on: 'wheel', selector: stageSelector, prevent: true },
        payload: ({ event }) => {
          const wheel = event as WheelEvent;
          return {
            screen: contexts.view.clientToScreen(Places.Stage, { x: wheel.clientX, y: wheel.clientY }),
            factor: Math.exp(-wheel.deltaY * 0.001),
          };
        },
      },
      { id: 'view.zoom.in', label: 'Zoom in', event: 'view.zoom.in', group: 'view', shortcut: '+', input: { on: 'keydown', key: '+', prevent: true } },
      { id: 'view.zoom.out', label: 'Zoom out', event: 'view.zoom.out', group: 'view', shortcut: '-', input: { on: 'keydown', key: '-', prevent: true } },
      { id: 'view.zoom.reset', label: 'Reset view', event: 'view.zoom.reset', group: 'view', shortcut: '0', input: { on: 'keydown', key: '0', prevent: true } },
      { id: 'view.fit.all', label: 'Fit all to view', event: 'view.fit.all', group: 'view', shortcut: 'Z', input: { on: 'keydown', key: 'z', prevent: true } },
      { id: 'view.fit.selected', label: 'Fit selected to view', event: 'view.fit.selected', group: 'view', shortcut: 'Shift+Z', input: { on: 'keydown', key: 'Z', shift: true, prevent: true }, available: () => !!selection.selected() },
      {
        id: 'view.fit.item',
        label: 'Fit item to view',
        event: 'view.fit.item',
        group: 'view',
        hidden: true,
        available: source => !!itemRefFrom(source?.target) || !!selection.selected(),
        payload: source => itemRefFrom(source.target) ?? selection.selected() ?? undefined,
      },
    ]);

    on('view.zoom.by', ({ screen, factor }) => { contexts.view.zoomAtScreen(screen, factor); commit(); });
    on('view.zoom.in', () => centerZoom(1.2));
    on('view.zoom.out', () => centerZoom(1 / 1.2));
    on('view.zoom.reset', () => { contexts.view.set({ x: 0, y: 0, scale: 1 }); commit(); });

    const nodesBounds = (ns: GraphNode[]) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ns.forEach(n => {
        if (!n.Position) return;
        const w = n.Size.w / 2, h = n.Size.h / 2;
        minX = Math.min(minX, n.Position.x - w);
        minY = Math.min(minY, n.Position.y - h);
        maxX = Math.max(maxX, n.Position.x + w);
        maxY = Math.max(maxY, n.Position.y + h);
      });
      return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    };
    const fitToBounds = (b: { minX: number; minY: number; maxX: number; maxY: number }, pixelPadding = 40) => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const fittableW = Math.max(1, rect.width - 2 * pixelPadding);
      const fittableH = Math.max(1, rect.height - 2 * pixelPadding);
      const bw = Math.max(1, b.maxX - b.minX);
      const bh = Math.max(1, b.maxY - b.minY);
      const scale = Math.min(2, Math.min(fittableW / bw, fittableH / bh));
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      contexts.view.set({
        x: cx - rect.width / (2 * scale),
        y: cy - rect.height / (2 * scale),
        scale,
      });
      commit();
    };
    /** Resolve any ItemRef to a graph-space bounds. Falls back to itemTargets
     *  anchor for items whose canonical entity lookup fails (overlays, ghosts). */
    const itemBounds = (ref: ItemRef) => {
      if (ref.kind === 'node') {
        const node = graphs.current.getNode(ref.id) as GraphNode | undefined;
        if (node) return nodesBounds([node]);
      }
      if (ref.kind === 'edge') {
        const edge = graphs.current.getEdge(ref.id) as GraphEdge | undefined;
        const from = edge && graphs.current.getNode(edge.From);
        const to = edge && graphs.current.getNode(edge.To);
        if (from && to) {
          const nodes = [from, to].filter(n => n.Position) as GraphNode[];
          if (nodes.length) return nodesBounds(nodes);
        }
      }
      const anchor = contexts.itemTargets.anchor(ref);
      if (!anchor) return null;
      return { minX: anchor.x - 80, minY: anchor.y - 32, maxX: anchor.x + 80, maxY: anchor.y + 32 };
    };

    on('view.fit.all', () => {
      const b = nodesBounds(graphs.current.nodes() as GraphNode[]);
      if (b) fitToBounds(b);
    });
    on('view.fit.selected', () => {
      const ref = selection.selected();
      const b = ref ? itemBounds(ref) : null;
      if (b) fitToBounds(b, 180);
    });
    on('view.fit.item', ref => {
      const b = itemBounds(ref);
      if (b) fitToBounds(b, 180);
    });
  });
}
