import { clamp, semanticTitle } from '../core';
import { configurable, editable, selectable } from '../abilities';
import { expandRect, intersectRectBoundary, segmentIntersectsRect } from '../core/geometry';
import type { EdgePatch, Graph, GraphEdge } from './graph';
import type { EntityDef, EntityRenderCtx, EntityRenderer, ItemRef, Position, Rect, Segment, Size } from '../types';
import { nodeBoundsOf } from './node-entity';
import { ARROWLESS_KINDS, EDGE_KINDS, NODE_COLORS, entityDef, isEdgeKind, isNodeColor, property, svg } from './entity-options';

/** Compute the visible endpoint for an edge anchor: if the node is inside a
 *  Collapsed container, the endpoint snaps to the outermost collapsed
 *  ancestor's visual rect. Otherwise it's the node itself. Returns null when
 *  neither resolves (orphaned edge — render skips it). */
const resolveEndpoint = (id: string, ctx: { graph: { getItem(ref: ItemRef): unknown; refById(id: string): ItemRef | undefined }; parentChain(ref: ItemRef): ItemRef[]; isFolded(ref: ItemRef): boolean; boundsOf(ref: ItemRef): Rect | null }):
  | { ref: ItemRef; center: { x: number; y: number }; half: { w: number; h: number } }
  | null => {
  const endpointRef = ctx.graph.refById(id);
  if (!endpointRef) return null;
  const chain = ctx.parentChain(endpointRef);
  // Outermost folded ancestor wins — pick the highest-level visible boundary.
  const collapsed = chain.find(a => ctx.isFolded(a));
  if (collapsed) {
    const rect = ctx.boundsOf(collapsed);
    if (!rect) return null;
    return {
      ref: collapsed,
      center: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      half: { w: rect.w / 2, h: rect.h / 2 },
    };
  }
  const rect = ctx.boundsOf(endpointRef);
  if (!rect) return null;
  return {
    ref: endpointRef,
    center: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
    half: { w: rect.w / 2, h: rect.h / 2 },
  };
};

export const EDGE_LABEL_FONT_SIZE = 14;
export const EDGE_LABEL_LINE_HEIGHT = 18;
export const EDGE_LABEL_CHAR_WIDTH = 9;
const EDGE_LABEL_PAD_X = 8;
const EDGE_LABEL_PAD_Y = 4;
const EDGE_LABEL_MIN_WIDTH = 72;
const EDGE_LABEL_MIN_HEIGHT = 28;
const EDGE_LABEL_HIT_MARGIN = 12;
const EDGE_LABEL_LINE_GAP = 10;
const EDGE_LABEL_AVOID_STEP = 12;
export const EDGE_LABEL_AVOID_REACH = 480;
/** Sizes the invisible label box an unlabelled edge still renders, so the
 *  double-click target sits where the real label will appear. */
const EDGE_LABEL_PLACEHOLDER = 'label';

export const measureEdgeLabel = (label: string): Size => {
  const lines = label.split(/\r?\n/);
  return {
    w: Math.max(EDGE_LABEL_MIN_WIDTH, Math.max(1, ...lines.map(line => line.length)) * EDGE_LABEL_CHAR_WIDTH + EDGE_LABEL_PAD_X * 2),
    h: Math.max(EDGE_LABEL_MIN_HEIGHT, (lines.length - 1) * EDGE_LABEL_LINE_HEIGHT + EDGE_LABEL_FONT_SIZE + EDGE_LABEL_PAD_Y * 2),
  };
};

/** The label is a real graph-space rectangle, not just text painted at a
 * midpoint. Its anchor is staggered slightly along the edge, then moved far
 * enough along the right-normal for the whole rectangle (including a gap) to
 * clear the line and arrow axis. Projecting both width and height onto that
 * normal is what keeps near-vertical labels clear too. */
