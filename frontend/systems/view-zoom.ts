import type { GraphEdge, GraphNode } from '../model';
import type { Registry } from '../core';
import { clamp, foldHidden, itemRefFrom } from '../core';
import { Places, Slots, type ItemRef, type Position, type Rect, type ViewState } from '../types';

declare module '../types' {
  interface CustomEvents {
    'view.changed': ViewState;
    'view.zoom.by': { screen: Position; factor: number };
    'view.zoom.in': void;
    'view.zoom.out': void;
    'view.zoom.reset': void;
    'view.fit.all': void;
    'view.fit.selected': void;
    'view.fit.item': ItemRef;
  }
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function registerViewZoom(system: Registry) {
  system('view.zoom', ({ on, emit, contexts, graphs, selection, contribute, model, declarePanel }) => {
    // Stage tool panel — buttons reach it via panel: 'zoom' on their contribute(...).
    declarePanel({ id: 'zoom', anchor: 'bottom-right', movable: false, layout: 'toolbar', order: 20 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.zoom.out', kind: 'button', text: '−', slot: Slots.End, order: 10 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.zoom.reset', kind: 'button', text: '100%', slot: Slots.End, order: 20 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.zoom.in', kind: 'button', text: '+', slot: Slots.End, order: 30 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.fit.all', kind: 'button', text: 'Fit', slot: Slots.End, order: 5 });
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());
    const centerZoom = (factor: number) => {
      cancelCamera();
      contexts.view.zoomAtScreen(contexts.view.screenCenter(Places.Stage), factor);
      commit();
    };
    let cameraFrame = 0;
    const cancelCamera = () => {
      if (cameraFrame) cancelAnimationFrame(cameraFrame);
      cameraFrame = 0;
    };
    const animateViewTo = (next: { x: number; y: number; scale: number }, duration = 180) => {
      cancelCamera();
      const start = contexts.view.get();
      const dx = next.x - start.x, dy = next.y - start.y, ds = next.scale - start.scale;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(ds) < 0.001) return;
      const startAt = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const step = () => {
        const t = Math.min(1, Math.max(0, (performance.now() - startAt) / duration));
        const k = ease(t);
        contexts.view.set({ x: start.x + dx * k, y: start.y + dy * k, scale: start.scale + ds * k });
        commit();
        if (t < 1) cameraFrame = requestAnimationFrame(step);
        else cameraFrame = 0;
      };
      cameraFrame = requestAnimationFrame(step);
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
          // ctrlKey wheel = trackpad pinch (diverging/converging fingers) — the
          // browser routes pinch through wheel with a small deltaY, so give it a
          // stronger coefficient. Plain wheel/scroll zoom is also more sensitive now.
          const coefficient = wheel.ctrlKey ? 0.01 : 0.0025;
          return {
            screen: contexts.view.clientToScreen(Places.Stage, { x: wheel.clientX, y: wheel.clientY }),
            factor: Math.exp(-wheel.deltaY * coefficient),
          };
        },
      },
      { id: 'view.zoom.in', label: 'Zoom in', group: 'view', shortcut: '+', input: { on: 'keydown', key: '+', prevent: true } },
      { id: 'view.zoom.out', label: 'Zoom out', group: 'view', shortcut: '-', input: { on: 'keydown', key: '-', prevent: true } },
      { id: 'view.zoom.reset', label: 'Reset view', group: 'view', shortcut: '0', input: { on: 'keydown', key: '0', prevent: true } },
      { id: 'view.fit.all', label: 'Fit all to view', group: 'view', shortcut: 'Z', input: { on: 'keydown', key: 'z', prevent: true } },
      { id: 'view.fit.selected', label: 'Fit selected to view', group: 'view', shortcut: 'Shift+Z', input: { on: 'keydown', key: 'Z', shift: true, prevent: true }, available: () => !!selection.selected() },
      {
        id: 'view.fit.item',
        label: 'Fit item to view',
        group: 'view',
        hidden: true,
        available: source => !!itemRefFrom(source?.target) || !!selection.selected(),
        payload: source => itemRefFrom(source.target) ?? selection.selected() ?? undefined,
      },
    ]);

    on('view.zoom.by', ({ screen, factor }) => { cancelCamera(); contexts.view.zoomAtScreen(screen, factor); commit(); });
    on('view.zoom.in', () => centerZoom(1.2));
    on('view.zoom.out', () => centerZoom(1 / 1.2));
    on('view.zoom.reset', () => { cancelCamera(); contexts.view.set({ x: 0, y: 0, scale: 1 }); commit(); });

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
    const fitToBounds = (b: Bounds, pixelPadding = 40) => {
      cancelCamera();
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
    const gentleScaleFor = (b: Bounds, stage: DOMRect) => {
      const view = contexts.view.get();
      const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
      const safeW = Math.max(1, stage.width - 144), safeH = Math.max(1, stage.height - 144);
      const comfortW = Math.max(1, stage.width * 0.46), comfortH = Math.max(1, stage.height * 0.46);
      const screenW = bw * view.scale, screenH = bh * view.scale;
      if (screenW > safeW || screenH > safeH) return Math.min(view.scale, safeW / bw, safeH / bh);
      if (screenW > comfortW || screenH > comfortH) {
        const comfortScale = Math.min(comfortW / bw, comfortH / bh);
        return Math.min(view.scale, Math.max(view.scale * 0.92, comfortScale));
      }
      return view.scale;
    };
    const gentleOriginForAxis = (
      min: number,
      max: number,
      stageSize: number,
      scale: number,
      currentOrigin: number,
    ) => {
      const center = (min + max) / 2;
      const halfScreen = Math.max(0.5, (max - min) * scale / 2);
      const currentCenterScreen = (center - currentOrigin) * scale;
      const innerMin = stageSize * 0.38, innerMax = stageSize * 0.62;
      const safeMin = 72, safeMax = stageSize - 72;
      let desiredCenter = clamp(currentCenterScreen, innerMin, innerMax);
      if (halfScreen * 2 <= safeMax - safeMin) desiredCenter = clamp(desiredCenter, safeMin + halfScreen, safeMax - halfScreen);
      else desiredCenter = stageSize / 2;
      return center - desiredCenter / scale;
    };
    const gentlyFitToBounds = (b: Bounds) => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const view = contexts.view.get();
      const scale = gentleScaleFor(b, rect);
      animateViewTo({
        x: gentleOriginForAxis(b.minX, b.maxX, rect.width, scale, view.x),
        y: gentleOriginForAxis(b.minY, b.maxY, rect.height, scale, view.y),
        scale,
      });
    };
    const rectToBounds = (r: Rect): Bounds => ({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h });
    /** Resolve any ItemRef to graph-space bounds. Prefers the entity renderer's
     *  own `bounds()` — so it frames nodes AND containers (whose bounds are their
     *  visual rect, collapsed or expanded). Edges fit both endpoints; anything
     *  else falls back to its hierarchy anchor. */
    const itemBounds = (ref: ItemRef): Bounds | null => {
      const item = graphs.current.getItem(ref);
      const renderer = model.entity(ref.kind)?.render;
      const rect = item && renderer?.bounds ? renderer.bounds(item as never) : null;
      if (rect) return rectToBounds(rect);
      if (ref.kind === 'edge') {
        const edge = graphs.current.getEdge(ref.id) as GraphEdge | undefined;
        const from = edge && graphs.current.getNode(edge.From);
        const to = edge && graphs.current.getNode(edge.To);
        if (from && to) {
          const nodes = [from, to].filter(n => n.Position) as GraphNode[];
          if (nodes.length) return nodesBounds(nodes);
        }
      }
      const anchor = contexts.hierarchy.anchor(ref);
      if (!anchor) return null;
      return { minX: anchor.x - 80, minY: anchor.y - 32, maxX: anchor.x + 80, maxY: anchor.y + 32 };
    };

    const unionBounds = (a: Bounds, b: Bounds): Bounds => ({
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
    });
    /** Bounds of everything currently *visible* — each entity's renderer bounds
     *  (so a collapsed container counts as its small badge, not its expanded
     *  rect), skipping items hidden inside a folded ancestor. Fit frames what the
     *  user sees, not stale expanded extents. */
    const visibleBounds = (): Bounds | null => {
      let acc: Bounds | null = null;
      model.entities().forEach(entityDef => {
        const bounds = entityDef.render?.bounds;
        if (!bounds) return;
        graphs.current.itemsOfKind(entityDef.kind).forEach(item => {
          const id = (item as { id?: string }).id;
          if (!id) return;
          const ref = { kind: entityDef.kind as ItemRef['kind'], id };
          if (foldHidden(ref, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id)) return;
          const r = bounds(item);
          if (!r) return;
          const bb = { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
          acc = acc ? unionBounds(acc, bb) : bb;
        });
      });
      return acc;
    };

    on('view.fit.all', () => {
      const b = visibleBounds();
      if (b) fitToBounds(b);
    });
    on('view.fit.selected', () => {
      // Fit the whole chosen set (union of bounds), not just the primary.
      const boxes = selection.selectedAll().map(itemBounds).filter((b): b is Bounds => !!b);
      if (!boxes.length) return;
      const b = boxes.reduce((acc, box) => ({
        minX: Math.min(acc.minX, box.minX), minY: Math.min(acc.minY, box.minY),
        maxX: Math.max(acc.maxX, box.maxX), maxY: Math.max(acc.maxY, box.maxY),
      }));
      fitToBounds(b, 180);
    });
    on('view.fit.item', ref => {
      const b = itemBounds(ref);
      if (b) gentlyFitToBounds(b);
    });
    return cancelCamera;
  }, { requires: ['render'] });
}
