import { itemFoldId, nodeRef, type Registry } from '../core';
import type { GraphEdge, GraphNode } from '../model';
import type { AppCtx } from '../core';
import type { ItemRef, Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'layout.apply.radial': void;
    'layout.apply.grid': void;
    'layout.apply.tidy': void;
    /** User-triggered layout: apply the algorithm AND re-frame the view. The bare
     *  `layout.apply.*` events stay fit-free so the autoLayout feature (which tidies
     *  on every node create) doesn't yank the camera. */
    'layout.fit': { kind: 'tidy' | 'grid' | 'radial' };
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
  bounds?: { x: number; y: number; w: number; h: number };
  sections?: { id: string; title: string; weight: number }[];
  sectionAxis?: 'rows' | 'columns';
  childSections?: Record<string, string>;
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
    const parentItem = parent ? graph.getItem(parent) as {
      Position?: Position;
      Sections?: { id: string; title: string; weight?: number }[];
      SectionAxis?: 'rows' | 'columns';
      ChildSections?: Record<string, string>;
    } | undefined : undefined;
    const parentEntity = parent ? ctx.model.entity(parent.kind) : undefined;
    const parentBounds = parent && parentItem ? parentEntity?.render?.bounds?.(parentItem) ?? undefined : undefined;
    const origin = parent
      ? parentItem?.Position ?? { x: 0, y: 0 }
      : rootOrigin(nodes);
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = graph.edges().filter(e => nodeIds.has(e.From) && nodeIds.has(e.To));
    return {
      origin,
      parent,
      nodes,
      edges,
      bounds: parentBounds,
      sections: parentItem?.Sections?.map((section, index) => ({
        id: section.id || `s${index + 1}`,
        title: section.title,
        weight: Math.max(0.15, Number(section.weight) || 1),
      })),
      sectionAxis: parentItem?.SectionAxis ?? 'rows',
      childSections: parentItem?.ChildSections,
    };
  });
}

type PatchEmit = (id: string, position: Position) => void;
const nodeKey = (id: string) => `node:${id}`;

// Spacing is derived from actual node sizes so boxes never touch and labels
// (which live at edge midpoints) get room. Positions are node CENTERS.
const GAP_X = 56;
const GAP_Y = 72;
const LABEL_LINE_H = 14;
const sizeOf = (node: GraphNode) => node.Size ?? { w: 160, h: 72 };

// Edge labels live at (offset) edge midpoints, so a tall multi-line label needs
// vertical room between the rows it spans — otherwise it's buried behind the
// next node. Budget the tallest label in the scope into the row/ring gaps.
const labelPadOf = (edges: GraphEdge[]) => {
  let maxLines = 0;
  for (const e of edges) {
    const text = e.Label?.text;
    if (text) maxLines = Math.max(maxLines, text.split(/\r?\n/).length);
  }
  return maxLines * LABEL_LINE_H;
};

function sectionRects(scope: LayoutScope) {
  if (!scope.bounds || !scope.sections?.length) return [];
  const inset = 32;
  const rect = {
    x: scope.bounds.x + inset,
    y: scope.bounds.y + LABEL_SECTION_TOP,
    w: Math.max(80, scope.bounds.w - inset * 2),
    h: Math.max(60, scope.bounds.h - LABEL_SECTION_TOP - inset),
  };
  const total = scope.sections.reduce((sum, section) => sum + section.weight, 0) || 1;
  let cursor = scope.sectionAxis === 'columns' ? rect.x : rect.y;
  return scope.sections.map(section => {
    const ratio = section.weight / total;
    if (scope.sectionAxis === 'columns') {
      const w = rect.w * ratio;
      const out = { section, rect: { x: cursor, y: rect.y, w, h: rect.h } };
      cursor += w;
      return out;
    }
    const h = rect.h * ratio;
    const out = { section, rect: { x: rect.x, y: cursor, w: rect.w, h } };
    cursor += h;
    return out;
  });
}

const LABEL_SECTION_TOP = 36;

function sectionedScope(scope: LayoutScope, set: PatchEmit) {
  const bands = sectionRects(scope);
  if (!bands.length) return false;
  const fallback = bands[0].section.id;
  bands.forEach(({ section, rect }) => {
    const nodes = scope.nodes.filter(node => (scope.childSections?.[nodeKey(node.id)] ?? fallback) === section.id);
    if (!nodes.length) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const rows = Math.max(1, Math.ceil(nodes.length / cols));
    nodes.forEach((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = rect.x + ((col + 1) / (cols + 1)) * rect.w;
      const y = rect.y + ((row + 1) / (rows + 1)) * rect.h;
      set(node.id, { x, y });
    });
  });
  return true;
}

/** Tidy tree per scope: BFS levels from in-degree-zero roots, columns spread
 *  around scope.origin.x, rows step down from scope.origin.y. */
