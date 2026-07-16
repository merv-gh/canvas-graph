import { clamp, semanticTitle } from '../core';
import { expandRect, intersectRectBoundary } from '../core/geometry';
import { renderMarkdown } from '../core/markdown';
import { collapsible, configurable, draggable, editable, nudgeable, selectable } from '../abilities';
import type { DataScale, EdgeKind, Graph, GraphEdge, GraphNode, NodeEntity, EdgePatch, NodePatch, NodeType } from './graph';
import type { EntityDef, EntityRenderCtx, EntityRenderer, ItemRef, Position, PropertyDef, Rect, Size } from '../types';

/** Built-in entity declarations — what a graph / node / edge *is*: its label,
 *  abilities, properties, and renderer. Behavior (commands, storage handlers,
 *  lifecycle) lives in `systems/graph.ts`; this file is pure declaration so
 *  "what is a node" and "what happens to a node" have separate homes. Plugin
 *  kinds (containers) declare themselves inside their own system file; the
 *  built-ins live here in the model. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
};

const property = <T, Patch>(def: PropertyDef<T, Patch>) => def;
const entityDef = <T, Patch = unknown>(kind: string, def: Omit<EntityDef<T, Patch>, 'kind'>): EntityDef<T, Patch> => ({ kind, ...def });
const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'square', label: 'Box' },
  { value: 'circle', label: 'Circle' },
  { value: 'user-input', label: 'User input' },
  { value: 'gateway', label: 'Gateway' },
  { value: 'service', label: 'Service' },
  { value: 'database', label: 'Database' },
  { value: 'kafka', label: 'Kafka' },
  { value: 'index', label: 'Index' },
  { value: 'cache', label: 'Cache' },
  { value: 'rate-limit', label: 'Rate limiter' },
  { value: 'circuit-breaker', label: 'Circuit breaker' },
];
const isNodeType = (value: unknown): value is NodeType =>
  NODE_TYPES.some(option => option.value === value);
const EDGE_KINDS: { value: EdgeKind; label: string }[] = [
  { value: 'sync', label: 'Sync request' },
  { value: 'async', label: 'Async request' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
];
const isEdgeKind = (value: unknown): value is EdgeKind =>
  EDGE_KINDS.some(option => option.value === value);
const DATA_SCALES: { value: DataScale; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'big', label: 'Big data' },
  { value: 'huge', label: 'Huge / hot' },
];
const isDataScale = (value: unknown): value is DataScale =>
  DATA_SCALES.some(option => option.value === value);
const typeLabel = (type: NodeType) => NODE_TYPES.find(option => option.value === type)?.label ?? type;
const numberPatch = <T, K extends string>(key: K, value: unknown) => {
  const n = Number(value);
  return value === '' || !Number.isFinite(n) ? { [key]: undefined } as T : { [key]: n } as T;
};

export const graphEntity: EntityDef<Graph> = entityDef<Graph>('graph', {
  label: 'Graph',
  labelOf: graph => graph.name,
  abilities: [],
});

/** Compute the visible endpoint for an edge anchor: if the node is inside a
 *  Collapsed container, the endpoint snaps to the outermost collapsed
 *  ancestor's visual rect. Otherwise it's the node itself. Returns null when
 *  neither resolves (orphaned edge — render skips it). */
const resolveEndpoint = (nodeRef: { kind: 'node'; id: string }, ctx: { graph: { getItem(ref: ItemRef): unknown }; parentChain(ref: ItemRef): ItemRef[]; isFolded(ref: ItemRef): boolean; boundsOf(ref: ItemRef): Rect | null }):
  | { ref: ItemRef; center: { x: number; y: number }; half: { w: number; h: number } }
  | null => {
  const chain = ctx.parentChain(nodeRef);
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
  const node = ctx.graph.getItem(nodeRef) as NodeEntity | undefined;
  if (!node?.Position) return null;
  return { ref: nodeRef, center: node.Position, half: { w: node.Size.w / 2, h: node.Size.h / 2 } };
};

export const EDGE_LABEL_FONT_SIZE = 13;
export const EDGE_LABEL_LINE_HEIGHT = 16;
export const EDGE_LABEL_CHAR_WIDTH = 9;
const EDGE_LABEL_PAD_X = 5;
const EDGE_LABEL_PAD_Y = 2;
const EDGE_LABEL_LINE_GAP = 10;
const EDGE_LABEL_AVOID_STEP = 12;
export const EDGE_LABEL_AVOID_REACH = 480;

