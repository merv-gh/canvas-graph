import type { EdgeKind, GraphSnapshot, NodeDraft, NodeType, SystemNodeType } from '../model';
import { edgeRef, type Registry } from '../core';
import { Places } from '../types';
import type { Id } from '../types';

declare module '../types' {
  interface CustomEvents {
    'systemDesign.node.create': { nodeType: SystemNodeType };
    'systemDesign.edge.kind.set': { id?: Id; edgeKind: EdgeKind };
    'systemDesign.share.copy': void;
    'systemDesign.shared': { url: string };
    'systemDesign.demo.imageSearch': void;
  }
}

const PANEL_ID = 'system-design';
const PANEL_FOLD_ID = 'system-design.palette';
const HINTS_KEY = 'system-design:hints';
const NODE_TYPES: SystemNodeType[] = ['user-input', 'gateway', 'service', 'database', 'kafka', 'index'];
const EDGE_KINDS: EdgeKind[] = ['sync', 'async', 'read', 'write'];
const EDGE_KIND_SET = new Set<string>(EDGE_KINDS);

type CompactNode = [Id, string, NodeType, number, number, number, number, string?, number?, number?, number?];
type CompactEdge = [Id, Id, Id, EdgeKind | '', string?, number?, number?, number?];
type CompactSnapshot = { v: 1; n: CompactNode[]; e: CompactEdge[] };
type Observation = { level: 'info' | 'warn' | 'error'; title: string; detail: string };

const nodeTitle: Record<SystemNodeType, string> = {
  'user-input': 'User input',
  gateway: 'Gateway',
  service: 'Service',
  database: 'Database',
  kafka: 'Kafka',
  index: 'Search index',
};

const nodeDefaults: Record<SystemNodeType, Omit<NodeDraft, 'NodeType'>> = {
  'user-input': { Label: { text: 'User input' }, Size: { w: 148, h: 78 }, Description: 'External actor, mobile app, CLI, or browser request source.', ExpectedRps: 200, LatencyMs: 20 },
  gateway: { Label: { text: 'Gateway' }, Size: { w: 170, h: 82 }, Description: 'Auth, routing, rate limits, request shaping.', ExpectedRps: 5000, ComputeMs: 4, LatencyMs: 15 },
  service: { Label: { text: 'Service' }, Size: { w: 196, h: 108 }, Description: 'Stateless compute. Add CPU time, downstream calls, and data ownership notes.', ExpectedRps: 1500, ComputeMs: 20, LatencyMs: 60 },
  database: { Label: { text: 'Database' }, Size: { w: 176, h: 92 }, Description: 'Durable source of truth. Mark read/write edges and expected load.', ExpectedRps: 2000, LatencyMs: 12 },
  kafka: { Label: { text: 'Kafka' }, Size: { w: 170, h: 82 }, Description: 'Async event boundary. Track event names, lag target, retention, and payload size.', ExpectedRps: 10000, LatencyMs: 5 },
  index: { Label: { text: 'Index' }, Size: { w: 176, h: 92 }, Description: 'Derived read model for search, ranking, or vector lookup.', ExpectedRps: 3000, LatencyMs: 25 },
};

const labelFor = (type: SystemNodeType) => ({
  'user-input': 'UI',
  gateway: 'GW',
  service: 'Svc',
  database: 'DB',
  kafka: 'Kafka',
  index: 'Index',
}[type]);

const edgeLabel = (kind: EdgeKind) => ({
  sync: 'Sync',
  async: 'Async',
  read: 'Read',
  write: 'Write',
}[kind]);

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
export const encodeSystemDesignSnapshot = (snapshot: GraphSnapshot) =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(toCompact(snapshot))));
export const decodeSystemDesignSnapshot = (encoded: string): GraphSnapshot | null => {
  try {
    const compact = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as CompactSnapshot;
    return fromCompact(compact);
  } catch {
    return null;
  }
};