function tidyScope(scope: LayoutScope, set: PatchEmit) {
  if (sectionedScope(scope, set)) return;
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
  const byLevel = new Map<number, GraphNode[]>();
  scope.nodes.forEach(n => {
    const lv = level.get(n.id) ?? 0;
    (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)!).push(n);
  });
  // Walk levels top→down; within each level pack nodes left→right by their real
  // widths (+ gap) and center the row on origin.x. Row height = tallest node,
  // so the next level clears it with GAP_Y to spare.
  const levels = [...byLevel.entries()].sort((a, b) => a[0] - b[0]);
  const labelPad = labelPadOf(scope.edges);
  let y = scope.origin.y;
  for (const [, nodes] of levels) {
    const rowH = Math.max(...nodes.map(n => sizeOf(n).h));
    const totalW = nodes.reduce((sum, n) => sum + sizeOf(n).w, 0) + GAP_X * Math.max(0, nodes.length - 1);
    let x = scope.origin.x - totalW / 2;
    nodes.forEach(n => {
      const w = sizeOf(n).w;
      set(n.id, { x: x + w / 2, y: y + rowH / 2 });
      x += w + GAP_X;
    });
    y += rowH + GAP_Y + labelPad;
  }
}

/** Square-ish grid per scope, centered at scope.origin. Cell size = the largest
 *  node in the scope + gaps, so no two boxes touch regardless of text length. */
function gridScope(scope: LayoutScope, set: PatchEmit) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(scope.nodes.length)));
  const rows = Math.ceil(scope.nodes.length / cols);
  const maxW = Math.max(...scope.nodes.map(n => sizeOf(n).w), 0);
  const maxH = Math.max(...scope.nodes.map(n => sizeOf(n).h), 0);
  const colSize = maxW + GAP_X, rowSize = maxH + GAP_Y + labelPadOf(scope.edges);
  const startX = scope.origin.x - ((cols - 1) * colSize) / 2;
  const startY = scope.origin.y - ((rows - 1) * rowSize) / 2;
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
  // Radius large enough that neighbours on the ring don't overlap: the ring's
  // circumference must hold every node's width plus a gap.
  const circumference = others.reduce((sum, n) => sum + sizeOf(n).w + GAP_X, 0);
  const rootReach = Math.max(sizeOf(root).w, sizeOf(root).h) / 2;
  const labelPad = labelPadOf(scope.edges);
  const radius = Math.max(160, 60 + others.length * 22, circumference / (2 * Math.PI) + rootReach + labelPad);
  const center = root.Position ?? scope.origin;
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    set(n.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  });
}

export function registerLayout(system: Registry) {
  system('layout', (ctx) => {
    const { on, emit, contexts, selection, contribute, declarePanel } = ctx;
    // Layout gets its own dedicated panel (bottom-left), fully separate from the
    // top-center graph-editing bar — distinct button groups, distinct places.
    declarePanel({ id: 'layout', anchor: 'bottom-left', movable: false, layout: 'toolbar', order: 10 });
    contribute({ surface: 'top', panel: 'layout', command: 'layout.apply.tidy', kind: 'button', text: 'Tidy', order: 65 });
    contribute({ surface: 'top', panel: 'layout', command: 'layout.apply.grid', kind: 'button', text: 'Grid', order: 66 });
    contribute({ surface: 'top', panel: 'layout', command: 'layout.apply.radial', kind: 'button', text: 'Radial', order: 67 });
    // User-facing commands re-frame after applying (via layout.fit); the raw
    // layout.apply.* events do the layout only — reused by autoLayout on create.
    contexts.commands.register([
      { id: 'layout.apply.radial', label: 'Radial layout', group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 'r', prevent: true }, payload: () => ({ kind: 'radial' }) },
      { id: 'layout.apply.grid',   label: 'Grid layout',   group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 'G', shift: true, prevent: true }, payload: () => ({ kind: 'grid' }) },
      { id: 'layout.apply.tidy',   label: 'Tidy tree layout', group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 't', prevent: true }, payload: () => ({ kind: 'tidy' }) },
    ]);

    const set: PatchEmit = (id, Position) => emit('item.update', { ref: nodeRef(id), patch: { Position } });

    on('layout.apply.tidy', () => partitionByScope(ctx).forEach(scope => tidyScope(scope, set)));
    on('layout.apply.grid', () => partitionByScope(ctx).forEach(scope => gridScope(scope, set)));
    on('layout.apply.radial', () => {
      const focusedId = selection.focusedNode()?.id ?? selection.selectedNode()?.id;
      partitionByScope(ctx).forEach(scope => radialScope(scope, focusedId, set));
    });
    // Apply the algorithm, then fit — so switching layouts re-centers the graph and
    // it never "walks away" off-screen.
    on('layout.fit', ({ kind }) => {
      emit(({ tidy: 'layout.apply.tidy', grid: 'layout.apply.grid', radial: 'layout.apply.radial' } as const)[kind]);
      emit('view.fit.all');
    });
  }, { requires: ['graph'] });
}