export const measureEdgeLabel = (label: string): Size => {
  const lines = label.split(/\r?\n/);
  return {
    w: Math.max(1, ...lines.map(line => line.length)) * EDGE_LABEL_CHAR_WIDTH + EDGE_LABEL_PAD_X * 2,
    h: (lines.length - 1) * EDGE_LABEL_LINE_HEIGHT + EDGE_LABEL_FONT_SIZE + EDGE_LABEL_PAD_Y * 2,
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
  for (let pass = 0; pass < EDGE_LABEL_AVOID_REACH / EDGE_LABEL_AVOID_STEP && avoid.some(obstacle => overlaps(rect, obstacle)); pass++) {
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

const renderedEdgeLabelGeometry = (
  label: string,
  from: Position,
  to: Position,
  edgeId: string,
  ctx: EntityRenderCtx,
) => {
  const initial = edgeLabelGeometry(label, from, to, edgeId);
  const obstacles = ctx.boundsInRect('node', expandRect(initial.rect, EDGE_LABEL_AVOID_REACH));
  return edgeLabelGeometry(label, from, to, edgeId, obstacles);
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
    // Edge hidden-by-fold: an edge is visible when at least one endpoint is.
    // Individual endpoint collapse is handled by resolveEndpoint in draw().
    return edges;
  },
  draw(edge, ctx) {
    const from = resolveEndpoint({ kind: 'node', id: edge.From }, ctx);
    const to = resolveEndpoint({ kind: 'node', id: edge.To }, ctx);
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
    g.append(line('edge-line', tipAtSource.x, tipAtSource.y, tipAtTarget.x, tipAtTarget.y, { 'marker-end': 'url(#edge-arrow)' }));
    const label = edge.Label?.text;
    if (label) {
      const geometry = renderedEdgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, ctx);
      // Label content is built in LOCAL coords around (0,0) inside a translated
      // wrapper group — reposition then only rewrites the wrapper's transform.
      const wrap = svg('g', {
        class: 'edge-label-wrap',
        transform: geometry.transform,
        'data-label-width': geometry.size.w,
        'data-label-height': geometry.size.h,
      });
      // Opaque backdrop uses the same rectangle the layout engine reserves.
      wrap.append(svg('rect', {
        class: 'edge-label-bg',
        x: -geometry.size.w / 2,
        y: -geometry.size.h / 2,
        width: geometry.size.w,
        height: geometry.size.h,
        rx: 3,
      }));
      const text = svg('text', {
        class: `edge-label edge-kind-${edgeKind}`,
        'text-anchor': 'middle',
        'font-size': EDGE_LABEL_FONT_SIZE,
      });
      geometry.lines.forEach((line, i) => {
        const tspan = svg('tspan', { x: 0, y: geometry.textStartY + i * EDGE_LABEL_LINE_HEIGHT });
        tspan.textContent = line;
        text.append(tspan);
      });
      // Backdrop then text → text always paints on top of its own edge line.
      wrap.append(text);
      g.append(wrap);
    }
    return g;
  },
  /** Endpoint move (drag / nudge / cascade) — rewrite line coordinates and the
   *  label wrapper's transform on the EXISTING SVG group instead of rebuilding
   *  it. Uses the same endpoint resolution as draw (incl. collapsed-container
   *  substitution), so the fast path can't drift from the slow one. */
  reposition(el, edge, ctx) {
    const from = resolveEndpoint({ kind: 'node', id: edge.From }, ctx);
    const to = resolveEndpoint({ kind: 'node', id: edge.To }, ctx);
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
    const label = edge.Label?.text;
    if (wrap && label) wrap.setAttribute(
      'transform',
      renderedEdgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, ctx).transform,
    );
  },
  signature(edge) {
    return `v${edge.visualVersion}`;
  },
};

export const edgeEntity: EntityDef<GraphEdge, EdgePatch> = entityDef<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text?.trim() || 'Connection',
  abilities: [selectable<GraphEdge>(), configurable<GraphEdge>()],
  render: edgeRenderer,
  properties: [
    property<GraphEdge, EdgePatch>({
      id: 'label', label: 'Label', input: 'text',
      value: edge => edge.Label?.text ?? '',
      patch: (_edge, value) => ({ Label: { text: String(value) } }),
    }),
  ],
});

export const nodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};