export const edgeLabelGeometry = (
  label: string,
  from: Position,
  to: Position,
  edgeId = '',
  avoid: Rect[] = [],
  avoidLines: Segment[] = [],
) => {
  const lines = label.split(/\r?\n/);
  const size = measureEdgeLabel(label);
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  // Deterministic staggering prevents several labels on crossing/parallel
  // relationships from all claiming the exact midpoint. Keep every candidate
  // source-side of the arrowhead.
  const hash = [...edgeId].reduce((value, char) => (value * 33 + char.charCodeAt(0)) >>> 0, 5381);
  const preferredT = 0.36 + (hash % 5) * 0.04;
  const tx = dx / len, ty = dy / len;
  const alongHalf = Math.abs(tx) * size.w / 2 + Math.abs(ty) * size.h / 2;
  const minT = (alongHalf + 8) / len;
  const maxT = 1 - (alongHalf + 18) / len;
  const t = minT <= maxT ? clamp(preferredT, minT, maxT) : 0.5;
  let clearance = Math.abs(nx) * size.w / 2 + Math.abs(ny) * size.h / 2 + EDGE_LABEL_LINE_GAP;
  let anchor = {
    x: from.x + dx * t + nx * clearance,
    y: from.y + dy * t + ny * clearance,
  };
  let rect = { x: anchor.x - size.w / 2, y: anchor.y - size.h / 2, w: size.w, h: size.h };
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // Short relationships may not have enough along-edge room for a long label.
  // Walk the rectangle farther along the same normal until it clears both cards;
  // it stays attached to the edge but never hides an endpoint.
  // Cards AND other people's wires: a label sitting on an unrelated line reads
  // as belonging to it, which is worse than a label sitting slightly far out.
  const blocked = () => avoid.some(obstacle => overlaps(rect, obstacle))
    || avoidLines.some(line => segmentIntersectsRect(line, rect));
  for (let pass = 0; pass < EDGE_LABEL_AVOID_REACH / EDGE_LABEL_AVOID_STEP && blocked(); pass++) {
    clearance += EDGE_LABEL_AVOID_STEP;
    anchor = {
      x: from.x + dx * t + nx * clearance,
      y: from.y + dy * t + ny * clearance,
    };
    rect = { x: anchor.x - size.w / 2, y: anchor.y - size.h / 2, w: size.w, h: size.h };
  }
  return {
    lines,
    size,
    rect,
    anchor,
    textStartY: -((lines.length - 1) * EDGE_LABEL_LINE_HEIGHT) / 2 + EDGE_LABEL_FONT_SIZE * 0.35,
    transform: `translate(${anchor.x}, ${anchor.y})`,
  };
};

/** Centre-to-centre lines of every edge *except* one, as a lookup. Built once
 *  per pass so label placement is O(edges) rather than O(edges²) of lookups. */
const otherEdgeLines = (
  edges: { id: string; From: string; To: string }[],
  positionOf: (id: string) => Position | null,
) => {
  if (edges.length > LABEL_AVOID_EDGE_LIMIT) return () => [] as Segment[];
  const all: (Segment & { id: string })[] = [];
  edges.forEach(edge => {
    const from = positionOf(edge.From), to = positionOf(edge.To);
    if (from && to) all.push({ id: edge.id, ax: from.x, ay: from.y, bx: to.x, by: to.y });
  });
  return (exceptId: string) => all.filter(line => line.id !== exceptId);
};

/** Final label rectangles for every labelled edge, produced by the same
 *  placement the renderer uses (stagger, node avoidance, border clipping).
 *
 *  Exported because the DX layout rule used to re-derive a simplified version
 *  of this — a midpoint plus a fixed offset — and warned about overlaps at
 *  positions no label had occupied since the avoidance pass landed. Duplicated
 *  layout math rots; one function cannot. */
/** Beyond this an all-pairs label/line check stops being worth its frame. */
const LABEL_AVOID_EDGE_LIMIT = 400;

export const edgeLabelRects = (graph: Graph): Map<string, Rect> => {
  const rects = new Map<string, Rect>();
  const nodeRects = graph.nodes().map(nodeBoundsOf);
  const anchorOf = (id: string) => {
    const node = graph.node(id);
    if (!node?.Position) return null;
    const rect = nodeBoundsOf(node);
    return { center: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, half: { w: rect.w / 2, h: rect.h / 2 } };
  };
  const lines = otherEdgeLines(graph.edges(), id => graph.node(id)?.Position ?? null);
  graph.edges().forEach(edge => {
    const label = edge.Label?.text;
    if (!label) return;
    const from = anchorOf(edge.From), to = anchorOf(edge.To);
    if (!from || !to) return;
    const tipAtTarget = intersectRectBoundary(from.center, to.center, to.half);
    const tipAtSource = intersectRectBoundary(to.center, from.center, from.half);
    const initial = edgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id);
    const area = expandRect(initial.rect, EDGE_LABEL_AVOID_REACH);
    const obstacles = nodeRects.filter(rect =>
      rect.x < area.x + area.w && rect.x + rect.w > area.x && rect.y < area.y + area.h && rect.y + rect.h > area.y);
    rects.set(edge.id, edgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, obstacles, lines(edge.id)).rect);
  });
  return rects;
};

const renderedEdgeLabelGeometry = (
  label: string,
  from: Position,
  to: Position,
  edgeId: string,
  ctx: EntityRenderCtx,
) => {
  const initial = edgeLabelGeometry(label, from, to, edgeId);
  const obstacles = ctx.boundsInRect('node', expandRect(initial.rect, EDGE_LABEL_AVOID_REACH));
  // Same placement the DX layout rule checks (`edgeLabelRects`): cards first,
  // then everyone else's wires, so a label never reads as belonging to a line
  // it merely crosses.
  return edgeLabelGeometry(label, from, to, edgeId, obstacles, ctx.linesOfKind('edge', edgeId));
};

