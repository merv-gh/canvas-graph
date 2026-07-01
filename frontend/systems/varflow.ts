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

const CELL_W = 210, CELL_H = 132, CLUSTER_GAP = 120, ROW_TARGET = 5200;

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
  let shelfX = 0, shelfY = 0, shelfH = 0;
  for (const c of clusters) {
    if (shelfX > 0 && shelfX + c.w > ROW_TARGET) { shelfX = 0; shelfY += shelfH + CLUSTER_GAP; shelfH = 0; }
    c.ids.forEach((id, i) => {
      const col = i % c.cols, row = Math.floor(i / c.cols);
      pos.set(id, { x: shelfX + col * CELL_W, y: shelfY + row * CELL_H });
    });
    shelfX += c.w + CLUSTER_GAP;
    shelfH = Math.max(shelfH, c.h);
  }
  return pos;
}

export type SnapshotOptions = {
  /** 'cluster' (default): group by service and shelf-pack — best for service
   *  graphs. 'flow': leave nodes position-less so a layered top-down layout
   *  (tidy) can arrange them — best for control-flow / call graphs. */
  layout?: 'cluster' | 'flow';
};

export function sgGraphToSnapshot(g: VfGraph, opts: SnapshotOptions = {}): GraphSnapshot {
  const raw = g.nodes ?? [];
  const meta = new Map(raw.map(n => [n.id, n]));
  const ids = new Set(raw.map(n => n.id));
  const base = raw.map(n => ({ id: n.id, NodeType: nodeTypeFor(n) }));
  const pos = opts.layout === 'flow' ? new Map<string, { x: number; y: number }>() : assignPositions(base, meta);
  const nodes = raw.map(n => {
    const loc = n.file ? `${n.file}${n.line ? `:${n.line}` : ''}` : '';
    const desc = [n.service && `svc: ${n.service}`, loc, n.effects?.length && `fx: ${n.effects.join(', ')}`]
      .filter(Boolean).join('  ·  ');
    return {
      id: n.id,
      Label: { text: n.label || n.method || n.id },
      NodeType: nodeTypeFor(n),
      Description: desc || undefined,
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
