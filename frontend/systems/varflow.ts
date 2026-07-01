import type { Registry } from '../core';
import { mountRoot } from '../core/mount';
import type { EdgeKind, GraphSnapshot, NodeType } from '../model';

/**
 * varflow — plug file-projections graphs into the canvas.
 *
 * file-projections (the Go "joern-varflow" analyzer) emits whole-program graphs:
 * service graphs, call graphs, entrypoint maps and control flows. Its wire shape
 * (see file-projections `src/servicegraph.go` `sgGraph`) is:
 *
 *   { services:[{name,root,lang}],
 *     nodes:[{id,label,service,lang,kind,file,line,op,method,effects}],
 *     edges:[{from,to,kind,label,cross}] }
 *
 * We adapt that to a `GraphSnapshot` and drive the same import path the built-in
 * system-design demos use (`graph.import.snapshot`). Nodes arrive position-less,
 * so after import we run the layered `tidy` layout and fit the camera.
 *
 * Boot:  ?varflow=<url>            fetch JSON from a file-projections server
 *        ?varflow=sample:entrypoints   embedded demo (zero backend)
 *        &lens=<name>              forwarded to the server as ?lens=
 */

declare module '../types' {
  interface CustomEvents {
    'varflow.load': { source: string; lens?: string };
    'varflow.loaded': { nodes: number; edges: number };
    'varflow.error': { message: string };
  }
}

// ---- file-projections wire types (mirror of sgGraph) ----
export type VfNode = {
  id: string;
  label?: string;
  service?: string;
  lang?: string;
  kind?: string; // file | entrypoint | router
  file?: string;
  line?: number;
  op?: string;
  method?: string;
  effects?: string[]; // io-read | io-write | network | db | process
};
export type VfEdge = {
  from: string;
  to: string;
  kind?: string; // import | registers | api-call
  label?: string;
  cross?: boolean;
};
export type VfGraph = { services?: unknown[]; nodes?: VfNode[]; edges?: VfEdge[] };

// A node's shape reflects what it *is* (entrypoint/router/file) refined by what
// it *touches* (its side-effects). db effect wins — a file that hits a database
// reads as a database on the canvas.
function nodeTypeFor(n: VfNode): NodeType {
  const fx = n.effects ?? [];
  if (fx.includes('db')) return 'database';
  switch (n.kind) {
    case 'entrypoint': return 'gateway';
    case 'router': return 'service';
    case 'file':
      if (fx.includes('network')) return 'service';
      if (fx.includes('io-read') || fx.includes('io-write')) return 'index';
      return 'square';
    default: return 'text';
  }
}

// Edge semantics: a cross-service api-call is the async network hop we most want
// to see; imports/registers are the sync structural wiring.
function edgeKindFor(e: VfEdge): EdgeKind {
  if (e.kind === 'api-call') return 'async';
  if (e.cross) return 'async';
  return 'sync';
}

// A node's on-screen order within its service cluster: routers first (the entry
// surface), then entrypoints, then the files they reach.
const KIND_ORDER: Record<string, number> = { router: 0, entrypoint: 1, file: 2 };

const CELL_W = 192, CELL_H = 106, CLUSTER_GAP = 54, MIN_ROW_TARGET = 520, MAX_ROW_TARGET = 1180;
const DEFAULT_OVERVIEW_MAX = 18;
const DEFAULT_FOCUS_MAX = 24;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const idSet = (nodes: VfNode[]) => new Set(nodes.map(n => n.id));
const edgeScore = (e: VfEdge) => {
  if (e.kind === 'api-call') return 120;
  if (e.cross) return 110;
  if (e.kind === 'registers') return 80;
  if (e.kind === 'writes-to' || e.kind === 'reads-from') return 70;
  return 20;
};
const nodeScore = (n: VfNode, incident: VfEdge[]) => {
  let score = 0;
  if (n.kind === 'router') score += 120;
  if (n.kind === 'entrypoint') score += 110;
  if (incident.some(e => e.kind === 'api-call' || e.cross)) score += 90;
  if (n.effects?.includes('db')) score += 55;
  if (n.effects?.includes('network')) score += 45;
  if (n.effects?.includes('io-write') || n.effects?.includes('io-read')) score += 35;
  if (n.effects?.includes('process')) score += 15;
  if (n.service === 'openapi' || n.file?.includes('/e2e/') || n.file?.includes('/gen/')) score -= 70;
  return score;
};

function incidentEdges(g: VfGraph) {
  const out = new Map<string, VfEdge[]>();
  (g.edges ?? []).forEach(e => {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (out.get(e.to) ?? out.set(e.to, []).get(e.to)!).push(e);
  });
  return out;
}