const edgeRenderer: EntityRenderer<GraphEdge> = {
  layer: 'svg',
  collect(graph, hiddenByFold, visibleNodeIds) {
    const g = graph as unknown as Graph;
    const nodeIds = visibleNodeIds ?? new Set(g.nodes().map(n => n.id));
    const seen = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const nid of nodeIds) {
      for (const e of g.edgesOf(nid)) {
        const k = e.id;
        if (!seen.has(k)) { seen.add(k); edges.push(e); }
      }
    }
    // Non-node endpoints are extension-owned and not part of the node spatial
    // index. Include their relations; draw() still rejects missing endpoints.
    g.edgesOutsideNodes().forEach(e => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      edges.push(e);
    });
    // Edge hidden-by-fold: an edge is visible when at least one endpoint is.
    // Individual endpoint collapse is handled by resolveEndpoint in draw().
    return edges;
  },
  draw(edge, ctx) {
    const from = resolveEndpoint(edge.From, ctx);
    const to = resolveEndpoint(edge.To, ctx);
    if (!from || !to) return null;
    // Self-loop after collapse (both endpoints inside the same collapsed
    // container) — hide the edge to avoid the degenerate visual.
    if (from.ref.kind === to.ref.kind && from.ref.id === to.ref.id) return null;
    const ref = ctx.refOf(edge.id);
    // Clip both visible endpoints to the rect borders so the arrowhead lands
    // outside; the hit-box stays centered-to-centered for click forgiveness.
    const tipAtTarget = intersectRectBoundary(from.center, to.center, to.half);
    const tipAtSource = intersectRectBoundary(to.center, from.center, from.half);
    const g = svg('g', {});
    // The store defaults EdgeKind to the label text (so typing "sync" as a label
    // sets the kind). For arbitrary labels (mermaid import, free text) that isn't
    // a real kind — fall back to 'sync' for styling so the class stays valid.
    const edgeKind = isEdgeKind(edge.EdgeKind) ? edge.EdgeKind : 'sync';
    g.setAttribute('class', `edge edge-kind-${edgeKind}`);
    if (edge.Color) g.dataset.edgeColor = edge.Color;
    const titleText = semanticTitle(edge);
    if (titleText) {
      const title = svg('title', {});
      title.textContent = titleText;
      g.append(title);
    }
    const line = (className: string, x1: number, y1: number, x2: number, y2: number, extra: Record<string, string | number> = {}) => {
      const el = svg('line', { x1, y1, x2, y2, class: `${className} edge-kind-${edgeKind}`, ...extra });
      ctx.tagItem(el, ref);
      ctx.applyItemModes(el, ref);
      return el;
    };
    g.append(line('edge-hit', from.center.x, from.center.y, to.center.x, to.center.y, { tabindex: -1 }));
    g.append(line('edge-line', tipAtSource.x, tipAtSource.y, tipAtTarget.x, tipAtTarget.y,
      ARROWLESS_KINDS.includes(edgeKind) ? {} : { 'marker-end': 'url(#edge-arrow)' }));
    const label = edge.Label?.text ?? '';
    // An unlabelled relationship still gets a label box — invisible until the
    // edge is hovered or selected. It is the double-click target that turns
    // "this arrow means something" into words (Principle 12: empty states).
    const geometry = label
      ? renderedEdgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, ctx)
      : edgeLabelGeometry(EDGE_LABEL_PLACEHOLDER, tipAtSource, tipAtTarget, edge.id);
    // Label content is built in LOCAL coords around (0,0) inside a translated
    // wrapper group — reposition then only rewrites the wrapper's transform.
    const wrap = svg('g', {
      class: `edge-label-wrap${label ? '' : ' is-empty'}`,
      transform: geometry.transform,
      'data-label-width': geometry.size.w,
      'data-label-height': geometry.size.h,
    });
    // Keep the visible label comfortably sized while making acquisition even
    // more forgiving. This transparent target also reveals empty labels before
    // the pointer reaches the offset text box, avoiding edge-line pixel hunts.
    const target = svg('rect', {
      class: 'edge-label-target',
      x: -geometry.size.w / 2 - EDGE_LABEL_HIT_MARGIN,
      y: -geometry.size.h / 2 - EDGE_LABEL_HIT_MARGIN,
      width: geometry.size.w + EDGE_LABEL_HIT_MARGIN * 2,
      height: geometry.size.h + EDGE_LABEL_HIT_MARGIN * 2,
      rx: 8,
    });
    ctx.tagItem(target as unknown as HTMLElement, ref);
    target.dataset.edgeLabelTrigger = '';
    wrap.append(target);
    if (label) {
      // Opaque backdrop uses the same rectangle the layout engine reserves.
      wrap.append(svg('rect', {
        class: 'edge-label-bg',
        x: -geometry.size.w / 2,
        y: -geometry.size.h / 2,
        width: geometry.size.w,
        height: geometry.size.h,
        rx: 3,
      }));
    }
    // The label is HTML inside a foreignObject rather than SVG <text> so the
    // generic `editable` ability can put a caret in it (contenteditable does
    // not work on SVG text). Geometry, wrapping, and backdrop are unchanged.
    const host = svg('foreignObject', {
      x: -geometry.size.w / 2,
      y: -geometry.size.h / 2,
      width: geometry.size.w,
      height: geometry.size.h,
      class: 'edge-label-host',
    });
    ctx.tagItem(host as unknown as HTMLElement, ref);
    const text = document.createElement('div');
    text.className = `edge-label edge-kind-${edgeKind}`;
    text.dataset.editableTitle = '';
    text.setAttribute('aria-label', label ? 'Edge label. Double-click to edit.' : 'Unlabelled edge. Double-click to add a label.');
    text.style.fontSize = `${EDGE_LABEL_FONT_SIZE}px`;
    text.style.lineHeight = `${EDGE_LABEL_LINE_HEIGHT}px`;
    text.textContent = label;
    host.append(text);
    wrap.append(host);
    g.append(wrap);
    return g;
  },
  /** Endpoint move (drag / nudge / cascade) — rewrite line coordinates and the
   *  label wrapper's transform on the EXISTING SVG group instead of rebuilding
   *  it. Uses the same endpoint resolution as draw (incl. collapsed-container
   *  substitution), so the fast path can't drift from the slow one. */
  reposition(el, edge, ctx) {
    const from = resolveEndpoint(edge.From, ctx);
    const to = resolveEndpoint(edge.To, ctx);
    // Degenerate (missing / same collapsed ancestor): leave the element — the
    // next non-position change full-draws it into the right shape.
    if (!from || !to || (from.ref.kind === to.ref.kind && from.ref.id === to.ref.id)) return;
    const tipAtTarget = intersectRectBoundary(from.center, to.center, to.half);
    const tipAtSource = intersectRectBoundary(to.center, from.center, from.half);
    const setLine = (selector: string, x1: number, y1: number, x2: number, y2: number) => {
      const lineEl = el.querySelector(selector);
      if (!lineEl) return;
      lineEl.setAttribute('x1', String(x1));
      lineEl.setAttribute('y1', String(y1));
      lineEl.setAttribute('x2', String(x2));
      lineEl.setAttribute('y2', String(y2));
    };
    setLine('.edge-hit', from.center.x, from.center.y, to.center.x, to.center.y);
    setLine('.edge-line', tipAtSource.x, tipAtSource.y, tipAtTarget.x, tipAtTarget.y);
    const wrap = el.querySelector('.edge-label-wrap');
    const label = edge.Label?.text ?? '';
    if (wrap) wrap.setAttribute(
      'transform',
      label
        ? renderedEdgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, ctx).transform
        : edgeLabelGeometry(EDGE_LABEL_PLACEHOLDER, tipAtSource, tipAtTarget, edge.id).transform,
    );
  },
  signature(edge) {
    return `v${edge.visualVersion}`;
  },
};

export const edgeEntity: EntityDef<GraphEdge, EdgePatch> = entityDef<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text?.trim() || 'Connection',
  // editable: the label is the edge's meaning. Double-click it (or press Enter
  // with the edge selected) to name the relationship without a modal.
  abilities: [selectable<GraphEdge>(), editable<GraphEdge>(), configurable<GraphEdge>()],
  render: edgeRenderer,
  properties: [
    property<GraphEdge, EdgePatch>({
      id: 'label', label: 'Label', input: 'text',
      value: edge => edge.Label?.text ?? '',
      patch: (_edge, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'edgeKind', label: 'Appearance', input: 'segments', options: EDGE_KINDS,
      value: edge => (isEdgeKind(edge.EdgeKind) ? edge.EdgeKind : 'sync'),
      patch: (_edge, value) => isEdgeKind(value) ? { EdgeKind: value } : undefined,
    }),
    property<GraphEdge, EdgePatch>({
      id: 'color', label: 'Color', input: 'swatches',
      options: [{ value: '', label: 'Default' }, ...NODE_COLORS],
      value: edge => edge.Color ?? '',
      patch: (_edge, value) => value === '' || isNodeColor(value) ? { Color: value || undefined } : undefined,
    }),
  ],
});
