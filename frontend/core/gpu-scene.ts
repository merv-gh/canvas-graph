import type { Graph } from '../model/graph';
import { intersectRectBoundary } from './geometry';

/** gpu-scene — pure CPU side of the WebGPU stage painter: flatten the graph
 *  into typed instance arrays the shaders consume. No WebGPU objects here, so
 *  the whole builder unit-tests in jsdom (and benches at 10k nodes without a
 *  GPU). Layout per instance is 8 floats (32 bytes), std430-friendly.
 *
 *    node: cx, cy, w, h, colorIndex, flags, 0, 0
 *    edge: x1, y1, x2, y2 (tip clipped to target border), kindIndex, flags, 0, 0
 *
 *  flags bit0 = selected, bit1 = focused. */

export const NODE_FLOATS = 8;
export const EDGE_FLOATS = 8;
export const FLAG_SELECTED = 1;
export const FLAG_FOCUSED = 2;

/** Stable palette index per NodeType — mirrors the CSS node-type accents. */
export const NODE_COLOR_INDEX: Record<string, number> = {
  text: 0, square: 1, circle: 2, 'user-input': 3, gateway: 4, service: 5,
  database: 6, kafka: 7, index: 8, cache: 9, 'rate-limit': 10, 'circuit-breaker': 11,
};
export const EDGE_KIND_INDEX: Record<string, number> = { sync: 0, async: 1, read: 2, write: 3 };

/** ArrayBuffer-backed explicitly — GPUQueue.writeBuffer rejects views that
 *  could sit on a SharedArrayBuffer. */
export type GpuScene = {
  nodeData: Float32Array<ArrayBuffer>;
  nodeCount: number;
  edgeData: Float32Array<ArrayBuffer>;
  edgeCount: number;
};

const grow = (current: Float32Array<ArrayBuffer> | undefined, needed: number) => {
  if (current && current.length >= needed) return current;
  let capacity = 1024;
  while (capacity < needed) capacity *= 2;
  return new Float32Array(capacity);
};

/** Flatten `graph` into instance arrays. Pass the previous scene back in to
 *  reuse its buffers — steady-state rebuilds allocate nothing. */
export function buildScene(
  graph: Graph,
  selectedIds: ReadonlySet<string>,
  focusedId: string | null,
  prev?: GpuScene,
): GpuScene {
  const nodes = graph.nodes();
  const edges = graph.edges();
  const nodeData = grow(prev?.nodeData, nodes.length * NODE_FLOATS);
  const edgeData = grow(prev?.edgeData, edges.length * EDGE_FLOATS);

  let n = 0;
  for (const node of nodes) {
    const pos = node.Position;
    if (!pos) continue;
    const base = n * NODE_FLOATS;
    nodeData[base] = pos.x;
    nodeData[base + 1] = pos.y;
    nodeData[base + 2] = node.Size.w;
    nodeData[base + 3] = node.Size.h;
    nodeData[base + 4] = NODE_COLOR_INDEX[node.NodeType ?? 'text'] ?? 0;
    nodeData[base + 5] = (selectedIds.has(node.id) ? FLAG_SELECTED : 0) | (focusedId === node.id ? FLAG_FOCUSED : 0);
    nodeData[base + 6] = 0;
    nodeData[base + 7] = 0;
    n++;
  }

  let e = 0;
  for (const edge of edges) {
    const from = graph.getNode(edge.From);
    const to = graph.getNode(edge.To);
    if (!from?.Position || !to?.Position) continue;
    const tip = intersectRectBoundary(from.Position, to.Position, { w: to.Size.w / 2, h: to.Size.h / 2 });
    const base = e * EDGE_FLOATS;
    edgeData[base] = from.Position.x;
    edgeData[base + 1] = from.Position.y;
    edgeData[base + 2] = tip.x;
    edgeData[base + 3] = tip.y;
    edgeData[base + 4] = EDGE_KIND_INDEX[edge.EdgeKind ?? 'sync'] ?? 0;
    edgeData[base + 5] = selectedIds.has(edge.id) ? FLAG_SELECTED : 0;
    edgeData[base + 6] = 0;
    edgeData[base + 7] = 0;
    e++;
  }

  return { nodeData, nodeCount: n, edgeData, edgeCount: e };
}

/** Exact hit test for a click in graph space: cell-level candidates from the
 *  spatial grid (expanded a cell so off-center rects are not missed), refined
 *  against real bounds. Latest-created node wins, matching DOM stacking. */
export function hitTestNode(graph: Graph, point: { x: number; y: number }): string | null {
  const MAX_HALF = 512; // beyond any real node half-size; one query, no misses
  const candidates = graph.nodeIdsInRect({ x: point.x - MAX_HALF, y: point.y - MAX_HALF, w: MAX_HALF * 2, h: MAX_HALF * 2 });
  let best: { id: string; seq: number } | null = null;
  for (const id of candidates) {
    const node = graph.getNode(id);
    const pos = node?.Position;
    if (!node || !pos) continue;
    if (Math.abs(point.x - pos.x) > node.Size.w / 2 || Math.abs(point.y - pos.y) > node.Size.h / 2) continue;
    const seq = parseInt(id.replace(/^\D+/, ''), 10) || 0;
    if (!best || seq > best.seq) best = { id, seq };
  }
  return best?.id ?? null;
}