function bestPathIds(g: VfGraph, through?: string) {
  const edges = g.edges ?? [];
  const byId = new Map((g.nodes ?? []).map(n => [n.id, n]));
  const byFrom = new Map<string, VfEdge[]>();
  const byTo = new Map<string, VfEdge[]>();
  edges.forEach(e => {
    (byFrom.get(e.from) ?? byFrom.set(e.from, []).get(e.from)!).push(e);
    (byTo.get(e.to) ?? byTo.set(e.to, []).get(e.to)!).push(e);
  });
  const rank = (e: VfEdge) => edgeScore(e)
    - (byId.get(e.from)?.service === 'openapi' ? 55 : 0)
    - (byId.get(e.to)?.service === 'openapi' ? 55 : 0);
  const pick = (list: VfEdge[] | undefined) => [...(list ?? [])].sort((a, b) => rank(b) - rank(a))[0];
  const seed = through
    ? undefined
    : [...edges].sort((a, b) => rank(b) - rank(a))[0];
  const ids = new Set<string>();
  let current = through ?? seed?.to;
  if (seed) { ids.add(seed.from); ids.add(seed.to); }
  if (current) ids.add(current);
  for (let i = 0; i < 3 && current; i++) {
    const e = pick(byTo.get(current));
    if (!e || ids.has(e.from)) break;
    ids.add(e.from);
    current = e.from;
  }
  current = through ?? seed?.from;
  for (let i = 0; i < 3 && current; i++) {
    const e = pick(byFrom.get(current));
    if (!e || ids.has(e.to)) break;
    ids.add(e.to);
    current = e.to;
  }
  return ids;
}

function filteredGraph(g: VfGraph, keep: Set<string>, maxEdges: number): VfGraph {
  const nodes = (g.nodes ?? []).filter(n => keep.has(n.id));
  const present = idSet(nodes);
  const edges = (g.edges ?? [])
    .filter(e => present.has(e.from) && present.has(e.to) && e.from !== e.to)
    .sort((a, b) => edgeScore(b) - edgeScore(a))
    .slice(0, maxEdges);
  const services = (g.services ?? []).filter(s => {
    const name = typeof s === 'object' && s && 'name' in s ? String((s as { name?: unknown }).name) : '';
    return nodes.some(n => n.service === name);
  });
  return { services: services.length ? services : g.services, nodes, edges };
}

export type SliceInfo = {
  graph: VfGraph;
  totalNodes: number;
  totalEdges: number;
  visibleNodes: number;
  visibleEdges: number;
  mode: 'all' | 'overview' | 'focus';
};

export function readableGraph(g: VfGraph, opts: SnapshotOptions = {}): SliceInfo {
  const rawNodes = g.nodes ?? [];
  const rawEdges = g.edges ?? [];
  const byId = new Map(rawNodes.map(n => [n.id, n]));
  const totalNodes = rawNodes.length;
  const totalEdges = rawEdges.length;
  if (opts.layout === 'flow' || opts.readMode === 'all' || totalNodes <= (opts.maxOverviewNodes ?? DEFAULT_OVERVIEW_MAX)) {
    return { graph: g, totalNodes, totalEdges, visibleNodes: totalNodes, visibleEdges: totalEdges, mode: 'all' };
  }

  const incident = incidentEdges(g);
  const maxNodes = opts.focusNodeId ? (opts.maxFocusNodes ?? DEFAULT_FOCUS_MAX) : (opts.maxOverviewNodes ?? DEFAULT_OVERVIEW_MAX);
  const keep = opts.focusNodeId ? bestPathIds(g, opts.focusNodeId) : bestPathIds(g);

  if (opts.focusNodeId) {
    const queue: { id: string; depth: number }[] = [{ id: opts.focusNodeId, depth: 0 }];
    keep.add(opts.focusNodeId);
    const seen = new Set<string>(keep);
    while (queue.length && keep.size < maxNodes) {
      const { id, depth } = queue.shift()!;
      if (depth >= (opts.expandDepth ?? 1)) continue;
      const next = [...(incident.get(id) ?? [])]
        .flatMap(e => [e.from, e.to])
        .filter(id => !seen.has(id))
        .sort((a, b) => nodeScore(byId.get(b) ?? { id: b }, incident.get(b) ?? []) - nodeScore(byId.get(a) ?? { id: a }, incident.get(a) ?? []));
      for (const nid of next) {
        if (keep.size >= maxNodes) break;
        seen.add(nid);
        keep.add(nid);
        queue.push({ id: nid, depth: depth + 1 });
      }
    }
  } else {
    rawNodes
      .slice()
      .sort((a, b) => nodeScore(b, incident.get(b.id) ?? []) - nodeScore(a, incident.get(a.id) ?? []))
      .forEach(n => {
        if (keep.size < maxNodes && nodeScore(n, incident.get(n.id) ?? []) > 45) keep.add(n.id);
      });
  }

  if (!keep.size) rawNodes.slice(0, maxNodes).forEach(n => keep.add(n.id));
  const graph = filteredGraph(g, keep, Math.max(80, maxNodes * 3));
  return {
    graph,
    totalNodes,
    totalEdges,
    visibleNodes: graph.nodes?.length ?? 0,
    visibleEdges: graph.edges?.length ?? 0,
    mode: opts.focusNodeId ? 'focus' : 'overview',
  };
}

