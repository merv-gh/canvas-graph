import { clamp, semanticTitle } from '../core';
import { renderMarkdown } from '../core/markdown';
import { collapsible, configurable, draggable, editable, nudgeable, selectable } from '../abilities';
import type { DataScale, EdgeKind, Graph, GraphEdge, GraphNode, NodeEntity, EdgePatch, NodePatch, NodeType } from './graph';
import type { EntityDef, EntityRenderer, ItemRef, PropertyDef, Rect } from '../types';

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
  { value: 'square', label: 'Square' },
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
  labelOf: graph => graph.id,
  abilities: [],
});

/** Shrink the line endpoint to the target rect's border so the arrowhead lands
 *  outside the card, not inside it. Treats the target as an axis-aligned
 *  rectangle centered on `(cx, cy)` with half-dims `(hw, hh)`. */
const intersectRectBoundary = (outside: { x: number; y: number }, rectCenter: { x: number; y: number }, half: { w: number; h: number }) => {
  const { x: cx, y: cy } = rectCenter;
  const dx = outside.x - cx, dy = outside.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : Math.abs(half.w / dx);
  const ty = dy === 0 ? Infinity : Math.abs(half.h / dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
};

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
      const midX = (from.center.x + to.center.x) / 2;
      const midY = (from.center.y + to.center.y) / 2;
      const lines = label.split(/\r?\n/);
      const lineH = 14;
      // Center the block on the edge midpoint (top line lifted by half the block).
      const startY = midY - ((lines.length - 1) * lineH) / 2 - 4;
      const text = svg('text', { class: `edge-label edge-kind-${edgeKind}`, 'text-anchor': 'middle' });
      lines.forEach((line, i) => {
        const tspan = svg('tspan', { x: midX, y: startY + i * lineH });
        tspan.textContent = line;
        text.append(tspan);
      });
      g.append(text);
    }
    return g;
  },
  signature(edge) {
    return `${edge.From}->${edge.To}|${edge.Label?.text ?? ''}|${edge.EdgeKind ?? ''}|${edge.LatencyMs ?? ''}|${edge.ThroughputRps ?? ''}|${edge.PayloadKb ?? ''}|${edge.Purpose ?? ''}|${edge.Assumptions ?? ''}|${edge.Limits ?? ''}|${edge.WhatThen ?? ''}|${edge.Observability ?? ''}|${edge.FailureMode ?? ''}|${edge.DataScale ?? ''}|${edge.FreshnessMs ?? ''}`;
  },
};

export const edgeEntity: EntityDef<GraphEdge, EdgePatch> = entityDef<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text ?? `${edge.From}->${edge.To}`,
  abilities: [],
  render: edgeRenderer,
  properties: [
    property<GraphEdge, EdgePatch>({
      id: 'label', label: 'Label', input: 'text',
      value: edge => edge.Label?.text ?? '',
      patch: (_edge, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'edgeKind', label: 'Type', input: 'select', options: EDGE_KINDS,
      value: edge => edge.EdgeKind ?? 'sync',
      patch: (_edge, value) => isEdgeKind(value) ? { EdgeKind: value } : undefined,
    }),
    property<GraphEdge, EdgePatch>({
      id: 'latencyMs', label: 'Latency ms', input: 'number', min: 0, step: 1, group: 'Performance',
      value: edge => edge.LatencyMs ?? '',
      patch: (_edge, value) => numberPatch<EdgePatch, 'LatencyMs'>('LatencyMs', value),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'throughputRps', label: 'Throughput rps', input: 'number', min: 0, step: 10, group: 'Performance',
      value: edge => edge.ThroughputRps ?? '',
      patch: (_edge, value) => numberPatch<EdgePatch, 'ThroughputRps'>('ThroughputRps', value),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'payloadKb', label: 'Payload KB', input: 'number', min: 0, step: 1, group: 'Performance',
      value: edge => edge.PayloadKb ?? '',
      patch: (_edge, value) => numberPatch<EdgePatch, 'PayloadKb'>('PayloadKb', value),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'purpose', label: 'Purpose', input: 'textarea', rows: 3, group: 'Semantics',
      value: edge => edge.Purpose ?? '',
      patch: (_edge, value) => ({ Purpose: String(value) }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'assumptions', label: 'Assumptions', input: 'textarea', rows: 3, group: 'Semantics',
      value: edge => edge.Assumptions ?? '',
      patch: (_edge, value) => ({ Assumptions: String(value) }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'limits', label: 'Limits', input: 'textarea', rows: 3, group: 'Semantics',
      value: edge => edge.Limits ?? '',
      patch: (_edge, value) => ({ Limits: String(value) }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'whatThen', label: 'What then', input: 'textarea', rows: 3, group: 'Semantics',
      value: edge => edge.WhatThen ?? '',
      patch: (_edge, value) => ({ WhatThen: String(value) }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'observability', label: 'Observability', input: 'textarea', rows: 3, group: 'Observability',
      value: edge => edge.Observability ?? '',
      patch: (_edge, value) => ({ Observability: String(value) }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'failureMode', label: 'What if fails', input: 'textarea', rows: 3, group: 'Observability',
      value: edge => edge.FailureMode ?? '',
      patch: (_edge, value) => ({ FailureMode: String(value) }),
    }),
    property<GraphEdge, EdgePatch>({
      id: 'freshnessMs', label: 'Freshness budget ms', input: 'number', min: 0, step: 100, group: 'Observability',
      value: edge => edge.FreshnessMs ?? '',
      patch: (_edge, value) => numberPatch<EdgePatch, 'FreshnessMs'>('FreshnessMs', value),
    }),
  ],
});

export const nodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};

const nodeRenderer: EntityRenderer<GraphNode> = {
  layer: 'html',
  bounds: nodeBoundsOf,
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
    ctx.applyItemModes(el, ref);
    el.classList.toggle('collapsed', ctx.isFolded(ref));
    el.classList.add(`node-type-${nodeType}`);
    el.classList.toggle('has-description', !!description);
    el.classList.toggle('semantic-big-data', node.DataScale === 'big' || node.DataScale === 'huge');
    el.classList.toggle('semantic-stale-risk', node.FreshnessMs != null && node.FreshnessMs > 60_000);
    el.dataset.nodeType = nodeType;
    if (node.DataScale) el.dataset.dataScale = node.DataScale;
    const titleText = semanticTitle(node);
    if (titleText) el.title = titleText;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${node.Size.w}px`;
    el.style.height = `${node.Size.h}px`;
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
  /** Everything the drawn node depends on *except* position. Unchanged ⇒ the
   *  stage takes the cheap `reposition` path instead of a full redraw. */
  signature(node) {
    return `${node.NodeType ?? 'text'}|${node.Size.w}x${node.Size.h}|${node.Label.text}|${node.Description ?? ''}|${node.ComputeMs ?? ''}|${node.ExpectedRps ?? ''}|${node.LatencyMs ?? ''}|${node.Purpose ?? ''}|${node.Assumptions ?? ''}|${node.Limits ?? ''}|${node.WhatThen ?? ''}|${node.Observability ?? ''}|${node.FailureMode ?? ''}|${node.DataScale ?? ''}|${node.FreshnessMs ?? ''}`;
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
    collapsible<GraphNode>(),
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