// Fold is presentation state, not graph data. Keep the expanded model Size and
// cache only the currently rendered title-only geometry for edge anchors,
// culling, Fit, and the floating toolbar.
const renderedNodeSizes = new WeakMap<GraphNode, Size>();
const collapsedNodeSize = (node: GraphNode): Size => {
  const explicitLines = Math.max(1, node.Label.text.split(/\r?\n/).length);
  const capacity = Math.max(8, Math.floor((node.Size.w - 24) / 7.2));
  const wrappedLines = node.Label.text.split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / capacity)), 0);
  return { w: node.Size.w, h: clamp(Math.max(explicitLines, wrappedLines) * 22 + 20, 56, 120) };
};
const renderedNodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  const size = renderedNodeSizes.get(node) ?? node.Size;
  return { x: pos.x - size.w / 2, y: pos.y - size.h / 2, w: size.w, h: size.h };
};

const nodeRenderer: EntityRenderer<GraphNode> = {
  layer: 'html',
  bounds: renderedNodeBoundsOf,
  collect(graph, hiddenByFold, visibleNodeIds) {
    const g = graph as unknown as Graph;
    const all = visibleNodeIds
      ? [...visibleNodeIds].map(id => g.node(id)).filter((n): n is GraphNode => !!n)
      : g.nodes();
    return all.filter(n => !hiddenByFold({ kind: 'node', id: n.id }));
  },
  draw(node, ctx) {
    const el = ctx.cloneTemplate<HTMLElement>('node');
    const pos = node.Position ?? { x: 0, y: 0 };
    const ref = ctx.refOf(node.id);
    const nodeType = node.NodeType ?? 'text';
    const description = node.Description?.trim() ?? '';
    const meta = [
      node.ExpectedRps != null ? `${node.ExpectedRps}/s` : '',
      node.LatencyMs != null ? `${node.LatencyMs}ms` : '',
      node.ComputeMs != null ? `${node.ComputeMs}ms cpu` : '',
    ].filter(Boolean).join(' · ');
    ctx.tagItem(el, ref);
    el.tabIndex = -1;
    el.setAttribute('role', 'button');
    const editHint = globalThis.innerWidth <= 680 ? 'Hold for actions.' : 'Press Enter to edit.';
    el.setAttribute('aria-label', `${node.Label.text || 'Untitled'}; ${typeLabel(nodeType)} node. ${editHint}`);
    ctx.applyItemModes(el, ref);
    const collapsed = !!description && ctx.isFolded(ref);
    const renderedSize = collapsed ? collapsedNodeSize(node) : node.Size;
    renderedNodeSizes.set(node, renderedSize);
    el.classList.toggle('collapsed', collapsed);
    el.classList.add(`node-type-${nodeType}`);
    el.classList.toggle('has-description', !!description);
    if (description) el.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    el.classList.toggle('semantic-big-data', node.DataScale === 'big' || node.DataScale === 'huge');
    el.classList.toggle('semantic-stale-risk', node.FreshnessMs != null && node.FreshnessMs > 60_000);
    el.dataset.nodeType = nodeType;
    if (node.DataScale) el.dataset.dataScale = node.DataScale;
    const titleText = semanticTitle(node);
    if (titleText) el.title = titleText;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${renderedSize.w}px`;
    el.style.height = `${renderedSize.h}px`;
    ctx.templateText(el, 'type', typeLabel(nodeType));
    ctx.templateText(el, 'metrics', meta);
    ctx.templateText(el, 'title', node.Label.text);
    ctx.templateSlot(el, 'description').replaceChildren(renderMarkdown(description));
    ctx.wireAffordances(el);
    return el;
  },
  /** Drag / nudge only changes where the node sits — move the existing element
   *  (keeps its identity so CSS can ease the move; no rebuild). */
  reposition(el, node) {
    const pos = node.Position ?? { x: 0, y: 0 };
    (el as HTMLElement).style.left = `${pos.x}px`;
    (el as HTMLElement).style.top = `${pos.y}px`;
  },
  /** Everything the drawn node depends on *except* position, as one integer:
   *  Graph.updateNode bumps `visualVersion` on any non-Position change, so an
   *  unchanged version ⇒ the stage takes the cheap `reposition` path. */
  signature(node) {
    return `v${node.visualVersion}`;
  },
};

export const nodeEntity: EntityDef<GraphNode, NodePatch> = entityDef<GraphNode, NodePatch>('node', {
  label: 'Node',
  labelOf: node => node.Label.text,
  render: nodeRenderer,
  abilities: [
    selectable<GraphNode>(),
    draggable<GraphNode>(),
    nudgeable<GraphNode>(),
    collapsible<GraphNode>(node => !!node.Description?.trim()),
    editable<GraphNode>(),
    configurable<GraphNode>(),
  ],
  properties: [
    property<GraphNode, NodePatch>({
      id: 'title', label: 'Title', input: 'text',
      value: node => node.Label.text,
      patch: (_node, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphNode, NodePatch>({
      id: 'nodeType', label: 'Type', input: 'select', options: NODE_TYPES,
      value: node => node.NodeType ?? 'text',
      patch: (_node, value) => isNodeType(value) ? { NodeType: value } : undefined,
    }),
    // property<GraphNode, NodePatch>({
    //   id: 'expectedRps', label: 'Expected rps', input: 'number', min: 0, step: 10, group: 'Performance',
    //   value: node => node.ExpectedRps ?? '',
    //   patch: (_node, value) => numberPatch<NodePatch, 'ExpectedRps'>('ExpectedRps', value),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'latencyMs', label: 'Latency budget ms', input: 'number', min: 0, step: 1, group: 'Performance',
    //   value: node => node.LatencyMs ?? '',
    //   patch: (_node, value) => numberPatch<NodePatch, 'LatencyMs'>('LatencyMs', value),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'computeMs', label: 'Compute ms', input: 'number', min: 0, step: 1, group: 'Performance',
    //   value: node => node.ComputeMs ?? '',
    //   patch: (_node, value) => numberPatch<NodePatch, 'ComputeMs'>('ComputeMs', value),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'dataScale', label: 'Data scale', input: 'select', options: DATA_SCALES, group: 'Semantics',
    //   value: node => node.DataScale ?? 'medium',
    //   patch: (_node, value) => isDataScale(value) ? { DataScale: value } : undefined,
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'purpose', label: 'Purpose', input: 'textarea', rows: 3, group: 'Semantics',
    //   value: node => node.Purpose ?? '',
    //   patch: (_node, value) => ({ Purpose: String(value) }),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'assumptions', label: 'Assumptions', input: 'textarea', rows: 3, group: 'Semantics',
    //   value: node => node.Assumptions ?? '',
    //   patch: (_node, value) => ({ Assumptions: String(value) }),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'limits', label: 'Limits', input: 'textarea', rows: 3, group: 'Semantics',
    //   value: node => node.Limits ?? '',
    //   patch: (_node, value) => ({ Limits: String(value) }),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'whatThen', label: 'What then', input: 'textarea', rows: 3, group: 'Semantics',
    //   value: node => node.WhatThen ?? '',
    //   patch: (_node, value) => ({ WhatThen: String(value) }),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'observability', label: 'Observability', input: 'textarea', rows: 3, group: 'Observability',
    //   value: node => node.Observability ?? '',
    //   patch: (_node, value) => ({ Observability: String(value) }),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'failureMode', label: 'What if fails', input: 'textarea', rows: 3, group: 'Observability',
    //   value: node => node.FailureMode ?? '',
    //   patch: (_node, value) => ({ FailureMode: String(value) }),
    // }),
    // property<GraphNode, NodePatch>({
    //   id: 'freshnessMs', label: 'Freshness budget ms', input: 'number', min: 0, step: 100, group: 'Observability',
    //   value: node => node.FreshnessMs ?? '',
    //   patch: (_node, value) => numberPatch<NodePatch, 'FreshnessMs'>('FreshnessMs', value),
    // }),
    property<GraphNode, NodePatch>({
      id: 'description', label: 'Markdown description', input: 'textarea', rows: 6, group: 'Content',
      value: node => node.Description ?? '',
      patch: (_node, value) => ({ Description: String(value) }),
    }),
    property<GraphNode, NodePatch>({
      id: 'width', label: 'Width', input: 'number', min: 96, step: 8,
      value: node => node.Size.w,
      patch: (node, value) => {
        const width = Number(value);
        return Number.isFinite(width) ? { Size: { ...node.Size, w: clamp(width, 96, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'height', label: 'Height', input: 'number', min: 40, step: 8,
      value: node => node.Size.h,
      patch: (node, value) => {
        const height = Number(value);
        return Number.isFinite(height) ? { Size: { ...node.Size, h: clamp(height, 40, 900) } } : undefined;
      },
    }),
    // Collapse is fold state (presentation), not a node property — toggle it with
    // the fold chevron / item.collapse.toggle, not the properties modal.
  ],
});

export const builtinEntities: EntityDef<unknown, unknown>[] = [
  graphEntity as EntityDef<unknown, unknown>,
  nodeEntity as EntityDef<unknown, unknown>,
  edgeEntity as EntityDef<unknown, unknown>,
];
