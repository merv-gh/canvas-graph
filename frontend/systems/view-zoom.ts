import type { GraphEdge, GraphNode } from '../model';
import { EDGE_LABEL_AVOID_REACH, edgeLabelGeometry } from '../model/entities';
import type { Registry } from '../core';
import { clamp, foldHidden, itemRefFrom } from '../core';
import { createRectIndex, intersectRectBoundary, queryRectIndex, type RectIndex } from '../core/geometry';
import { Places, Slots, type Id, type ItemRef, type Position, type Rect, type ViewState } from '../types';

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
    'view.fit.section': { containerId: Id; sectionId: Id };
  }
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type SectionedContainer = {
  id: Id;
  Sections?: Array<{ id: Id; weight?: number }>;
  SectionAxis?: 'rows' | 'columns';
};

/** Fit is a reading operation. If the complete bounds would require smaller
 * text than this, retain a readable scale and deliberately crop the far end. */
export const MIN_FIT_SCALE = 0.8;

export function registerViewZoom(system: Registry) {
  system('view.zoom', ({ on, emit, contexts, graphs, selection, contribute, model, declarePanel, frameLoop }) => {
    // Stage tool panel — buttons reach it via panel: 'zoom' on their contribute(...).
    declarePanel({ id: 'zoom', anchor: 'bottom-right', movable: false, layout: 'toolbar', order: 20 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.zoom.out', kind: 'button', text: '−', slot: Slots.End, order: 10 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.zoom.reset', kind: 'button', text: '100%', slot: Slots.End, order: 20 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.zoom.in', kind: 'button', text: '+', slot: Slots.End, order: 30 });
    contribute({ panel: 'zoom', surface: 'top', command: 'view.fit.all', kind: 'button', text: 'Fit', slot: Slots.End, order: 5 });
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());
    const syncZoomLabel = () => {
      const button = contexts.places.el(Places.Stage)?.querySelector<HTMLButtonElement>('[data-command="view.zoom.reset"]');
      if (!button) return;
      const percent = Math.round(contexts.view.get().scale * 100);
      button.textContent = `${percent}%`;
      button.setAttribute('aria-label', `Reset zoom, current ${percent}%`);
    };
    const centerZoom = (factor: number) => {
      cancelCamera();
      contexts.view.zoomAtScreen(contexts.view.screenCenter(Places.Stage), factor);
      commit();
    };
    let cameraCancelled = false;
    const cancelCamera = () => {
      cameraCancelled = true;
      frameLoop.cancel('camera.animate');
    };
    const animateViewTo = (next: { x: number; y: number; scale: number }, duration = 180) => {
      cancelCamera();
      const start = contexts.view.get();
      const dx = next.x - start.x, dy = next.y - start.y, ds = next.scale - start.scale;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(ds) < 0.001) return;
      const startAt = performance.now();
      cameraCancelled = false;
      const gen = cameraCancelled;
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const step = () => {
        if (cameraCancelled !== gen) return;
        const t = Math.min(1, Math.max(0, (performance.now() - startAt) / duration));
        const k = ease(t);
        contexts.view.set({ x: start.x + dx * k, y: start.y + dy * k, scale: start.scale + ds * k });
        commit();
        if (t < 1 && cameraCancelled === gen) frameLoop.schedule('camera.animate', step, 5);
      };
      frameLoop.schedule('camera.animate', step, 5);
    };

    contexts.commands.register([
      {
        id: 'view.zoom.wheel',
        label: 'Wheel zoom',
        event: 'view.zoom.by',
        group: 'view',
        hidden: true,
        // Pinch only (ctrl+wheel). Plain two-finger scroll is pan (view.wheel.pan).
        input: { on: 'wheel', selector: stageSelector, when: event => (event as WheelEvent).ctrlKey, prevent: true },
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

    on('view.zoom.by', ({ screen, factor }) => {
      cancelCamera();
      contexts.view.zoomAtScreen(screen, factor);
      frameLoop.schedule('view.zoom.commit', commit, 10);
    });
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
    type NodeObstacle = { rect: Rect };
    const nodeObstacleIndex = () => createRectIndex<NodeObstacle>(graphs.current.nodes().flatMap(node => {
      if (!node.Position) return [];
      return [{ rect: {
        x: node.Position.x - node.Size.w / 2,
        y: node.Position.y - node.Size.h / 2,
        w: node.Size.w,
        h: node.Size.h,
      } }];
    }));
    const edgeLabelRect = (
      edge: GraphEdge,
      from: GraphNode,
      to: GraphNode,
      obstacleIndex?: RectIndex<NodeObstacle>,
    ) => {
      const label = edge.Label?.text?.trim();
      if (!label || !from.Position || !to.Position) return null;
      const tipAtSource = intersectRectBoundary(to.Position, from.Position, { w: from.Size.w / 2, h: from.Size.h / 2 });
      const tipAtTarget = intersectRectBoundary(from.Position, to.Position, { w: to.Size.w / 2, h: to.Size.h / 2 });
      const initial = edgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id);
      const obstacles = queryRectIndex(
        obstacleIndex ?? nodeObstacleIndex(),
        initial.rect,
        EDGE_LABEL_AVOID_REACH,
      ).map(obstacle => obstacle.rect);
      return edgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, obstacles).rect;
    };
    type SafeFrame = {
      left: number; top: number; right: number; bottom: number;
      width: number; height: number; cx: number; cy: number;
    };
    // Floating chrome overlays the stage. Fit therefore uses the unobscured
    // reading area, including the open graph navigator, rather than the stage's
    // mathematical centre. This keeps the document title and its left edge from
    // landing underneath the navigator.
    const safeFrame = (rect: DOMRect, pixelPadding = 72): SafeFrame => {
      let left = pixelPadding;
      const top = pixelPadding;
      let right = rect.width - pixelPadding;
      const bottom = rect.height - pixelPadding;
      const panel = contexts.places.el(Places.Left);
      const navigator = panel?.querySelector<HTMLElement>('.graph-navigator');
      const panelRect = navigator?.dataset.outlineFolded === 'false'
        ? navigator.getBoundingClientRect()
        : undefined;
      const overlapsStage = !!panelRect && panelRect.width > 0 && panelRect.height > 0
        && panelRect.right > rect.left && panelRect.left < rect.right
        && panelRect.bottom > rect.top && panelRect.top < rect.bottom;
      if (overlapsStage) left = Math.max(left, panelRect!.right - rect.left + 20);
      if (right - left < 80) { left = pixelPadding; right = rect.width - pixelPadding; }
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      return {
        left, top, right, bottom, width, height,
        cx: left + width / 2,
        cy: top + height / 2,
      };
    };
    const topCenteredView = (b: Bounds, frame: SafeFrame, scale: number) => {
      const contentWidth = (b.maxX - b.minX) * scale;
      return {
        // Tall documents remain top-centred. If the 80% floor also makes the
        // document wider than the safe frame, keep its leading edge out from
        // under the navigator and let only the far edge continue off-screen.
        x: contentWidth <= frame.width
          ? (b.minX + b.maxX) / 2 - frame.cx / scale
          : b.minX - frame.left / scale,
        y: b.minY - frame.top / scale,
        scale,
      };
    };
    const centeredView = (b: Bounds, frame: SafeFrame, scale: number) => ({
      // Fit always centres inside the currently unobscured reading frame. When
      // the navigator is open that frame starts to its right; when it is folded
      // the full stage is available again.
      x: (b.minX + b.maxX) / 2 - frame.cx / scale,
      y: (b.minY + b.maxY) / 2 - frame.cy / scale,
      scale,
    });
    const fitToBounds = (b: Bounds, pixelPadding = 72) => {
      cancelCamera();
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const frame = safeFrame(rect, pixelPadding);
      const bw = Math.max(1, b.maxX - b.minX);
      const bh = Math.max(1, b.maxY - b.minY);
      const maxFitScale = 1.25;
      const idealScale = Math.min(maxFitScale, Math.min(frame.width / bw, frame.height / bh));
      const scale = Math.max(MIN_FIT_SCALE, idealScale);
      // Preserve the pleasant centred overview when everything remains
      // readable. If a complete fit would fall below 80%, align its beginning
      // to the top-centre and let the lower/far content continue off-screen.
      contexts.view.set(idealScale < MIN_FIT_SCALE
        ? topCenteredView(b, frame, scale)
        : centeredView(b, frame, scale));
      commit();
    };
    const gentleScaleFor = (b: Bounds, frame: SafeFrame) => {
      const view = contexts.view.get();
      const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
      const safeW = frame.width, safeH = frame.height;
      const comfortW = Math.max(1, frame.width * 0.46), comfortH = Math.max(1, frame.height * 0.46);
      const screenW = bw * view.scale, screenH = bh * view.scale;
      // Item navigation is a reading action, not merely a reveal action. From a
      // whole-document overview, raise a small item to a readable working scale;
      // a 6% requirements map must not remain 6% after choosing one capability.
      const readableScale = Math.min(0.9, safeW / bw, safeH / bh);
      if (view.scale < readableScale * 0.85) return readableScale;
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
      frameStart: number,
      frameEnd: number,
      scale: number,
      currentOrigin: number,
    ) => {
      const center = (min + max) / 2;
      const halfScreen = Math.max(0.5, (max - min) * scale / 2);
      const currentCenterScreen = (center - currentOrigin) * scale;
      const frameSize = frameEnd - frameStart;
      const innerMin = frameStart + frameSize * 0.38, innerMax = frameStart + frameSize * 0.62;
      const safeMin = frameStart, safeMax = frameEnd;
      let desiredCenter = clamp(currentCenterScreen, innerMin, innerMax);
      if (halfScreen * 2 <= safeMax - safeMin) desiredCenter = clamp(desiredCenter, safeMin + halfScreen, safeMax - halfScreen);
      else desiredCenter = frameStart + frameSize / 2;
      return center - desiredCenter / scale;
    };
    const gentlyFitToBounds = (b: Bounds, alignTop = false) => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const frame = safeFrame(rect);
      const view = contexts.view.get();
      const idealScale = gentleScaleFor(b, frame);
      const scale = Math.max(MIN_FIT_SCALE, idealScale);
      animateViewTo(alignTop || idealScale < MIN_FIT_SCALE
        ? topCenteredView(b, frame, scale)
        : {
            x: gentleOriginForAxis(b.minX, b.maxX, frame.left, frame.right, scale, view.x),
            y: gentleOriginForAxis(b.minY, b.maxY, frame.top, frame.bottom, scale, view.y),
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
          const bounds = nodes.length ? nodesBounds(nodes) : null;
          const labelRect = edgeLabelRect(edge, from, to);
          if (bounds && labelRect) {
            return {
              minX: Math.min(bounds.minX, labelRect.x),
              minY: Math.min(bounds.minY, labelRect.y),
              maxX: Math.max(bounds.maxX, labelRect.x + labelRect.w),
              maxY: Math.max(bounds.maxY, labelRect.y + labelRect.h),
            };
          }
          if (bounds) return bounds;
        }
      }
      const anchor = contexts.hierarchy.anchor(ref);
      if (!anchor) return null;
      return { minX: anchor.x - 80, minY: anchor.y - 32, maxX: anchor.x + 80, maxY: anchor.y + 32 };
    };
    const sectionBounds = (containerId: Id, sectionId: Id): Bounds | null => {
      const ref = { kind: 'container', id: containerId } as ItemRef;
      const container = graphs.current.getItem<SectionedContainer>(ref);
      const bounds = itemBounds(ref);
      const sections = container?.Sections ?? [];
      const index = sections.findIndex(section => section.id === sectionId);
      if (!bounds || index < 0) return null;
      const weights = sections.map(section => Math.max(0.15, section.weight ?? 1));
      const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      const before = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0) / total;
      const through = (weights.slice(0, index + 1).reduce((sum, weight) => sum + weight, 0)) / total;
      if (container?.SectionAxis === 'columns') {
        const width = bounds.maxX - bounds.minX;
        return {
          minX: bounds.minX + width * before,
          minY: bounds.minY,
          maxX: bounds.minX + width * through,
          maxY: bounds.maxY,
        };
      }
      const height = bounds.maxY - bounds.minY;
      return {
        minX: bounds.minX,
        minY: bounds.minY + height * before,
        maxX: bounds.maxX,
        maxY: bounds.minY + height * through,
      };
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
      // Edge renderers cannot expose static bounds because their geometry comes
      // from two nodes. Add each visible label's shared graph-space rectangle so
      // Fit never crops text that extends beyond the outermost cards.
      const obstacleIndex = nodeObstacleIndex();
      graphs.current.edges().forEach(edge => {
        const label = edge.Label?.text?.trim();
        const from = graphs.current.getNode(edge.From), to = graphs.current.getNode(edge.To);
        if (!label || !from?.Position || !to?.Position) return;
        if (foldHidden({ kind: 'node', id: from.id }, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id)) return;
        if (foldHidden({ kind: 'node', id: to.id }, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id)) return;
        const rect = edgeLabelRect(edge, from, to, obstacleIndex);
        if (!rect) return;
        const bb = { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h };
        acc = acc ? unionBounds(acc, bb) : bb;
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
    on('view.fit.section', ({ containerId, sectionId }) => {
      const b = sectionBounds(containerId, sectionId);
      if (b) gentlyFitToBounds(b, true);
    });
    let resizeObserver: ResizeObserver | undefined;
    const fitAfterResize = () => {
      frameLoop.schedule('view.resize.fit', () => {
        const rect = contexts.places.el(Places.Stage)?.getBoundingClientRect();
        if (!rect) return;
        if (rect.width > 0 && rect.height > 0 && graphs.current.nodes().length) emit('view.fit.all');
        else syncZoomLabel();
      }, 20);
    };
    globalThis.addEventListener?.('resize', fitAfterResize);
    on('app.start', () => {
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(fitAfterResize);
        const stage = contexts.places.el(Places.Stage);
        const panel = contexts.places.el(Places.Left);
        if (stage) resizeObserver.observe(stage);
        if (panel) resizeObserver.observe(panel);
      }
      frameLoop.schedule('view.zoom.label', syncZoomLabel, 30);
    });
    on('view.changed', syncZoomLabel);
    on('history.changed', () => frameLoop.schedule('view.zoom.label', syncZoomLabel, 30));
    on('tool.panel.mobile.toggle', () => frameLoop.schedule('view.zoom.label', syncZoomLabel, 30));
    on('selection.changed', () => frameLoop.schedule('view.zoom.label', syncZoomLabel, 30));
    on('fold.changed', ({ id }) => {
      frameLoop.schedule('view.zoom.label', syncZoomLabel, 30);
      if (id === 'outline.panel' && graphs.current.nodes().length) {
        frameLoop.schedule('view.navigator.fit', () => emit('view.fit.all'), 30);
      }
    });
    return () => {
      cancelCamera();
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.('resize', fitAfterResize);
      frameLoop.cancel('view.resize.fit');
      frameLoop.cancel('view.navigator.fit');
      frameLoop.cancel('view.zoom.label');
    };
  }, { requires: ['render'] });
}