/**
 * Bounded, service-clustered layout computed up front.
 *
 * The generic `tidy` layout lays every in-degree-zero root on a single row, so a
 * 45-service graph spreads ~50k px wide and cross-service edges fling outliers —
 * `fit` then frames the outliers and the dense middle renders off-screen. Instead
 * we cluster by `service` (the natural repo/bounded-context grouping), grid each
 * cluster, and shelf-pack the clusters. Coordinates stay compact → the camera
 * frames the whole map and viewport culling has real bounds to work with.
 */
function assignPositions(sn: { id: string; NodeType: NodeType }[], meta: Map<string, VfNode>) {
  const groups = new Map<string, string[]>();
  for (const n of sn) {
    const svc = meta.get(n.id)?.service ?? '·';
    (groups.get(svc) ?? groups.set(svc, []).get(svc)!).push(n.id);
  }
  const pos = new Map<string, { x: number; y: number }>();
  // Largest clusters first so shelf packing wastes less space.
  const clusters = [...groups.entries()]
    .map(([svc, ids]) => {
      ids.sort((a, b) => (KIND_ORDER[meta.get(a)?.kind ?? ''] ?? 3) - (KIND_ORDER[meta.get(b)?.kind ?? ''] ?? 3));
      const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
      const rows = Math.ceil(ids.length / cols);
      return { svc, ids, cols, rows, w: cols * CELL_W, h: rows * CELL_H };
    })
    .sort((a, b) => b.h - a.h);
  const area = clusters.reduce((sum, c) => sum + c.w * c.h, 0);
  const rowTarget = clamp(Math.round(Math.sqrt(Math.max(area, CELL_W * CELL_H) * 1.7)), MIN_ROW_TARGET, MAX_ROW_TARGET);
  let shelfX = 0, shelfY = 0, shelfH = 0;
  for (const c of clusters) {
    if (shelfX > 0 && shelfX + c.w > rowTarget) { shelfX = 0; shelfY += shelfH + CLUSTER_GAP; shelfH = 0; }
    c.ids.forEach((id, i) => {
      const col = i % c.cols, row = Math.floor(i / c.cols);
      pos.set(id, { x: shelfX + col * CELL_W, y: shelfY + row * CELL_H });
    });
    shelfX += c.w + CLUSTER_GAP;
    shelfH = Math.max(shelfH, c.h);
  }
  return pos;
}

function assignFocusPositions(sn: { id: string }[]) {
  const pos = new Map<string, { x: number; y: number }>();
  const cols = sn.length <= 5 ? 1 : 2;
  sn.forEach((n, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    pos.set(n.id, { x: col * CELL_W, y: row * (CELL_H + 36) });
  });
  return pos;
}

export type SnapshotOptions = {
  /** 'cluster' (default): group by service and shelf-pack — best for service
   *  graphs. 'flow': leave nodes position-less so a layered top-down layout
   *  (tidy) can arrange them — best for control-flow / call graphs. */
  layout?: 'cluster' | 'flow';
  /** 'overview' (default for service graphs): show a high-signal readable slice.
   *  'all': show every node/edge. */
  readMode?: 'overview' | 'all';
  /** When set, show the shortest high-signal path through this node plus local
   *  neighbors. Used for click-to-expand. */
  focusNodeId?: string;
  expandDepth?: number;
  maxOverviewNodes?: number;
  maxFocusNodes?: number;
};

function nodeSizeFor(n: VfNode) {
  const label = n.label || n.method || n.id;
  const w = Math.max(160, Math.min(230, 116 + label.length * 2.5));
  const h = n.kind === 'entrypoint' || n.kind === 'router' || (n.effects?.length ?? 0) > 0 ? 74 : 64;
  return { w, h };
}

