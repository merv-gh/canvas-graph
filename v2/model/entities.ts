import { clamp } from '../core';
import { collapsible, configurable, draggable, editable, nudgeable, selectable } from '../abilities';
import type { Graph, GraphEdge, GraphNode, NodeEntity, EdgePatch, NodePatch } from './graph';
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
const resolveEndpoint = (nodeRef: { kind: 'node'; id: string }, ctx: { graph: { getItem(ref: ItemRef): unknown }; parentChain(ref: ItemRef): ItemRef[]; boundsOf(ref: ItemRef): Rect | null }):
  | { ref: ItemRef; center: { x: number; y: number }; half: { w: number; h: number } }
  | null => {
  const chain = ctx.parentChain(nodeRef);
  // Outermost collapsed ancestor wins — pick the highest-level visible boundary.
  const collapsed = chain.find(a => {
    const item = ctx.graph.getItem(a) as { Collapsed?: boolean } | undefined;
    return !!item?.Collapsed;
  });
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
    g.setAttribute('class', 'edge');
    const line = (className: string, x1: number, y1: number, x2: number, y2: number, extra: Record<string, string | number> = {}) => {
      const el = svg('line', { x1, y1, x2, y2, class: className, ...extra });
      ctx.tagItem(el, ref);
      ctx.applyItemModes(el, ref);
      return el;
    };
    g.append(line('edge-hit', from.center.x, from.center.y, to.center.x, to.center.y, { tabindex: -1 }));
    g.append(line('edge-line', tipAtSource.x, tipAtSource.y, tipAtTarget.x, tipAtTarget.y, { 'marker-end': 'url(#edge-arrow)' }));
    if (edge.Label?.text) {
      const text = svg('text', {
        class: 'edge-label',
        x: (from.center.x + to.center.x) / 2,
        y: (from.center.y + to.center.y) / 2 - 4,
        'text-anchor': 'middle',
      });
      text.textContent = edge.Label.text;
      g.append(text);
    }
    return g;
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
  ],
});

export const nodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};

const nodeRenderer: EntityRenderer<GraphNode> = {
  layer: 'html',
  bounds: nodeBoundsOf,
  draw(node, ctx) {
    const el = ctx.cloneTemplate<HTMLElement>('node');
    const pos = node.Position ?? { x: 0, y: 0 };
    const ref = ctx.refOf(node.id);
    ctx.tagItem(el, ref);
    el.tabIndex = -1;
    ctx.applyItemModes(el, ref);
    el.classList.toggle('collapsed', !!node.Collapsed);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${node.Size.w}px`;
    el.style.height = `${node.Size.h}px`;
    ctx.templateText(el, 'title', node.Label.text);
    ctx.templateText(el, 'meta', node.id);
    ctx.wireAffordances(el);
    return el;
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
    property<GraphNode, NodePatch>({
      id: 'collapsed', label: 'Collapsed', input: 'checkbox',
      value: node => !!node.Collapsed,
      patch: (_node, value) => ({ Collapsed: !!value }),
    }),
  ],
});

export const builtinEntities: EntityDef<unknown, unknown>[] = [
  graphEntity as EntityDef<unknown, unknown>,
  nodeEntity as EntityDef<unknown, unknown>,
  edgeEntity as EntityDef<unknown, unknown>,
];
