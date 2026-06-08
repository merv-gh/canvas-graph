import { collapsible, configurable, draggable, editable, nudgeable, selectable } from '../abilities';
import { clamp } from '../core';
import type {
  EdgePatch,
  EntityDef,
  EntityRenderer,
  ItemRef,
  NodePatch,
  PropertyDef,
  Rect,
} from '../types';
import { Graph, GraphEdge, GraphNode } from './graph';

const property = <T, Patch>(def: PropertyDef<T, Patch>) => def;
const entity = <T, Patch = unknown>(kind: string, def: Omit<EntityDef<T, Patch>, 'kind'>): EntityDef<T, Patch> => ({ kind, ...def });

const SVG_NS = 'http://www.w3.org/2000/svg';

const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
};

export const graphEntity = entity<Graph>('graph', {
  label: 'Graph',
  labelOf: graph => graph.id,
  abilities: [],
});

const edgeRenderer: EntityRenderer<GraphEdge> = {
  layer: 'svg',
  draw(edge, ctx) {
    const from = ctx.graph.getNode(edge.From);
    const to = ctx.graph.getNode(edge.To);
    if (!from?.Position || !to?.Position) return null;
    const ref: ItemRef = { kind: 'edge', id: edge.id };
    const g = svg('g', {});
    g.setAttribute('class', 'edge');
    (g as unknown as HTMLElement).dataset.edgeId = edge.id;
    const line = (className: string, extra: Record<string, string | number> = {}) => {
      const el = svg('line', {
        x1: from.Position!.x, y1: from.Position!.y, x2: to.Position!.x, y2: to.Position!.y,
        class: className, ...extra,
      });
      (el as unknown as HTMLElement).dataset.edgeId = edge.id;
      ctx.tagItem(el, ref);
      ctx.applyItemModes(el, ref);
      return el;
    };
    g.append(line('edge-hit', { tabindex: -1 }));
    g.append(line('edge-line'));
    if (edge.Label?.text) {
      const text = svg('text', {
        class: 'edge-label',
        x: (from.Position.x + to.Position.x) / 2,
        y: (from.Position.y + to.Position.y) / 2 - 4,
        'text-anchor': 'middle',
      });
      text.textContent = edge.Label.text;
      g.append(text);
    }
    return g;
  },
};

// Edge entity: pure data + label property (configurable later). No abilities yet —
// edges don't carry their own affordances. When edges grow features (e.g., delete via X
// while selected), declare them as abilities here.
export const edgeEntity = entity<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text ?? `${edge.From}->${edge.To}`,
  abilities: [],
  render: edgeRenderer,
  properties: [
    property<GraphEdge, EdgePatch>({
      id: 'label',
      label: 'Label',
      input: 'text',
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
    const ref: ItemRef = { kind: 'node', id: node.id };
    el.dataset.nodeId = node.id;
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

export const nodeEntity = entity<GraphNode, NodePatch>('node', {
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
      id: 'title',
      label: 'Title',
      input: 'text',
      value: node => node.Label.text,
      patch: (_node, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphNode, NodePatch>({
      id: 'width',
      label: 'Width',
      input: 'number',
      min: 96,
      step: 8,
      value: node => node.Size.w,
      patch: (node, value) => {
        const width = Number(value);
        return Number.isFinite(width) ? { Size: { ...node.Size, w: clamp(width, 96, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'height',
      label: 'Height',
      input: 'number',
      min: 40,
      step: 8,
      value: node => node.Size.h,
      patch: (node, value) => {
        const height = Number(value);
        return Number.isFinite(height) ? { Size: { ...node.Size, h: clamp(height, 40, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'collapsed',
      label: 'Collapsed',
      input: 'checkbox',
      value: node => !!node.Collapsed,
      patch: (_node, value) => ({ Collapsed: !!value }),
    }),
  ],
});
