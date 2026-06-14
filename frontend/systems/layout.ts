import { itemFoldId, nodeRef, type Registry } from '../core';
import type { GraphEdge, GraphNode } from '../model';
import type { AppCtx } from '../core';
import type { ItemRef, Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'layout.apply.radial': void;
    'layout.apply.grid': void;
    'layout.apply.tidy': void;
  }
}

/** A self-contained slice that a layout algorithm operates over.
 *  - `origin` is the anchor in graph-space (0,0 for the root scope; the
 *    container's Position for a nested scope).
 *  - `nodes` are the nodes that belong to this scope only.
 *  - `edges` are the edges whose endpoints are both in `nodes`.
 *
 *  Layout functions never reach back into the graph for a wider context.
 *  Whatever the partitioner gave them is the world. */
export type LayoutScope = {
  origin: Position;
  parent: ItemRef | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Partition the current graph's nodes by hierarchy. Returns one scope per
 *  parent (plus one for the root scope). Edges are split so each scope only
 *  sees its own. With no hierarchy providers (the flat case), every node is
 *  in the root scope and behavior is identical to a flat graph.
 *
 *  Nodes nested inside a `Collapsed` ancestor are excluded — moving hidden
 *  nodes would scramble their positions for when the user expands again. */
export function partitionByScope(ctx: AppCtx): LayoutScope[] {
  const graph = ctx.graphs.current;
  const hierarchy = ctx.contexts.hierarchy;
  const fold = ctx.contexts.fold;
  const all = graph.nodes();
  const hiddenByCollapse = (node: GraphNode): boolean =>
    hierarchy.parentChain({ kind: 'node', id: node.id }).some(ancestor => fold.folded(itemFoldId(ancestor, graph.id)));
  const groups = new Map<string, { parent: ItemRef | null; nodes: GraphNode[] }>();
  for (const node of all) {
    if (hiddenByCollapse(node)) continue;
    const chain = hierarchy.parentChain({ kind: 'node', id: node.id });
    const parent = chain.length ? chain[chain.length - 1] : null;
    const key = parent ? `${parent.kind}:${parent.id}` : '';
    const group = groups.get(key) ?? { parent, nodes: [] };
    group.nodes.push(node);
    groups.set(key, group);
  }
  const rootOrigin = (nodes: GraphNode[]): Position => {
    const positioned = nodes.map(node => node.Position).filter((p): p is Position => !!p);
    if (!positioned.length) return { x: 0, y: 0 };
    return {
      x: positioned.reduce((sum, p) => sum + p.x, 0) / positioned.length,
      y: positioned.reduce((sum, p) => sum + p.y, 0) / positioned.length,
    };
  };
  return [...groups.values()].map(({ parent, nodes }) => {
    const origin = parent
      ? (graph.getItem(parent) as { Position?: Position } | undefined)?.Position ?? { x: 0, y: 0 }
      : rootOrigin(nodes);
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = graph.edges().filter(e => nodeIds.has(e.From) && nodeIds.has(e.To));
    return { origin, parent, nodes, edges };
  });
}

type PatchEmit = (id: string, position: Position) => void;

/** Tidy tree per scope: BFS levels from in-degree-zero roots, columns spread
 *  around scope.origin.x, rows step down from scope.origin.y. */
function tidyScope(scope: LayoutScope, set: PatchEmit) {
  const inDeg = new Map<string, number>(scope.nodes.map(n => [n.id, 0]));
  scope.edges.forEach(e => inDeg.set(e.To, (inDeg.get(e.To) ?? 0) + 1));
  const roots = scope.nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0);
  if (!roots.length) return;
  const level = new Map<string, number>();
  const queue: string[] = [];
  roots.forEach(r => { level.set(r.id, 0); queue.push(r.id); });
  while (queue.length) {
    const id = queue.shift()!;
    const lv = level.get(id)!;
    scope.edges.filter(e => e.From === id).forEach(e => {
      if (!level.has(e.To)) { level.set(e.To, lv + 1); queue.push(e.To); }
    });
  }
  const byLevel = new Map<number, string[]>();
  scope.nodes.forEach(n => {
    const lv = level.get(n.id) ?? 0;
    (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)!).push(n.id);
  });
  const rowH = 130;
  byLevel.forEach((ids, lv) => {
    const spread = (ids.length - 1) * 180;
    ids.forEach((id, i) => set(id, {
      x: scope.origin.x + -spread / 2 + i * 180,
      y: scope.origin.y + lv * rowH,
    }));
  });
}

/** Square-ish grid per scope, centered at scope.origin. */
function gridScope(scope: LayoutScope, set: PatchEmit) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(scope.nodes.length)));
  const colSize = 200, rowSize = 100;
  const startX = scope.origin.x - ((cols - 1) * colSize) / 2;
  const startY = scope.origin.y - ((Math.ceil(scope.nodes.length / cols) - 1) * rowSize) / 2;
  scope.nodes.forEach((n, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    set(n.id, { x: startX + col * colSize, y: startY + row * rowSize });
  });
}

/** Radial per scope: pick a center (focused if it lives in this scope, else
 *  the first node), arrange the rest in a ring. The center node itself is not
 *  moved — radial preserves where the picked anchor sits. */
function radialScope(scope: LayoutScope, focusedId: string | undefined, set: PatchEmit) {
  if (!scope.nodes.length) return;
  const inScope = (id: string | undefined) => !!id && scope.nodes.some(n => n.id === id);
  const root = (focusedId && inScope(focusedId) ? scope.nodes.find(n => n.id === focusedId) : scope.nodes[0])!;
  const others = scope.nodes.filter(n => n.id !== root.id);
  const radius = Math.max(160, 60 + others.length * 22);
  const center = root.Position ?? scope.origin;
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    set(n.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  });
}

export function registerLayout(system: Registry) {
  system('layout', (ctx) => {
    const { on, emit, contexts, selection, contribute } = ctx;
    contribute({ surface: 'top', command: 'layout.apply.tidy', kind: 'button', text: 'Tidy', order: 65 });
    contribute({ surface: 'top', command: 'layout.apply.radial', kind: 'button', text: 'Radial', order: 66 });
    contexts.commands.register([
      { id: 'layout.apply.radial', label: 'Radial layout', group: 'layout', input: { on: 'keydown', key: 'r', prevent: true } },
      { id: 'layout.apply.grid',   label: 'Grid layout',   group: 'layout', input: { on: 'keydown', key: 'G', shift: true, prevent: true } },
      { id: 'layout.apply.tidy',   label: 'Tidy tree layout', group: 'layout', input: { on: 'keydown', key: 't', prevent: true } },
    ]);

    const set: PatchEmit = (id, Position) => emit('item.update', { ref: nodeRef(id), patch: { Position } });

    on('layout.apply.tidy', () => partitionByScope(ctx).forEach(scope => tidyScope(scope, set)));
    on('layout.apply.grid', () => partitionByScope(ctx).forEach(scope => gridScope(scope, set)));
    on('layout.apply.radial', () => {
      const focusedId = selection.focusedNode()?.id ?? selection.selectedNode()?.id;
      partitionByScope(ctx).forEach(scope => radialScope(scope, focusedId, set));
    });
  }, { requires: ['graph'] });
}
