import { itemFoldId } from '../core';
import type { AppCtx } from '../core';
import { addToRectIndex, createRectIndex, intersectRectBoundary, queryRectIndex, rectsOverlap } from '../core/geometry';
import type { GraphEdge, GraphNode } from '../model';
import { EDGE_LABEL_AVOID_REACH, edgeLabelGeometry, measureEdgeLabel } from '../model/entities';
import type { ItemRef, Position, Rect } from '../types';

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

export type PatchEmit = (id: string, position: Position) => void;
const nodeKey = (id: string) => `node:${id}`;

// Spacing is derived from actual node sizes so boxes never touch and labels
// (which live at edge midpoints) get room. Positions are node CENTERS.
export const GAP_X = 56;
export const GAP_Y = 72;
export const sizeOf = (node: GraphNode) => node.Size ?? { w: 160, h: 72 };

// Edge labels live at (offset) edge midpoints, so a tall multi-line label needs
// vertical room between the rows it spans — otherwise it's buried behind the
// next node. Budget the tallest label in the scope into the row/ring gaps.
const labelFootprintOf = (edges: GraphEdge[]) => {
  let h = 0, w = 0;
  for (const e of edges) {
    const text = e.Label?.text;
    if (!text) continue;
    const size = measureEdgeLabel(text);
    h = Math.max(h, size.h);
    w = Math.max(w, size.w);
  }
  return { h, w };
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

export function sectionedScope(scope: LayoutScope, set: PatchEmit) {
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
export function tidyScope(scope: LayoutScope, set: PatchEmit) {
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
  const label = labelFootprintOf(scope.edges);
  const gapX = GAP_X + Math.min(260, label.w);
  const placed: Array<{ id: string; position: Position }> = [];
  let y = 0;
  for (const [, nodes] of levels) {
    const rowH = Math.max(...nodes.map(n => sizeOf(n).h));
    const totalW = nodes.reduce((sum, n) => sum + sizeOf(n).w, 0) + gapX * Math.max(0, nodes.length - 1);
    let x = -totalW / 2;
    nodes.forEach(n => {
      const w = sizeOf(n).w;
      placed.push({ id: n.id, position: { x: x + w / 2, y: y + rowH / 2 } });
      x += w + gapX;
    });
    y += rowH + GAP_Y + label.h;
  }
  // Re-center the produced node centres on the scope anchor. Root scopes derive
  // that anchor from their current centroid, so applying Tree twice is exactly
  // stable instead of walking the graph down the canvas on every run.
  const mean = placed.reduce((sum, item) => ({
    x: sum.x + item.position.x / placed.length,
    y: sum.y + item.position.y / placed.length,
  }), { x: 0, y: 0 });
  placed.forEach(item => set(item.id, {
    x: scope.origin.x + item.position.x - mean.x,
    y: scope.origin.y + item.position.y - mean.y,
  }));
}

/** Stable preorder inferred from directed edges. Unconnected nodes remain root
 *  list items in document order; cycles are appended once at root depth. */
function orderedForest(scope: LayoutScope) {
  const byId = new Map(scope.nodes.map(node => [node.id, node]));
  const incoming = new Map(scope.nodes.map(node => [node.id, 0]));
  const children = new Map<string, GraphNode[]>();
  scope.edges.forEach(edge => {
    const child = byId.get(edge.To);
    if (!child || !byId.has(edge.From)) return;
    incoming.set(edge.To, (incoming.get(edge.To) ?? 0) + 1);
    const list = children.get(edge.From) ?? [];
    if (!list.some(node => node.id === child.id)) list.push(child);
    children.set(edge.From, list);
  });
  const roots = scope.nodes.filter(node => (incoming.get(node.id) ?? 0) === 0);
  const ordered: Array<{ node: GraphNode; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (node: GraphNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push({ node, depth });
    (children.get(node.id) ?? []).forEach(child => visit(child, depth + 1));
  };
  roots.forEach(root => visit(root, 0));
  scope.nodes.forEach(node => visit(node, 0));
  return ordered;
}

const centeredPlacements = (
  scope: LayoutScope,
  placements: Array<{ id: string; position: Position }>,
  set: PatchEmit,
) => {
  if (!placements.length) return;
  const mean = placements.reduce((sum, item) => ({
    x: sum.x + item.position.x / placements.length,
    y: sum.y + item.position.y / placements.length,
  }), { x: 0, y: 0 });
  placements.forEach(item => set(item.id, {
    x: scope.origin.x + item.position.x - mean.x,
    y: scope.origin.y + item.position.y - mean.y,
  }));
};

/** Vertical nested list: preorder runs top-to-bottom; every relationship level
 *  indents to the right. Variable node heights are accumulated, never guessed. */
export function verticalScope(scope: LayoutScope, set: PatchEmit) {
  if (sectionedScope(scope, set)) return;
  const ordered = orderedForest(scope);
  const indent = Math.max(210, Math.max(...scope.nodes.map(node => sizeOf(node).w), 0) + GAP_X);
  const placements: Array<{ id: string; position: Position }> = [];
  let y = 0;
  ordered.forEach(({ node, depth }) => {
    const size = sizeOf(node);
    placements.push({ id: node.id, position: { x: depth * indent, y: y + size.h / 2 } });
    y += size.h + 24;
  });
  centeredPlacements(scope, placements, set);
}

/** Horizontal nested list: preorder advances left-to-right; relationship depth
 *  drops branches below the main line. Widths are accumulated for text-safe gaps. */
export function horizontalScope(scope: LayoutScope, set: PatchEmit) {
  if (sectionedScope(scope, set)) return;
  const ordered = orderedForest(scope);
  const rowStep = Math.max(136, Math.max(...scope.nodes.map(node => sizeOf(node).h), 0) + GAP_Y);
  const placements: Array<{ id: string; position: Position }> = [];
  let x = 0;
  ordered.forEach(({ node, depth }) => {
    const size = sizeOf(node);
    placements.push({ id: node.id, position: { x: x + size.w / 2, y: depth * rowStep } });
    x += size.w + 36;
  });
  centeredPlacements(scope, placements, set);
}

/** Square-ish grid per scope, centered at scope.origin. Cell size = the largest
 *  node in the scope + gaps, so no two boxes touch regardless of text length. */
export function gridScope(scope: LayoutScope, set: PatchEmit) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(scope.nodes.length)));
  const rows = Math.ceil(scope.nodes.length / cols);
  const maxW = Math.max(...scope.nodes.map(n => sizeOf(n).w), 0);
  const maxH = Math.max(...scope.nodes.map(n => sizeOf(n).h), 0);
  const label = labelFootprintOf(scope.edges);
  const colSize = maxW + GAP_X + Math.min(260, label.w);
  const rowSize = maxH + GAP_Y + label.h;
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
export const radialRootOf = (scope: LayoutScope, focusedId: string | undefined) => {
  const focused = focusedId ? scope.nodes.find(node => node.id === focusedId) : undefined;
  return focused ?? scope.nodes[0];
};

export function radialScope(scope: LayoutScope, focusedId: string | undefined, set: PatchEmit) {
  if (!scope.nodes.length) return;
  const root = radialRootOf(scope, focusedId)!;
  const others = scope.nodes.filter(n => n.id !== root.id);
  // Radius large enough that neighbours on the ring don't overlap: the ring's
  // circumference must hold every node's width plus a gap.
  const circumference = others.reduce((sum, n) => sum + sizeOf(n).w + GAP_X, 0);
  const rootReach = Math.max(sizeOf(root).w, sizeOf(root).h) / 2;
  const label = labelFootprintOf(scope.edges);
  const radius = Math.max(160, 60 + others.length * 22, circumference / (2 * Math.PI) + rootReach + label.h + label.w / 2);
  const center = root.Position ?? scope.origin;
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    set(n.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  });
}