const toCompact = (snapshot: GraphSnapshot): CompactSnapshot => ({
  v: 1,
  n: snapshot.nodes.map(node => [
    node.id,
    node.Label?.text ?? node.id,
    node.NodeType ?? 'text',
    Math.round(node.Position?.x ?? 0),
    Math.round(node.Position?.y ?? 0),
    Math.round(node.Size?.w ?? 150),
    Math.round(node.Size?.h ?? 64),
    node.Description || undefined,
    node.ComputeMs,
    node.ExpectedRps,
    node.LatencyMs,
  ]),
  e: snapshot.edges.map(edge => [
    edge.id,
    edge.From,
    edge.To,
    edge.EdgeKind ?? '',
    edge.Label?.text || undefined,
    edge.LatencyMs,
    edge.ThroughputRps,
    edge.PayloadKb,
  ]),
});

const fromCompact = (compact: CompactSnapshot): GraphSnapshot | null => {
  if (compact.v !== 1 || !Array.isArray(compact.n) || !Array.isArray(compact.e)) return null;
  return {
    nodes: compact.n.map(([id, title, NodeType, x, y, w, h, Description, ComputeMs, ExpectedRps, LatencyMs]) => ({
      id,
      Label: { text: title },
      NodeType,
      Position: { x, y },
      Size: { w, h },
      Description,
      ComputeMs,
      ExpectedRps,
      LatencyMs,
    })),
    edges: compact.e.map(([id, From, To, EdgeKind, label, LatencyMs, ThroughputRps, PayloadKb]) => ({
      id,
      From,
      To,
      EdgeKind: EDGE_KIND_SET.has(EdgeKind) ? EdgeKind as EdgeKind : undefined,
      Label: label ? { text: label } : undefined,
      LatencyMs,
      ThroughputRps,
      PayloadKb,
    })),
  };
};