export function sgGraphToSnapshot(g: VfGraph, opts: SnapshotOptions = {}): GraphSnapshot {
  const raw = g.nodes ?? [];
  const meta = new Map(raw.map(n => [n.id, n]));
  const ids = new Set(raw.map(n => n.id));
  const base = raw.map(n => ({ id: n.id, NodeType: nodeTypeFor(n) }));
  const pos = opts.layout === 'flow'
    ? new Map<string, { x: number; y: number }>()
    : opts.focusNodeId ? assignFocusPositions(base) : assignPositions(base, meta);
  const nodes = raw.map(n => {
    const loc = n.file ? `${n.file}${n.line ? `:${n.line}` : ''}` : '';
    const desc = [n.service && `svc: ${n.service}`, loc, n.effects?.length && `fx: ${n.effects.join(', ')}`]
      .filter(Boolean).join('  ·  ');
    return {
      id: n.id,
      Label: { text: n.label || n.method || n.id },
      NodeType: nodeTypeFor(n),
      Description: desc || undefined,
      Size: nodeSizeFor(n),
      Position: pos.get(n.id),
    };
  });
  const edges = (g.edges ?? [])
    .filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e, i) => ({
      id: `r${i + 1}`,
      From: e.from,
      To: e.to,
      Label: e.label ? { text: e.label } : undefined,
      EdgeKind: edgeKindFor(e),
    }));
  return { nodes, edges };
}

// Embedded demo: a tiny cross-service entrypoint map (TS web → Go orders API →
// Postgres). Enough to prove import + layout + styling with no server running.
const SAMPLES: Record<string, VfGraph> = {
  entrypoints: {
    nodes: [
      { id: 'web::routes.ts', label: 'routes.ts', service: 'web', lang: 'ts', kind: 'router', file: 'web/routes.ts', line: 12 },
      { id: 'web::GET /orders', label: 'GET /orders', service: 'web', lang: 'ts', kind: 'entrypoint', op: 'listOrders', method: 'listOrders', file: 'web/orders.ts', line: 40 },
      { id: 'web::POST /orders', label: 'POST /orders', service: 'web', lang: 'ts', kind: 'entrypoint', op: 'createOrder', method: 'createOrder', file: 'web/orders.ts', line: 55 },
      { id: 'api::orders.go', label: 'orders.go', service: 'api', lang: 'go', kind: 'file', file: 'api/orders.go', line: 1, effects: ['db', 'io-write'] },
      { id: 'api::store.go', label: 'store.go', service: 'api', lang: 'go', kind: 'file', file: 'api/store.go', line: 1, effects: ['db'] },
    ],
    edges: [
      { from: 'web::routes.ts', to: 'web::GET /orders', kind: 'registers', label: 'GET' },
      { from: 'web::routes.ts', to: 'web::POST /orders', kind: 'registers', label: 'POST' },
      { from: 'web::GET /orders', to: 'api::orders.go', kind: 'api-call', label: 'GET /orders', cross: true },
      { from: 'web::POST /orders', to: 'api::orders.go', kind: 'api-call', label: 'POST /orders', cross: true },
      { from: 'api::orders.go', to: 'api::store.go', kind: 'import' },
    ],
  },
};

async function loadGraph(source: string, lens: string | undefined): Promise<VfGraph> {
  if (source.startsWith('sample:')) {
    const key = source.slice('sample:'.length);
    const g = SAMPLES[key];
    if (!g) throw new Error(`unknown sample "${key}"`);
    return g;
  }
  const url = new URL(source, location.origin);
  if (lens) url.searchParams.set('lens', lens);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const body = await res.json();
  // file-projections wraps the graph as { lens, graph, ... }; accept either shape.
  return (body?.graph ?? body) as VfGraph;
}

export function registerVarflow(system: Registry) {
  system('varflow', ({ on, emit }) => {
    const run = async (source: string, lens?: string) => {
      try {
        const g = await loadGraph(source, lens);
        const snapshot = sgGraphToSnapshot(g);
        emit('graph.import.snapshot', snapshot);
        // Read-only viewer chrome (see styles.css `.varflow`). Scope to the
        // mount root so embedding in a host page doesn't restyle the whole page.
        mountRoot().classList.add('varflow');
        // Nodes ship with positions (assignPositions), so just frame the graph
        // once the first render settles. Fit again as a safety net for big
        // graphs whose element bounds settle a frame or two late.
        setTimeout(() => emit('view.fit.all'), 60);
        setTimeout(() => emit('view.fit.all'), 400);
        emit('varflow.loaded', { nodes: snapshot.nodes.length, edges: snapshot.edges.length });
      } catch (err) {
        emit('varflow.error', { message: err instanceof Error ? err.message : String(err) });
      }
    };

    on('varflow.load', ({ source, lens }) => { void run(source, lens); });

    on('app.start', () => {
      const params = new URLSearchParams(location.search);
      const source = params.get('varflow');
      if (source) void run(source, params.get('lens') ?? undefined);
    });
  }, { requires: ['graph', 'layout', 'render'] });
}