/** Count collisions using the same edge-label rectangles the renderer paints.
 * Labels therefore participate in layout like small virtual nodes: they must
 * clear every real node and every other label before placement is committed. */
const labelCollisionCount = (scope: LayoutScope, positions: Map<string, Position>) => {
  const nodes = scope.nodes.flatMap(node => {
    const position = positions.get(node.id);
    if (!position) return [];
    const size = sizeOf(node);
    return [{ id: node.id, rect: { x: position.x - size.w / 2, y: position.y - size.h / 2, w: size.w, h: size.h } }];
  });
  const nodeRects = new Map(nodes.map(node => [node.id, node.rect]));
  const nodeIndex = createRectIndex(nodes);
  const nodeDefs = new Map(scope.nodes.map(node => [node.id, node]));
  const labels: { rect: Rect }[] = scope.edges.flatMap(edge => {
    const label = edge.Label?.text?.trim();
    const from = positions.get(edge.From), to = positions.get(edge.To);
    const fromNode = nodeDefs.get(edge.From), toNode = nodeDefs.get(edge.To);
    const fromRect = nodeRects.get(edge.From), toRect = nodeRects.get(edge.To);
    if (!label || !from || !to || !fromNode || !toNode || !fromRect || !toRect) return [];
    const fromSize = sizeOf(fromNode), toSize = sizeOf(toNode);
    const tipAtSource = intersectRectBoundary(to, from, { w: fromSize.w / 2, h: fromSize.h / 2 });
    const tipAtTarget = intersectRectBoundary(from, to, { w: toSize.w / 2, h: toSize.h / 2 });
    const initial = edgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id);
    const obstacles = queryRectIndex(nodeIndex, initial.rect, EDGE_LABEL_AVOID_REACH).map(node => node.rect);
    return [{ rect: edgeLabelGeometry(label, tipAtSource, tipAtTarget, edge.id, obstacles).rect }];
  });
  let count = 0;
  labels.forEach(label => {
    queryRectIndex(nodeIndex, label.rect, 8).forEach(node => {
      if (rectsOverlap(label.rect, node.rect, 8)) count++;
    });
  });
  const labelIndex = createRectIndex<{ rect: Rect }>([]);
  labels.forEach(label => {
    queryRectIndex(labelIndex, label.rect, 10).forEach(other => {
      if (rectsOverlap(label.rect, other.rect, 10)) count++;
    });
    addToRectIndex(labelIndex, label);
  });
  return count;
};