const imageSearchSnapshot = (): GraphSnapshot => ({
  nodes: [
    { id: 'e1', Label: { text: 'Mobile app' }, NodeType: 'user-input', Position: { x: -760, y: -70 }, Size: { w: 150, h: 92 }, ExpectedRps: 250, LatencyMs: 30, Description: 'User uploads product photos and searches by photo.' },
    { id: 'e2', Label: { text: 'Load balancer' }, NodeType: 'gateway', Position: { x: -520, y: -70 }, Size: { w: 178, h: 78 }, ExpectedRps: 5000, ComputeMs: 3, LatencyMs: 10, Description: 'Routes upload/search traffic; enforce auth and request limits.' },
    { id: 'e3', Label: { text: 'Image Service' }, NodeType: 'service', Position: { x: -250, y: -180 }, Size: { w: 190, h: 104 }, ExpectedRps: 800, ComputeMs: 25, LatencyMs: 80, Description: '`POST /upload`\nStores bytes and emits photo key.' },
    { id: 'e4', Label: { text: 'Photo S3' }, NodeType: 'database', Position: { x: -40, y: -310 }, Size: { w: 170, h: 88 }, ExpectedRps: 1000, LatencyMs: 35, Description: 'Original image bytes keyed by `photo_key`.' },
    { id: 'e5', Label: { text: 'ML Job' }, NodeType: 'service', Position: { x: 400, y: -360 }, Size: { w: 170, h: 82 }, ExpectedRps: 80, ComputeMs: 180000, LatencyMs: 0, Description: 'Batch job every 3h recomputes vectors for changed photos.' },
    { id: 'e6', Label: { text: 'Photo Embedding S3' }, NodeType: 'database', Position: { x: 140, y: -260 }, Size: { w: 196, h: 92 }, ExpectedRps: 1000, LatencyMs: 35, Description: 'Vector blobs keyed by SKU/photo.' },
    { id: 'e7', Label: { text: 'Search Service' }, NodeType: 'service', Position: { x: -250, y: 90 }, Size: { w: 190, h: 104 }, ExpectedRps: 1200, ComputeMs: 18, LatencyMs: 120, Description: '`GET /search_by_vec`\nTakes photo_key, returns SKU list.' },
    { id: 'e8', Label: { text: 'Elasticsearch' }, NodeType: 'index', Position: { x: -250, y: 270 }, Size: { w: 184, h: 92 }, ExpectedRps: 2500, LatencyMs: 35, Description: 'Vector search index: `sku_id`, `vector<N>`.' },
    { id: 'e9', Label: { text: 'MyService' }, NodeType: 'service', Position: { x: 170, y: 40 }, Size: { w: 250, h: 150 }, ExpectedRps: 900, ComputeMs: 40, LatencyMs: 160, Description: 'Consumes SKU changes, calls encoder, writes derived vector index.' },
    { id: 'e10', Label: { text: 'ML encoder' }, NodeType: 'service', Position: { x: 570, y: 20 }, Size: { w: 170, h: 92 }, ExpectedRps: 650, ComputeMs: 90, LatencyMs: 120, Description: '`POST /encode/product`\nReturns vector for product JSON + photo.' },
    { id: 'e11', Label: { text: 'Redis' }, NodeType: 'database', Position: { x: 410, y: 185 }, Size: { w: 160, h: 78 }, ExpectedRps: 5000, LatencyMs: 3, Description: 'Persistent cache for encoder results and retries.' },
    { id: 'e12', Label: { text: 'Kafka' }, NodeType: 'kafka', Position: { x: 420, y: 360 }, Size: { w: 160, h: 78 }, ExpectedRps: 3000, LatencyMs: 8, Description: 'Events: `sku_changed`, `vectors_computed`.' },
    { id: 'e13', Label: { text: 'Assortment service' }, NodeType: 'service', Position: { x: 760, y: 390 }, Size: { w: 196, h: 96 }, ExpectedRps: 500, ComputeMs: 18, LatencyMs: 70, Description: 'Writes product JSON and SKU changes.' },
    { id: 'e14', Label: { text: 'Actor' }, NodeType: 'user-input', Position: { x: 1030, y: 390 }, Size: { w: 120, h: 70 }, ExpectedRps: 50, LatencyMs: 20, Description: 'Internal operator changes SKU assortment.' },
    { id: 'e15', Label: { text: 'Indexer' }, NodeType: 'service', Position: { x: -10, y: 300 }, Size: { w: 180, h: 94 }, ExpectedRps: 900, ComputeMs: 22, LatencyMs: 60, Description: 'Builds Elasticsearch documents from derived vectors.' },
  ],
  edges: [
    { id: 'r1', From: 'e1', To: 'e2', EdgeKind: 'sync', Label: { text: 'HTTPS' }, LatencyMs: 35, ThroughputRps: 250, PayloadKb: 900 },
    { id: 'r2', From: 'e2', To: 'e3', EdgeKind: 'sync', Label: { text: 'POST /upload' }, LatencyMs: 15, ThroughputRps: 80, PayloadKb: 1024 },
    { id: 'r3', From: 'e3', To: 'e4', EdgeKind: 'write', Label: { text: 'photo bytes' }, LatencyMs: 45, ThroughputRps: 80, PayloadKb: 1024 },
    { id: 'r4', From: 'e5', To: 'e4', EdgeKind: 'read', Label: { text: 'scan every 3h' }, LatencyMs: 80, ThroughputRps: 80, PayloadKb: 1024 },
    { id: 'r5', From: 'e5', To: 'e6', EdgeKind: 'write', Label: { text: 'vectors' }, LatencyMs: 45, ThroughputRps: 80, PayloadKb: 1 },
    { id: 'r6', From: 'e2', To: 'e7', EdgeKind: 'sync', Label: { text: 'GET /search' }, LatencyMs: 15, ThroughputRps: 170, PayloadKb: 4 },
    { id: 'r7', From: 'e7', To: 'e6', EdgeKind: 'read', Label: { text: 'photo vector' }, LatencyMs: 40, ThroughputRps: 170, PayloadKb: 1 },
    { id: 'r8', From: 'e7', To: 'e8', EdgeKind: 'read', Label: { text: 'kNN query' }, LatencyMs: 50, ThroughputRps: 170, PayloadKb: 1 },
    { id: 'r9', From: 'e12', To: 'e9', EdgeKind: 'async', Label: { text: 'sku_changed' }, LatencyMs: 10, ThroughputRps: 500, PayloadKb: 1 },
    { id: 'r10', From: 'e9', To: 'e10', EdgeKind: 'sync', Label: { text: 'encode product' }, LatencyMs: 140, ThroughputRps: 500, PayloadKb: 1 },
    { id: 'r11', From: 'e9', To: 'e11', EdgeKind: 'write', Label: { text: 'cache result' }, LatencyMs: 4, ThroughputRps: 500, PayloadKb: 1 },
    { id: 'r12', From: 'e9', To: 'e15', EdgeKind: 'async', Label: { text: 'vectors_computed' }, LatencyMs: 8, ThroughputRps: 500, PayloadKb: 1 },
    { id: 'r13', From: 'e15', To: 'e8', EdgeKind: 'write', Label: { text: 'bulk insert' }, LatencyMs: 60, ThroughputRps: 500, PayloadKb: 1 },
    { id: 'r14', From: 'e14', To: 'e13', EdgeKind: 'sync', Label: { text: 'change SKU' }, LatencyMs: 40, ThroughputRps: 50, PayloadKb: 2 },
    { id: 'r15', From: 'e13', To: 'e12', EdgeKind: 'async', Label: { text: 'publish sku_changed' }, LatencyMs: 12, ThroughputRps: 500, PayloadKb: 1 },
  ],
});

export function registerSystemDesign(system: Registry) {
  system('system.design', ({ on, emit, bus, graphs, selection, contexts, contribute, declarePanel }) => {
    declarePanel({ id: PANEL_ID, anchor: 'middle-right', movable: true, foldId: PANEL_FOLD_ID, layout: 'stack', order: 12 });

    const selectedEdgeId = () => selection.selected()?.kind === 'edge' ? selection.selected()?.id : undefined;
    const selectedNodeId = () => selection.selectedNode()?.id;
    const nodeCreatePayload = (nodeType: SystemNodeType) => ({ nodeType });

    contexts.commands.register([
      ...NODE_TYPES.map(nodeType => ({
        id: `systemDesign.node.${nodeType}`,
        label: `Create ${nodeTitle[nodeType]}`,
        event: 'systemDesign.node.create' as const,
        group: 'system design',
        payload: () => nodeCreatePayload(nodeType),
      })),
      ...EDGE_KINDS.map(edgeKind => ({
        id: `systemDesign.edge.${edgeKind}`,
        label: `Set edge type: ${edgeLabel(edgeKind)}`,
        event: 'systemDesign.edge.kind.set' as const,
        group: 'system design',
        payload: () => ({ id: selectedEdgeId(), edgeKind }),
      })),
      { id: 'systemDesign.share.copy', label: 'Copy graph share link', group: 'system design' },
      { id: 'systemDesign.demo.imageSearch', label: 'Load image-search system design example', group: 'system design' },
    ]);

    NODE_TYPES.forEach((nodeType, index) => contribute({
      surface: 'top',
      panel: PANEL_ID,
      command: `systemDesign.node.${nodeType}`,
      kind: 'button',
      text: labelFor(nodeType),
      label: `Create ${nodeTitle[nodeType]}`,
      className: `design-palette-button design-node-${nodeType}`,
      order: 10 + index,
    }));
    EDGE_KINDS.forEach((edgeKind, index) => contribute({
      surface: 'top',
      panel: PANEL_ID,
      command: `systemDesign.edge.${edgeKind}`,
      kind: 'button',
      text: edgeLabel(edgeKind),
      label: `Set selected edge to ${edgeLabel(edgeKind)}`,
      className: `design-palette-button design-edge-${edgeKind}`,
      order: 30 + index,
    }));
    contribute({ surface: 'top', panel: PANEL_ID, command: 'systemDesign.share.copy', kind: 'button', text: 'Link', label: 'Copy share link', className: 'design-palette-button', order: 50 });
    contribute({ surface: 'top', panel: PANEL_ID, command: 'systemDesign.demo.imageSearch', kind: 'button', text: 'Example', label: 'Load image-search example', className: 'design-palette-button', order: 51 });

    on('systemDesign.node.create', ({ nodeType }) => {
      const source = selectedNodeId();
      const defaults = nodeDefaults[nodeType];
      emit('graph.node.create', {
        ...defaults,
        Label: { text: defaults.Label?.text ?? nodeTitle[nodeType] },
        NodeType: nodeType,
        relativeTo: source,
        connectFrom: source,
        connectKind: 'sync',
      });
    });

    on('systemDesign.edge.kind.set', ({ id, edgeKind }) => {
      if (!id) return;
      emit('item.update', { ref: edgeRef(id), patch: { EdgeKind: edgeKind } });
    });

    on('systemDesign.share.copy', () => {
      const encoded = encodeSystemDesignSnapshot(graphs.current.snapshot());
      const url = new URL(location.href);
      url.searchParams.set('g', encoded);
      void navigator.clipboard?.writeText?.(url.toString()).catch(() => {});
      emit('systemDesign.shared', { url: url.toString() });
      emit('app.notice', { message: 'Graph share link copied.' });
    });

    on('systemDesign.demo.imageSearch', () => {
      emit('graph.import.snapshot', imageSearchSnapshot());
      emit('view.fit.all');
    });

    const bootFromUrl = () => {
      const encoded = new URLSearchParams(location.search).get('g');
      if (!encoded) return;
      const snapshot = decodeSystemDesignSnapshot(encoded);
      if (!snapshot) {
        emit('app.notice', { message: 'Share link graph could not be decoded.', level: 'warn' });
        return;
      }
      emit('graph.import.snapshot', snapshot);
      emit('view.fit.all');
    };

    const outgoing = (id: Id, kinds?: Set<EdgeKind>) =>
      graphs.current.edgesOf(id).filter(edge => edge.From === id && (!kinds || kinds.has(edge.EdgeKind ?? 'sync')));
    const incoming = (id: Id) => graphs.current.edgesOf(id).filter(edge => edge.To === id);
    const nodeCost = (id: Id) => {
      const node = graphs.current.getNode(id);
      return (node?.ComputeMs ?? 0) + (node?.LatencyMs ?? 0);
    };
    const edgeCost = (edge: { LatencyMs?: number; EdgeKind?: EdgeKind }) => edge.LatencyMs ?? (edge.EdgeKind === 'async' ? 1 : 5);
    const syncPathFrom = (start: Id, seen = new Set<Id>()): { cost: number; path: Id[] } => {
      if (seen.has(start)) return { cost: 0, path: [start] };
      const nextSeen = new Set(seen).add(start);
      const syncEdges = outgoing(start, new Set<EdgeKind>(['sync', 'read', 'write']));
      if (!syncEdges.length) return { cost: nodeCost(start), path: [start] };
      return syncEdges
        .map(edge => {
          const child = syncPathFrom(edge.To, nextSeen);
          return { cost: nodeCost(start) + edgeCost(edge) + child.cost, path: [start, ...child.path] };
        })
        .sort((a, b) => b.cost - a.cost)[0];
    };

    const observations = (): Observation[] => {
      const nodes = graphs.current.nodes();
      const edges = graphs.current.edges();
      const items: Observation[] = [];
      if (!nodes.length) return [{ level: 'info', title: 'Start with the right-side palette', detail: 'Add a gateway, service, database, Kafka topic, index, or user input node. Metrics you add in properties will feed the linter.' }];

      const requestRoots = nodes.filter(node => node.NodeType === 'user-input' || node.NodeType === 'gateway');
      const roots = requestRoots.length ? requestRoots : nodes.filter(node => incoming(node.id).length === 0);
      const longest = roots.map(node => syncPathFrom(node.id)).sort((a, b) => b.cost - a.cost)[0];
      if (longest?.cost) {
        const labels = longest.path.map(id => graphs.current.getNode(id)?.Label.text ?? id).join(' -> ');
        items.push({
          level: longest.cost > 500 ? 'error' : longest.cost > 200 ? 'warn' : 'info',
          title: `Sequential round trip ~${Math.round(longest.cost)} ms`,
          detail: labels,
        });
      }

      nodes.forEach(node => {
        const outSync = outgoing(node.id, new Set<EdgeKind>(['sync', 'read', 'write']));
        if (outSync.length >= 2) {
          const sum = outSync.reduce((total, edge) => total + edgeCost(edge) + nodeCost(edge.To), 0);
          items.push({ level: 'warn', title: `${node.Label.text} has ${outSync.length} sync fan-out calls`, detail: `If sequential, downstream work is roughly ${Math.round(sum)} ms. Mark independent work async or document parallelism.` });
        }
        const maxEdgeRps = Math.max(0, ...graphs.current.edgesOf(node.id).map(edge => edge.ThroughputRps ?? 0));
        if (node.ExpectedRps != null && maxEdgeRps > node.ExpectedRps) {
          items.push({ level: 'warn', title: `${node.Label.text} capacity below edge traffic`, detail: `Edge peak ${maxEdgeRps}/s exceeds node budget ${node.ExpectedRps}/s.` });
        }
        if ((node.NodeType === 'database' || node.NodeType === 'index') && !incoming(node.id).some(edge => edge.EdgeKind === 'write')) {
          items.push({ level: 'info', title: `${node.Label.text} has no write path`, detail: 'Read models need an owner, backfill path, and freshness target.' });
        }
        if (node.NodeType === 'kafka') {
          if (!incoming(node.id).length) items.push({ level: 'warn', title: `${node.Label.text} has no producer`, detail: 'Topics should show who publishes the event and expected payload size.' });
          if (!outgoing(node.id).length) items.push({ level: 'warn', title: `${node.Label.text} has no consumer`, detail: 'Show at least one consumer or mark it as out of scope.' });
        }
      });

      const asyncEdges = edges.filter(edge => edge.EdgeKind === 'async');
      if (asyncEdges.length) {
        const names = asyncEdges.slice(0, 3).map(edge => edge.Label?.text || `${edge.From}->${edge.To}`).join(', ');
        items.push({ level: 'info', title: `${asyncEdges.length} async ${asyncEdges.length === 1 ? 'boundary' : 'boundaries'}`, detail: `Add lag, retry, DLQ, idempotency, and ordering notes near: ${names}.` });
      }

      if (!edges.some(edge => edge.LatencyMs != null) || !nodes.some(node => node.ExpectedRps != null)) {
        items.push({ level: 'info', title: 'Add latency and throughput numbers', detail: 'Open properties on nodes and edges. The linter becomes more useful once the diagram has budgets.' });
      }
      return items.slice(0, 8);
    };

    const drawHints = () => emit('render.view.set', {
      place: Places.Stage,
      key: HINTS_KEY,
      view: () => {
        const panel = document.createElement('section');
        panel.className = 'design-hints';
        const title = document.createElement('div');
        title.className = 'design-hints-title';
        title.textContent = 'Observations';
        panel.append(title);
        observations().forEach(obs => {
          const row = document.createElement('div');
          row.className = `design-observation ${obs.level}`;
          const head = document.createElement('strong');
          head.textContent = obs.title;
          const detail = document.createElement('span');
          detail.textContent = obs.detail;
          row.append(head, detail);
          panel.append(row);
        });
        return panel;
      },
    });

    let queued = false;
    const scheduleHints = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        drawHints();
      });
    };
    bus.onAny(event => {
      if ((event.name.startsWith('graph.') || event.name === 'selection.changed') && graphs.current.nodes().length) scheduleHints();
    });
    on('app.start', () => {
      bootFromUrl();
      if (graphs.current.nodes().length) drawHints();
    });
  }, { requires: ['graph', 'tool.panel', 'render.stage', 'ability.selectable'] });
}