const settleLabelObstacles = (
  scope: LayoutScope,
  positions: Map<string, Position>,
  movable: Set<string>,
  anchor: Position,
) => {
  let collisions = labelCollisionCount(scope, positions);
  // Expanding around a stable centroid preserves the chosen visual grammar and
  // idempotence while opening real lanes for any label rectangles that collide.
  for (let pass = 0; collisions > 0 && pass < 10; pass++) {
    const factor = 1.12;
    [...movable].forEach((id, index) => {
      const position = positions.get(id);
      if (!position) return;
      let dx = position.x - anchor.x, dy = position.y - anchor.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.01 && movable.size > 1) {
        const angle = (index / movable.size) * Math.PI * 2;
        dx = Math.cos(angle) * 4;
        dy = Math.sin(angle) * 4;
      }
      positions.set(id, { x: anchor.x + dx * factor, y: anchor.y + dy * factor });
    });
    collisions = labelCollisionCount(scope, positions);
  }
};

export const applyLabelAware = (
  scope: LayoutScope,
  layout: (scope: LayoutScope, set: PatchEmit) => void,
  set: PatchEmit,
  fixedAnchorId?: string,
) => {
  const positions = new Map(scope.nodes.flatMap(node => node.Position ? [[node.id, { ...node.Position }] as const] : []));
  const movable = new Set<string>();
  layout(scope, (id, position) => {
    positions.set(id, position);
    movable.add(id);
  });
  if (!movable.size) return;
  const fixedAnchor = fixedAnchorId ? positions.get(fixedAnchorId) : undefined;
  const anchor = fixedAnchor ?? [...movable].reduce((sum, id) => {
    const position = positions.get(id)!;
    return { x: sum.x + position.x / movable.size, y: sum.y + position.y / movable.size };
  }, { x: 0, y: 0 });
  settleLabelObstacles(scope, positions, movable, anchor);
  movable.forEach(id => set(id, positions.get(id)!));
};
