import type { DataScale, EdgeKind, GraphSnapshot, NodeDraft, NodeType, SemanticFields, SystemNodeType } from '../model';
import { edgeRef, hasCompleteSemantics, hasFailurePlan, mergeSemantics, type Registry } from '../core';
import { Places } from '../types';
import type { Id } from '../types';

declare module '../types' {
  interface CustomEvents {
    'systemDesign.node.create': { nodeType: SystemNodeType };
    'systemDesign.edge.kind.set': { id?: Id; edgeKind: EdgeKind };
    'systemDesign.action.apply': { action: SemanticAction; id: Id };
    'systemDesign.share.copy': void;
    'systemDesign.shared': { url: string };
    'systemDesign.demo.imageSearch': void;
    'systemDesign.demo.resilientCheckout': void;
    'systemDesign.presentation.start': void;
    'systemDesign.presentation.next': void;
    'systemDesign.presentation.prev': void;
    'systemDesign.presentation.apply': void;
    'systemDesign.presentation.close': void;
  }
}

const PANEL_ID = 'system-design';
const PANEL_FOLD_ID = 'system-design.palette';
const HINTS_KEY = 'system-design:hints';
const PRESENTATION_KEY = 'system-design:presentation';
const NODE_TYPES: SystemNodeType[] = ['user-input', 'gateway', 'service', 'database', 'kafka', 'index', 'cache', 'rate-limit', 'circuit-breaker'];
const EDGE_KINDS: EdgeKind[] = ['sync', 'async', 'read', 'write'];
const EDGE_KIND_SET = new Set<string>(EDGE_KINDS);

type CompactSemantics = { p?: string; a?: string; l?: string; w?: string; o?: string; f?: string; d?: DataScale; fr?: number };
type CompactNode = [Id, string, NodeType, number, number, number, number, string?, number?, number?, number?, CompactSemantics?];
type CompactEdge = [Id, Id, Id, EdgeKind | '', string?, number?, number?, number?, CompactSemantics?];
type CompactSnapshot = { v: 1 | 2; n: CompactNode[]; e: CompactEdge[] };
type SemanticAction = 'queue-edge' | 'dlq-edge' | 'index-node' | 'outbox-node' | 'cache-edge' | 'rate-limit-node' | 'circuit-breaker-edge';
type Observation = { level: 'info' | 'warn' | 'error'; title: string; detail: string; action?: { kind: SemanticAction; id: Id; label: string } };
type PresentationStep = { title: string; detail: string; action?: { kind: SemanticAction; id: Id; label: string }; focus?: Id };

const nodeTitle: Record<SystemNodeType, string> = {
  'user-input': 'User input',
  gateway: 'Gateway',
  service: 'Service',
  database: 'Database',
  kafka: 'Kafka',
  index: 'Search index',
  cache: 'Cache',
  'rate-limit': 'Rate limiter',
  'circuit-breaker': 'Circuit breaker',
};

const nodeDefaults: Record<SystemNodeType, Omit<NodeDraft, 'NodeType'>> = {
  'user-input': { Label: { text: 'User input' }, Size: { w: 148, h: 78 }, Description: 'External actor, mobile app, CLI, or browser request source.', ExpectedRps: 200, LatencyMs: 20 },
  gateway: { Label: { text: 'Gateway' }, Size: { w: 170, h: 82 }, Description: 'Auth, routing, rate limits, request shaping.', ExpectedRps: 5000, ComputeMs: 4, LatencyMs: 15 },
  service: { Label: { text: 'Service' }, Size: { w: 196, h: 108 }, Description: 'Stateless compute. Add CPU time, downstream calls, and data ownership notes.', ExpectedRps: 1500, ComputeMs: 20, LatencyMs: 60 },
  database: { Label: { text: 'Database' }, Size: { w: 176, h: 92 }, Description: 'Durable source of truth. Mark read/write edges and expected load.', ExpectedRps: 2000, LatencyMs: 12 },
  kafka: { Label: { text: 'Kafka' }, Size: { w: 170, h: 82 }, Description: 'Async event boundary. Track event names, lag target, retention, and payload size.', ExpectedRps: 10000, LatencyMs: 5 },
  index: { Label: { text: 'Index' }, Size: { w: 176, h: 92 }, Description: 'Derived read model for search, ranking, or vector lookup.', ExpectedRps: 3000, LatencyMs: 25 },
  cache: { Label: { text: 'Cache' }, Size: { w: 168, h: 84 }, Description: 'Fast temporary read layer. Track hit rate, TTL, and invalidation.', ExpectedRps: 8000, LatencyMs: 3 },
  'rate-limit': { Label: { text: 'Rate limiter' }, Size: { w: 176, h: 84 }, Description: 'Rejects or shapes excess demand before it reaches expensive work.', ExpectedRps: 10000, ComputeMs: 2, LatencyMs: 5 },
  'circuit-breaker': { Label: { text: 'Circuit breaker' }, Size: { w: 190, h: 84 }, Description: 'Fails fast around unhealthy dependencies and protects caller budgets.', ExpectedRps: 3000, ComputeMs: 2, LatencyMs: 5 },
};

const nodeSemantics: Record<SystemNodeType, SemanticFields> = {
  'user-input': {
    Purpose: 'Makes demand visible: who calls the system, why, and at what rate.',
    Assumptions: 'Client identity, request shape, burstiness, and retry behavior are known.',
    Limits: 'Users can retry, disconnect, send bad input, or create burst traffic.',
    WhatThen: 'Add idempotency keys, client backoff, validation, and product-level degradation.',
    Observability: 'Track request rate, bad requests, client retries, abandonment, and top endpoints.',
    FailureMode: 'Client sees timeout or degraded response; avoid hidden duplicate writes.',
    DataScale: 'small',
  },
  gateway: {
    Purpose: 'Protects and routes the system: auth, rate limits, traffic shaping, and fanout control.',
    Assumptions: 'Fast decisions, cheap auth/cache lookups, and clear timeout budgets.',
    Limits: 'Can become a global bottleneck or amplify retries into downstream storms.',
    WhatThen: 'Partition by route/tenant, add circuit breakers, shed load, queue optional work.',
    Observability: 'Track per-route RPS, p95/p99 latency, rejected requests, retries, and downstream errors.',
    FailureMode: 'Fail closed for auth, fail fast for unavailable dependencies, return explicit 429/503.',
    DataScale: 'medium',
  },
  service: {
    Purpose: 'Owns business computation and coordinates calls across storage or services.',
    Assumptions: 'Stateless or explicitly owns state; timeout and retry budgets are bounded.',
    Limits: 'Sync fanout, thread pools, N+1 calls, and slow dependencies dominate latency.',
    WhatThen: 'Split hot paths, cache, batch, parallelize independent calls, or move slow work async.',
    Observability: 'Track RED metrics, dependency spans, queue depth, saturation, and error classes.',
    FailureMode: 'Use timeouts, bulkheads, retries with jitter, idempotency, and fallback where safe.',
    DataScale: 'medium',
  },
  database: {
    Purpose: 'Stores durable state or blobs with clear ownership and recovery expectations.',
    Assumptions: 'Access patterns, write volume, consistency needs, backup/RPO, and growth are estimated.',
    Limits: 'Hot partitions, lock contention, replication lag, storage growth, and expensive queries.',
    WhatThen: 'Add indexes, replicas, partitioning, sharding, snapshots, WAL/backups, and archival policy.',
    Observability: 'Track QPS, slow queries, locks, replication lag, storage growth, and backup freshness.',
    FailureMode: 'Recover from backups or fail over; writes may need idempotency and reconciliation.',
    DataScale: 'big',
  },
  kafka: {
    Purpose: 'Decouples producers and consumers with an observable async event boundary.',
    Assumptions: 'Partition key, ordering scope, delivery semantics, retention, and consumer lag budget are known.',
    Limits: 'Poison messages, rebalances, lag, duplicate delivery, and partition-key skew.',
    WhatThen: 'Add DLQ, retries, idempotent consumers, schema versioning, and partition expansion.',
    Observability: 'Track producer errors, consumer lag, retries, DLQ count, partition skew, and age of oldest message.',
    FailureMode: 'At-least-once usually means duplicates; consumers must be idempotent.',
    DataScale: 'big',
  },
  index: {
    Purpose: 'Turns large or expensive reads into fast lookups, search, or ranked retrieval.',
    Assumptions: 'Good keys/analyzers/hash, enough memory/cache, and acceptable staleness.',
    Limits: 'Stale data, reindexing cost, collisions/skew, memory pressure, and irrelevant old data.',
    WhatThen: 'Improve keys, partition/shard, add replicas/cache warming, TTLs, backfill/reindex pipelines.',
    Observability: 'Track query p95/p99, hit rate, index size, freshness lag, rejected queries, and reindex progress.',
    FailureMode: 'Fall back to degraded search or stale results; avoid blocking writes on reindexing.',
    DataScale: 'big',
  },
  cache: {
    Purpose: 'Makes hot reads fast and protects slower storage or services from repeated work.',
    Assumptions: 'High hit rate is plausible, TTL/invalidation is defined, and stale values are acceptable within a budget.',
    Limits: 'Stampedes, stale data, memory pressure, hot keys, and invalidation mistakes.',
    WhatThen: 'Use TTLs, request coalescing, cache warming, partitioning, and explicit stale/fallback behavior.',
    Observability: 'Track hit rate, evictions, memory, key skew, p95 latency, stampede count, and stale age.',
    FailureMode: 'Bypass to source with backpressure, serve stale if safe, or shed optional reads.',
    DataScale: 'big',
  },
  'rate-limit': {
    Purpose: 'Turns uncontrolled demand into explicit accepted/rejected traffic before expensive work.',
    Assumptions: 'Limit key, quota, burst budget, and reject/degrade policy are known.',
    Limits: 'Bad keys cause unfairness; too strict loses good traffic; too loose overloads downstream.',
    WhatThen: 'Use token bucket/sliding window, per-tenant limits, retry-after, priority lanes, and load shedding.',
    Observability: 'Track allowed/rejected rate, top limit keys, retry-after usage, and downstream saturation.',
    FailureMode: 'Fail closed for abuse and fail open/degraded only for trusted paths.',
    DataScale: 'medium',
  },
  'circuit-breaker': {
    Purpose: 'Stops slow or failing dependencies from consuming request budgets and thread pools.',
    Assumptions: 'Dependency health signal, timeout, open threshold, and fallback behavior are explicit.',
    Limits: 'False opens, retry storms after half-open, and hidden data loss if fallback is vague.',
    WhatThen: 'Add bulkheads, bounded retries with jitter, half-open probes, fallback, and dependency SLO alerts.',
    Observability: 'Track open/half-open state, dependency errors, timeout rate, fallback count, and saved latency.',
    FailureMode: 'Fail fast with fallback or explicit error; recover via half-open probes.',
    DataScale: 'small',
  },
};

const edgeSemantics: Record<EdgeKind, SemanticFields> = {
  sync: {
    Purpose: 'Gets an answer in the current request path.',
    Assumptions: 'Both endpoints are fast and share a clear timeout budget.',
    Limits: 'Adds tail latency, retry amplification, and cascading failure risk.',
    WhatThen: 'Use deadlines, circuit breakers, cache, parallelism, or move slow work async.',
    Observability: 'Trace span, p95/p99 latency, timeout rate, retry count, and downstream error class.',
    FailureMode: 'Caller must have timeout, fallback, or explicit error behavior.',
  },
  async: {
    Purpose: 'Decouples work from the request path and absorbs bursts.',
    Assumptions: 'Consumers are idempotent and eventual consistency is acceptable.',
    Limits: 'Lag, poison messages, duplicate delivery, and ordering scope.',
    WhatThen: 'Add DLQ, retry policy, partitioning, idempotency keys, and lag alerts.',
    Observability: 'Track lag, oldest message age, retries, DLQ count, consumer errors, and throughput.',
    FailureMode: 'Retry with backoff; send poison messages to DLQ; replay after fix.',
    FreshnessMs: 60_000,
  },
  read: {
    Purpose: 'Fetches state needed to answer or enrich work.',
    Assumptions: 'Query shape, consistency needs, and cacheability are understood.',
    Limits: 'N+1 reads, stale replicas, hot keys, and query fanout.',
    WhatThen: 'Add cache/read replica/index/denormalization, batch reads, or tighten access pattern.',
    Observability: 'Track QPS, p95/p99, cache hit rate, slow query count, and replica lag.',
    FailureMode: 'Fail closed for critical reads, or return stale/degraded data when product allows.',
  },
  write: {
    Purpose: 'Changes durable or derived state.',
    Assumptions: 'Ownership, idempotency, ordering, and consistency are explicit.',
    Limits: 'Multiple writes can diverge, lock, conflict, or require distributed transactions.',
    WhatThen: 'Use single writer, outbox, saga, idempotency key, reconciliation, or event sourcing.',
    Observability: 'Track write latency, conflicts, retries, duplicate keys, and replication/outbox lag.',
    FailureMode: 'Retry only if idempotent; otherwise compensate or reconcile.',
  },
};

const labelFor = (type: SystemNodeType) => ({
  'user-input': 'UI',
  gateway: 'GW',
  service: 'Svc',
  database: 'DB',
  kafka: 'Kafka',
  index: 'Index',
  cache: 'Cache',
  'rate-limit': 'Limit',
  'circuit-breaker': 'CB',
}[type]);

const edgeLabel = (kind: EdgeKind) => ({
  sync: 'Sync',
  async: 'Async',
  read: 'Read',
  write: 'Write',
}[kind]);

const compactSemantics = (item: SemanticFields): CompactSemantics | undefined => {
  const compact: CompactSemantics = {
    p: item.Purpose || undefined,
    a: item.Assumptions || undefined,
    l: item.Limits || undefined,
    w: item.WhatThen || undefined,
    o: item.Observability || undefined,
    f: item.FailureMode || undefined,
    d: item.DataScale,
    fr: item.FreshnessMs,
  };
  return Object.values(compact).some(value => value != null && value !== '') ? compact : undefined;
};
const expandSemantics = (compact?: CompactSemantics): SemanticFields => compact ? {
  Purpose: compact.p,
  Assumptions: compact.a,
  Limits: compact.l,
  WhatThen: compact.w,
  Observability: compact.o,
  FailureMode: compact.f,
  DataScale: compact.d,
  FreshnessMs: compact.fr,
} : {};

const fillSnapshotSemantics = (snapshot: GraphSnapshot): GraphSnapshot => ({
  nodes: snapshot.nodes.map(node => {
    const defaults = node.NodeType && node.NodeType in nodeSemantics
      ? nodeSemantics[node.NodeType as SystemNodeType]
      : {};
    return mergeSemantics(defaults, node);
  }),
  edges: snapshot.edges.map(edge => {
    const kind = edge.EdgeKind ?? 'sync';
    return mergeSemantics(edgeSemantics[kind], edge);
  }),
});

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
  v: 2,
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
    compactSemantics(node),
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
    compactSemantics(edge),
  ]),
});

const fromCompact = (compact: CompactSnapshot): GraphSnapshot | null => {
  if ((compact.v !== 1 && compact.v !== 2) || !Array.isArray(compact.n) || !Array.isArray(compact.e)) return null;
  return fillSnapshotSemantics({
    nodes: compact.n.map(([id, title, NodeType, x, y, w, h, Description, ComputeMs, ExpectedRps, LatencyMs, semantics]) => ({
      id,
      Label: { text: title },
      NodeType,
      Position: { x, y },
      Size: { w, h },
      Description,
      ComputeMs,
      ExpectedRps,
      LatencyMs,
      ...expandSemantics(semantics),
    })),
    edges: compact.e.map(([id, From, To, EdgeKind, label, LatencyMs, ThroughputRps, PayloadKb, semantics]) => ({
      id,
      From,
      To,
      EdgeKind: EDGE_KIND_SET.has(EdgeKind) ? EdgeKind as EdgeKind : undefined,
      Label: label ? { text: label } : undefined,
      LatencyMs,
      ThroughputRps,
      PayloadKb,
      ...expandSemantics(semantics),
    })),
  });
};

const imageSearchSnapshot = (): GraphSnapshot => fillSnapshotSemantics({
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

const resilientCheckoutSnapshot = (): GraphSnapshot => fillSnapshotSemantics({
  nodes: [
    { id: 'e1', Label: { text: 'Buyer app' }, NodeType: 'user-input', Position: { x: -720, y: -80 }, Size: { w: 150, h: 86 }, ExpectedRps: 900, LatencyMs: 25, Description: 'Checkout traffic with retries and mobile disconnects.', DataScale: 'medium' },
    { id: 'e2', Label: { text: 'API Gateway' }, NodeType: 'gateway', Position: { x: -500, y: -80 }, Size: { w: 170, h: 88 }, ExpectedRps: 4000, ComputeMs: 4, LatencyMs: 18, Description: 'Auth, token bucket, route deadlines, request shedding.', WhatThen: 'Drop low-value retries, return 429 with retry-after, route high-risk payment calls through stricter timeout.' },
    { id: 'e3', Label: { text: 'Checkout Service' }, NodeType: 'service', Position: { x: -245, y: -80 }, Size: { w: 220, h: 124 }, ExpectedRps: 1200, ComputeMs: 35, LatencyMs: 110, Description: 'Validates cart, writes order intent, calls payment, emits outbox event.', Assumptions: 'Request has idempotency key and bounded deadline.', Limits: 'Sync payment plus writes can exceed p99 budget under retry storms.' },
    { id: 'e4', Label: { text: 'Idempotency Store' }, NodeType: 'database', Position: { x: -250, y: -260 }, Size: { w: 190, h: 90 }, ExpectedRps: 2000, LatencyMs: 8, Description: 'Deduplicates checkout retries by idempotency key.', DataScale: 'big', FreshnessMs: 0 },
    { id: 'e5', Label: { text: 'Order DB' }, NodeType: 'database', Position: { x: -10, y: -20 }, Size: { w: 180, h: 92 }, ExpectedRps: 1000, LatencyMs: 20, Description: 'Source of truth for order intent and status.', DataScale: 'big' },
    { id: 'e6', Label: { text: 'Payment Gateway' }, NodeType: 'gateway', Position: { x: -10, y: -190 }, Size: { w: 186, h: 88 }, ExpectedRps: 800, ComputeMs: 10, LatencyMs: 180, Description: 'External payment dependency; suspicious sync latency.', Limits: 'External p99 and availability are not controlled by us.', WhatThen: 'Circuit breaker, timeout below caller deadline, async capture for slow providers.' },
    { id: 'e7', Label: { text: 'Outbox Relay' }, NodeType: 'service', Position: { x: 250, y: -20 }, Size: { w: 180, h: 92 }, ExpectedRps: 1000, ComputeMs: 20, LatencyMs: 60, Description: 'Polls committed outbox rows and publishes order events.', Purpose: 'Makes DB write and event publish mechanically recoverable.' },
    { id: 'e8', Label: { text: 'Orders Kafka' }, NodeType: 'kafka', Position: { x: 500, y: -20 }, Size: { w: 170, h: 86 }, ExpectedRps: 3000, LatencyMs: 10, Description: 'Events: order_created, payment_authorized.', FreshnessMs: 30_000 },
    { id: 'e9', Label: { text: 'DLQ' }, NodeType: 'kafka', Position: { x: 505, y: 170 }, Size: { w: 150, h: 78 }, ExpectedRps: 100, LatencyMs: 10, Description: 'Poison order events land here with reason and replay key.', Purpose: 'Keeps failure observable and replayable instead of blocking the stream.' },
    { id: 'e10', Label: { text: 'Search Projector' }, NodeType: 'service', Position: { x: 760, y: -80 }, Size: { w: 200, h: 96 }, ExpectedRps: 1200, ComputeMs: 30, LatencyMs: 80, Description: 'Builds read model from order events; idempotent by event id.' },
    { id: 'e11', Label: { text: 'Order Search Index' }, NodeType: 'index', Position: { x: 1010, y: -80 }, Size: { w: 210, h: 98 }, ExpectedRps: 5000, LatencyMs: 35, Description: 'Big-data read path for support/search/order history.', DataScale: 'huge', FreshnessMs: 45_000, Assumptions: 'Stale order search is acceptable within 45s.' },
    { id: 'e12', Label: { text: 'Support UI' }, NodeType: 'user-input', Position: { x: 760, y: 180 }, Size: { w: 150, h: 82 }, ExpectedRps: 120, LatencyMs: 30, Description: 'Reads order history and support search.' },
  ],
  edges: [
    { id: 'r1', From: 'e1', To: 'e2', EdgeKind: 'sync', Label: { text: 'POST /checkout' }, LatencyMs: 35, ThroughputRps: 900, PayloadKb: 8, Purpose: 'Request path for checkout conversion.', Limits: 'Too much traffic should be shaped at gateway, not queued in services.' },
    { id: 'r2', From: 'e2', To: 'e3', EdgeKind: 'sync', Label: { text: 'checkout command' }, LatencyMs: 20, ThroughputRps: 900, PayloadKb: 8 },
    { id: 'r3', From: 'e3', To: 'e4', EdgeKind: 'read', Label: { text: 'dedupe key' }, LatencyMs: 8, ThroughputRps: 900, PayloadKb: 1 },
    { id: 'r4', From: 'e3', To: 'e4', EdgeKind: 'write', Label: { text: 'record key' }, LatencyMs: 10, ThroughputRps: 900, PayloadKb: 1 },
    { id: 'r5', From: 'e3', To: 'e6', EdgeKind: 'sync', Label: { text: 'authorize payment' }, LatencyMs: 220, ThroughputRps: 700, PayloadKb: 4, FailureMode: 'Timeout then retry only with provider idempotency key; circuit-break on provider errors.' },
    { id: 'r6', From: 'e3', To: 'e5', EdgeKind: 'write', Label: { text: 'order + outbox' }, LatencyMs: 25, ThroughputRps: 900, PayloadKb: 3, Purpose: 'Atomic source-of-truth write and event intent.' },
    { id: 'r7', From: 'e7', To: 'e5', EdgeKind: 'read', Label: { text: 'poll outbox' }, LatencyMs: 30, ThroughputRps: 900, PayloadKb: 2, FreshnessMs: 15_000 },
    { id: 'r8', From: 'e7', To: 'e8', EdgeKind: 'async', Label: { text: 'publish order_created' }, LatencyMs: 10, ThroughputRps: 900, PayloadKb: 2, FailureMode: 'Retry with jitter; unresolved publish errors stay in outbox.' },
    { id: 'r9', From: 'e8', To: 'e10', EdgeKind: 'async', Label: { text: 'consume orders' }, LatencyMs: 20, ThroughputRps: 900, PayloadKb: 2, FailureMode: 'Retry by event id, then DLQ with replay pointer.' },
    { id: 'r10', From: 'e10', To: 'e11', EdgeKind: 'write', Label: { text: 'upsert read model' }, LatencyMs: 55, ThroughputRps: 900, PayloadKb: 2, FreshnessMs: 45_000 },
    { id: 'r11', From: 'e10', To: 'e9', EdgeKind: 'async', Label: { text: 'poison event' }, LatencyMs: 10, ThroughputRps: 30, PayloadKb: 2, Purpose: 'Make unrecoverable projection failures observable and replayable.' },
    { id: 'r12', From: 'e12', To: 'e11', EdgeKind: 'read', Label: { text: 'search order' }, LatencyMs: 45, ThroughputRps: 120, PayloadKb: 1 },
  ],
});

const learningCheckoutSnapshot = (): GraphSnapshot => fillSnapshotSemantics({
  nodes: [
    { id: 'e1', Label: { text: 'Buyer app' }, NodeType: 'user-input', Position: { x: -690, y: -70 }, Size: { w: 172, h: 98 }, ExpectedRps: 1500, LatencyMs: 25, Description: 'Bursty checkout client. Retries are uncontrolled.' },
    { id: 'e2', Label: { text: 'API Gateway' }, NodeType: 'gateway', Position: { x: -470, y: -70 }, Size: { w: 190, h: 98 }, ExpectedRps: 900, ComputeMs: 5, LatencyMs: 20, Description: 'No explicit rate limit. Hints should flag overload.' },
    { id: 'e3', Label: { text: 'Checkout Service' }, NodeType: 'service', Position: { x: -220, y: -70 }, Size: { w: 224, h: 112 }, ExpectedRps: 900, ComputeMs: 35, LatencyMs: 110, Description: 'Sync payment, two writes, no outbox.', Limits: 'This design mixes user latency, external dependency, and multiple writes.' },
    { id: 'e4', Label: { text: 'Payment Provider' }, NodeType: 'gateway', Position: { x: 40, y: -230 }, Size: { w: 198, h: 90 }, ExpectedRps: 500, ComputeMs: 8, LatencyMs: 260, Description: 'Slow external dependency. No breaker yet.' },
    { id: 'e5', Label: { text: 'Order DB' }, NodeType: 'database', Position: { x: 40, y: -20 }, Size: { w: 188, h: 98 }, ExpectedRps: 800, LatencyMs: 25, Description: 'Source of truth. Read strategy is missing.', DataScale: 'huge' },
    { id: 'e6', Label: { text: 'Support UI' }, NodeType: 'user-input', Position: { x: -220, y: 170 }, Size: { w: 172, h: 98 }, ExpectedRps: 120, LatencyMs: 30, Description: 'Reads order history from the source DB.' },
  ],
  edges: [
    { id: 'r1', From: 'e1', To: 'e2', EdgeKind: 'sync', Label: { text: 'POST /checkout' }, LatencyMs: 35, ThroughputRps: 1500, PayloadKb: 8 },
    { id: 'r2', From: 'e2', To: 'e3', EdgeKind: 'sync', Label: { text: 'checkout command' }, LatencyMs: 20, ThroughputRps: 1500, PayloadKb: 8 },
    { id: 'r3', From: 'e3', To: 'e4', EdgeKind: 'sync', Label: { text: 'authorize payment' }, LatencyMs: 280, ThroughputRps: 900, PayloadKb: 4 },
    { id: 'r4', From: 'e3', To: 'e5', EdgeKind: 'write', Label: { text: 'write order' }, LatencyMs: 25, ThroughputRps: 900, PayloadKb: 3 },
    { id: 'r5', From: 'e3', To: 'e5', EdgeKind: 'write', Label: { text: 'write audit' }, LatencyMs: 20, ThroughputRps: 900, PayloadKb: 1 },
    { id: 'r6', From: 'e6', To: 'e5', EdgeKind: 'read', Label: { text: 'order lookup' }, LatencyMs: 120, ThroughputRps: 120, PayloadKb: 1 },
  ],
});

const presentationSteps: PresentationStep[] = [
  {
    title: 'Start: intentionally rough checkout',
    detail: 'This graph has obvious design smells: gateway overload, sync external payment, multiple writes, big data read directly, and no failure path. Watch the observations panel.',
  },
  {
    title: 'Shape excess traffic before it reaches checkout',
    detail: 'Gateway demand is higher than its budget. Add a rate limiter so overload becomes explicit accepted/rejected traffic.',
    action: { kind: 'rate-limit-node', id: 'e2', label: 'Add limiter' },
    focus: 'e2',
  },
  {
    title: 'Protect the slow external payment call',
    detail: 'The payment provider is slow and outside our control. Add a circuit breaker so the request path can fail fast with a known fallback/error.',
    action: { kind: 'circuit-breaker-edge', id: 'r3', label: 'Add breaker' },
    focus: 'e4',
  },
  {
    title: 'Make multiple writes recoverable',
    detail: 'Checkout writes order and audit separately. Add an outbox so the design has one local durable write plus replayable async work.',
    action: { kind: 'outbox-node', id: 'e3', label: 'Add outbox' },
    focus: 'e3',
  },
  {
    title: 'Make big data readable',
    detail: 'Support reads a huge order DB directly. Add an index/read model so the hot read path becomes mechanically visible.',
    action: { kind: 'index-node', id: 'e5', label: 'Add index' },
    focus: 'e5',
  },
  {
    title: 'Cache a slow read only with assumptions',
    detail: 'The direct support read is slow. Add cache only because the tooltip semantics make TTL, stale data, and bypass behavior explicit.',
    action: { kind: 'cache-edge', id: 'r6', label: 'Add cache' },
    focus: 'e6',
  },
  {
    title: 'Read the result',
    detail: 'The graph is still not perfect, but the design is now observable: limiter, breaker, outbox, index, cache, freshness, and failure paths are visible and questionable.',
  },
];

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
      {
        id: 'systemDesign.action.apply',
        label: 'Apply semantic design action',
        group: 'system design',
        hidden: true,
        payload: ({ target }) => ({
          action: (target as HTMLElement | null)?.dataset.semanticAction as SemanticAction,
          id: (target as HTMLElement | null)?.dataset.semanticId ?? '',
        }),
      },
      { id: 'systemDesign.share.copy', label: 'Copy graph share link', group: 'system design' },
      { id: 'systemDesign.demo.imageSearch', label: 'Load image-search system design example', group: 'system design' },
      { id: 'systemDesign.demo.resilientCheckout', label: 'Load resilient checkout system design example', group: 'system design' },
      { id: 'systemDesign.presentation.start', label: 'Start system-design learning mode', group: 'system design' },
      { id: 'systemDesign.presentation.next', label: 'Next learning step', group: 'system design', hidden: true },
      { id: 'systemDesign.presentation.prev', label: 'Previous learning step', group: 'system design', hidden: true },
      { id: 'systemDesign.presentation.apply', label: 'Apply learning step', group: 'system design', hidden: true },
      { id: 'systemDesign.presentation.close', label: 'Close learning mode', group: 'system design', hidden: true },
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
    contribute({ surface: 'top', panel: PANEL_ID, command: 'systemDesign.demo.resilientCheckout', kind: 'button', text: 'Checkout', label: 'Load resilient checkout example', className: 'design-palette-button', order: 52 });
    contribute({ surface: 'top', panel: PANEL_ID, command: 'systemDesign.presentation.start', kind: 'button', text: 'Learn', label: 'Start guided learning mode', className: 'design-palette-button', order: 53 });

    on('systemDesign.node.create', ({ nodeType }) => {
      const source = selectedNodeId();
      const defaults = nodeDefaults[nodeType];
      emit('graph.node.create', {
        ...nodeSemantics[nodeType],
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
      emit('item.update', { ref: edgeRef(id), patch: { ...edgeSemantics[edgeKind], EdgeKind: edgeKind } });
    });

    const createNode = (draft: NodeDraft & { NodeType: SystemNodeType }) => {
      const node = graphs.current.createNode(mergeSemantics(nodeSemantics[draft.NodeType], draft));
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id });
      return node;
    };
    const createEdge = (draft: { From: Id; To: Id; EdgeKind: EdgeKind; Label?: { text: string }; LatencyMs?: number; ThroughputRps?: number; PayloadKb?: number } & SemanticFields) => {
      const edge = graphs.current.createEdge(mergeSemantics(edgeSemantics[draft.EdgeKind], draft));
      emit('graph.edge.created', { graphId: graphs.current.id, id: edge.id, edge });
      return edge;
    };
    const midpoint = (fromId: Id, toId: Id, offset: Partial<{ x: number; y: number }> = {}) => {
      const from = graphs.current.getNode(fromId)?.Position ?? { x: 0, y: 0 };
      const to = graphs.current.getNode(toId)?.Position ?? { x: from.x + 220, y: from.y };
      return { x: (from.x + to.x) / 2 + (offset.x ?? 0), y: (from.y + to.y) / 2 + (offset.y ?? 0) };
    };
    const addQueueOnEdge = (id: Id) => {
      const edge = graphs.current.getEdge(id);
      if (!edge) return;
      const label = edge.Label?.text ?? `${nodeName(edge.From)} to ${nodeName(edge.To)}`;
      const queue = createNode({
        ...nodeDefaults.kafka,
        NodeType: 'kafka',
        Label: { text: `${label} queue` },
        Position: midpoint(edge.From, edge.To, { y: 80 }),
        Description: `Async buffer inserted for ${label}.`,
        Purpose: 'Absorbs bursts and removes slow work from the synchronous request path.',
        Assumptions: 'Eventual consistency is acceptable and consumers are idempotent.',
      });
      emit('graph.edge.delete', { id: edge.id });
      createEdge({ From: edge.From, To: queue.id, EdgeKind: 'async', Label: { text: `enqueue ${label}` }, LatencyMs: 10, ThroughputRps: edge.ThroughputRps, PayloadKb: edge.PayloadKb });
      createEdge({ From: queue.id, To: edge.To, EdgeKind: 'async', Label: { text: `consume ${label}` }, LatencyMs: 20, ThroughputRps: edge.ThroughputRps, PayloadKb: edge.PayloadKb });
    };
    const addDlqForEdge = (id: Id) => {
      const edge = graphs.current.getEdge(id);
      if (!edge) return;
      const target = graphs.current.getNode(edge.To);
      const anchor = target?.Position ?? midpoint(edge.From, edge.To);
      const dlq = createNode({
        ...nodeDefaults.kafka,
        NodeType: 'kafka',
        Label: { text: `${edge.Label?.text ?? 'edge'} DLQ` },
        Position: { x: anchor.x + 180, y: anchor.y + 150 },
        Size: { w: 150, h: 78 },
        ExpectedRps: Math.max(10, Math.round((edge.ThroughputRps ?? 100) * 0.05)),
        Description: 'Dead-letter stream for poison messages and replay.',
        Purpose: 'Makes failed async work observable and replayable.',
        FailureMode: 'Replay after fix using event id and original payload.',
      });
      createEdge({ From: edge.To, To: dlq.id, EdgeKind: 'async', Label: { text: 'poison message' }, LatencyMs: 10, ThroughputRps: dlq.ExpectedRps, PayloadKb: edge.PayloadKb, Purpose: 'Route unrecoverable failures to a replayable dead-letter stream.' });
    };
    const addIndexForNode = (id: Id) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      const pos = node.Position ?? { x: 0, y: 0 };
      const index = createNode({
        ...nodeDefaults.index,
        NodeType: 'index',
        Label: { text: `${node.Label.text} index` },
        Position: { x: pos.x + 240, y: pos.y },
        DataScale: node.DataScale === 'huge' ? 'huge' : 'big',
        FreshnessMs: node.FreshnessMs ?? 60_000,
        Description: `Read model/index for ${node.Label.text}.`,
        Assumptions: 'Queries have a stable key/analyzer and stale reads are acceptable within the freshness budget.',
      });
      createEdge({ From: node.id, To: index.id, EdgeKind: 'write', Label: { text: 'update index' }, LatencyMs: 30, ThroughputRps: node.ExpectedRps, PayloadKb: 2, FreshnessMs: index.FreshnessMs });
      createEdge({ From: index.id, To: node.id, EdgeKind: 'read', Label: { text: 'fast lookup' }, LatencyMs: 20, ThroughputRps: node.ExpectedRps, PayloadKb: 1 });
    };
    const addOutboxForNode = (id: Id) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      const pos = node.Position ?? { x: 0, y: 0 };
      const outbox = createNode({
        ...nodeDefaults.database,
        NodeType: 'database',
        Label: { text: `${node.Label.text} outbox` },
        Position: { x: pos.x + 220, y: pos.y + 120 },
        Size: { w: 180, h: 88 },
        Description: 'Transactional outbox for multi-write consistency.',
        Purpose: 'Turns multiple writes into one durable write plus replayable async publish.',
        WhatThen: 'Relay to Kafka, retry safely, and reconcile stuck rows.',
      });
      createEdge({ From: node.id, To: outbox.id, EdgeKind: 'write', Label: { text: 'write outbox' }, LatencyMs: 15, ThroughputRps: node.ExpectedRps, PayloadKb: 2, Purpose: 'Single local write that records the event intent atomically.' });
    };
    const addCacheOnEdge = (id: Id) => {
      const edge = graphs.current.getEdge(id);
      if (!edge) return;
      const label = edge.Label?.text ?? `${nodeName(edge.From)} read`;
      const cache = createNode({
        ...nodeDefaults.cache,
        NodeType: 'cache',
        Label: { text: `${label} cache` },
        Position: midpoint(edge.From, edge.To, { y: -90 }),
        Description: `Cache inserted for ${label}.`,
        Purpose: 'Makes repeated reads fast and reduces pressure on the source.',
        Assumptions: 'The read is cacheable and stale values are acceptable within TTL.',
        FreshnessMs: edge.FreshnessMs ?? 30_000,
      });
      emit('graph.edge.delete', { id: edge.id });
      createEdge({ From: edge.From, To: cache.id, EdgeKind: 'read', Label: { text: `cache lookup` }, LatencyMs: 3, ThroughputRps: edge.ThroughputRps, PayloadKb: edge.PayloadKb, FreshnessMs: cache.FreshnessMs });
      createEdge({ From: cache.id, To: edge.To, EdgeKind: 'read', Label: { text: `cache miss ${label}` }, LatencyMs: edge.LatencyMs, ThroughputRps: Math.round((edge.ThroughputRps ?? 100) * 0.2), PayloadKb: edge.PayloadKb, FreshnessMs: cache.FreshnessMs });
    };
    const addRateLimitBeforeNode = (id: Id) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      const pos = node.Position ?? { x: 0, y: 0 };
      const limiter = createNode({
        ...nodeDefaults['rate-limit'],
        NodeType: 'rate-limit',
        Label: { text: `${node.Label.text} limiter` },
        Position: { x: pos.x - 220, y: pos.y - 110 },
        ExpectedRps: node.ExpectedRps,
        Description: `Rate limiter protecting ${node.Label.text}.`,
        Purpose: 'Rejects excess demand before it saturates the protected component.',
      });
      createEdge({ From: limiter.id, To: node.id, EdgeKind: 'sync', Label: { text: 'allowed traffic' }, LatencyMs: 5, ThroughputRps: node.ExpectedRps, PayloadKb: 1, Purpose: 'Only admitted traffic reaches the protected node.' });
    };
    const addCircuitBreakerOnEdge = (id: Id) => {
      const edge = graphs.current.getEdge(id);
      if (!edge) return;
      const label = edge.Label?.text ?? `${nodeName(edge.From)} call`;
      const breaker = createNode({
        ...nodeDefaults['circuit-breaker'],
        NodeType: 'circuit-breaker',
        Label: { text: `${label} breaker` },
        Position: midpoint(edge.From, edge.To, { y: -80 }),
        Description: `Circuit breaker around ${label}.`,
        Purpose: 'Fails fast when the dependency is slow or unhealthy.',
        FailureMode: 'Open circuit returns fallback or explicit dependency-unavailable error.',
      });
      emit('graph.edge.delete', { id: edge.id });
      createEdge({ From: edge.From, To: breaker.id, EdgeKind: 'sync', Label: { text: `guard ${label}` }, LatencyMs: 5, ThroughputRps: edge.ThroughputRps, PayloadKb: edge.PayloadKb });
      createEdge({ From: breaker.id, To: edge.To, EdgeKind: 'sync', Label: { text: label }, LatencyMs: edge.LatencyMs, ThroughputRps: edge.ThroughputRps, PayloadKb: edge.PayloadKb, FailureMode: edge.FailureMode });
    };
    const applySemanticAction = (action: SemanticAction | undefined, id: Id) => {
      if (!id) return;
      if (action === 'queue-edge') addQueueOnEdge(id);
      if (action === 'dlq-edge') addDlqForEdge(id);
      if (action === 'index-node') addIndexForNode(id);
      if (action === 'outbox-node') addOutboxForNode(id);
      if (action === 'cache-edge') addCacheOnEdge(id);
      if (action === 'rate-limit-node') addRateLimitBeforeNode(id);
      if (action === 'circuit-breaker-edge') addCircuitBreakerOnEdge(id);
      emit('view.fit.all');
    };
    on('systemDesign.action.apply', ({ action, id }) => {
      applySemanticAction(action, id);
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
    on('systemDesign.demo.resilientCheckout', () => {
      emit('graph.import.snapshot', resilientCheckoutSnapshot());
      emit('view.fit.all');
    });

    let presentationIndex: number | null = null;
    const currentStep = () => presentationIndex == null ? null : presentationSteps[presentationIndex] ?? null;
    const drawPresentation = () => {
      const step = currentStep();
      if (!step) {
        emit('render.view.clear', { place: Places.Stage, key: PRESENTATION_KEY });
        return;
      }
      emit('render.view.set', {
        place: Places.Stage,
        key: PRESENTATION_KEY,
        view: () => {
          const panel = document.createElement('section');
          panel.className = 'design-presentation';
          panel.title = 'Guided mode: apply one improvement, then watch the live observations update.';

          const kicker = document.createElement('div');
          kicker.className = 'design-presentation-kicker';
          kicker.textContent = `Step ${presentationIndex! + 1} / ${presentationSteps.length}`;
          const title = document.createElement('strong');
          title.textContent = step.title;
          const detail = document.createElement('p');
          detail.textContent = step.detail;
          panel.append(kicker, title, detail);

          const actions = document.createElement('div');
          actions.className = 'design-presentation-actions';
          const prev = document.createElement('button');
          prev.type = 'button';
          prev.dataset.command = 'systemDesign.presentation.prev';
          prev.textContent = 'Prev';
          prev.disabled = presentationIndex === 0;
          const next = document.createElement('button');
          next.type = 'button';
          next.dataset.command = 'systemDesign.presentation.next';
          next.textContent = presentationIndex === presentationSteps.length - 1 ? 'Done' : 'Next';
          actions.append(prev);
          if (step.action) {
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.dataset.command = 'systemDesign.presentation.apply';
            apply.className = 'primary';
            apply.textContent = step.action.label;
            apply.title = 'Apply this improvement to the graph, then inspect the observations panel.';
            actions.append(apply);
          }
          actions.append(next);
          const close = document.createElement('button');
          close.type = 'button';
          close.dataset.command = 'systemDesign.presentation.close';
          close.textContent = 'Close';
          actions.append(close);
          panel.append(actions);
          return panel;
        },
      });
    };
    const setPresentationIndex = (index: number) => {
      presentationIndex = Math.max(0, Math.min(index, presentationSteps.length - 1));
      const step = currentStep();
      if (step?.focus) emit('view.fit.item', { kind: 'node', id: step.focus });
      drawPresentation();
    };
    on('systemDesign.presentation.start', () => {
      emit('graph.import.snapshot', learningCheckoutSnapshot());
      emit('view.fit.all');
      setPresentationIndex(0);
    });
    on('systemDesign.presentation.next', () => {
      if (presentationIndex == null) return;
      if (presentationIndex >= presentationSteps.length - 1) {
        presentationIndex = null;
        emit('render.view.clear', { place: Places.Stage, key: PRESENTATION_KEY });
        return;
      }
      setPresentationIndex(presentationIndex + 1);
    });
    on('systemDesign.presentation.prev', () => {
      if (presentationIndex == null) return;
      setPresentationIndex(presentationIndex - 1);
    });
    on('systemDesign.presentation.apply', () => {
      const step = currentStep();
      if (!step?.action) return;
      applySemanticAction(step.action.kind, step.action.id);
      drawPresentation();
    });
    on('systemDesign.presentation.close', () => {
      presentationIndex = null;
      emit('render.view.clear', { place: Places.Stage, key: PRESENTATION_KEY });
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
    const nodeName = (id: Id) => graphs.current.getNode(id)?.Label.text ?? id;
    const findCycle = () => {
      const visiting = new Set<Id>();
      const visited = new Set<Id>();
      const stack: Id[] = [];
      const dfs = (id: Id): Id[] | null => {
        if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
        if (visited.has(id)) return null;
        visiting.add(id);
        stack.push(id);
        for (const edge of outgoing(id)) {
          const cycle = dfs(edge.To);
          if (cycle) return cycle;
        }
        stack.pop();
        visiting.delete(id);
        visited.add(id);
        return null;
      };
      for (const node of graphs.current.nodes()) {
        const cycle = dfs(node.id);
        if (cycle) return cycle;
      }
      return null;
    };
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

      const cycle = findCycle();
      if (cycle) {
        items.push({ level: 'error', title: 'Cycle detected', detail: `${cycle.map(nodeName).join(' -> ')}. Ask whether this is a control loop, retry loop, feedback pipeline, or accidental dependency.` });
      }

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
        if (!hasCompleteSemantics(node)) {
          items.push({ level: 'info', title: `${node.Label.text} needs semantic intent`, detail: 'Fill purpose, assumptions, limits, what-then, and observability so warnings become tied to a design decision.' });
        }
        if (outSync.length >= 2) {
          const sum = outSync.reduce((total, edge) => total + edgeCost(edge) + nodeCost(edge.To), 0);
          items.push({ level: 'warn', title: `${node.Label.text} has ${outSync.length} sync fan-out calls`, detail: `If sequential, downstream work is roughly ${Math.round(sum)} ms. Mark independent work async or document parallelism.` });
        }
        const writeFanout = outgoing(node.id, new Set<EdgeKind>(['write']));
        if (writeFanout.length >= 2) {
          items.push({ level: 'warn', title: `${node.Label.text} writes to ${writeFanout.length} places`, detail: 'Multiple writes can diverge. Consider single writer, outbox, saga, idempotency, or reconciliation.', action: { kind: 'outbox-node', id: node.id, label: 'Add outbox' } });
        }
        const maxEdgeRps = Math.max(0, ...graphs.current.edgesOf(node.id).map(edge => edge.ThroughputRps ?? 0));
        if (node.ExpectedRps != null && maxEdgeRps > node.ExpectedRps) {
          items.push({ level: 'warn', title: `${node.Label.text} capacity below edge traffic`, detail: `Edge peak ${maxEdgeRps}/s exceeds node budget ${node.ExpectedRps}/s. Add rate limiting, shedding, queueing, or scaling.`, action: { kind: 'rate-limit-node', id: node.id, label: 'Add limiter' } });
        }
        if ((node.DataScale === 'big' || node.DataScale === 'huge') && node.NodeType !== 'index' && node.NodeType !== 'kafka' && !outgoing(node.id, new Set<EdgeKind>(['read'])).length && !incoming(node.id).some(edge => edge.EdgeKind === 'read')) {
          items.push({ level: 'info', title: `${node.Label.text} is big data without a read strategy`, detail: 'Make it readable with an index, partition key, cache, replica, retention, or query-shaping rule.', action: { kind: 'index-node', id: node.id, label: 'Add index' } });
        }
        if (node.NodeType === 'index' && (node.DataScale === 'big' || node.DataScale === 'huge')) {
          const hasRead = incoming(node.id).some(edge => edge.EdgeKind === 'read');
          const hasWrite = incoming(node.id).some(edge => edge.EdgeKind === 'write');
          items.push({ level: hasRead && hasWrite ? 'info' : 'warn', title: `${node.Label.text} makes big data readable`, detail: hasRead && hasWrite ? 'Good: write/update path and read path are both visible. Watch freshness, partitioning, and reindexing.' : 'Show both who updates the index and who reads it, plus freshness and reindex behavior.' });
        }
        if (node.FreshnessMs != null && node.FreshnessMs > 30_000) {
          items.push({ level: 'info', title: `${node.Label.text} can be stale for ${Math.round(node.FreshnessMs / 1000)}s`, detail: 'Make the product-visible stale state explicit and add freshness lag alerts.' });
        }
        if ((node.NodeType === 'database' || node.NodeType === 'index') && !incoming(node.id).some(edge => edge.EdgeKind === 'write')) {
          items.push({ level: 'info', title: `${node.Label.text} has no write path`, detail: 'Read models need an owner, backfill path, and freshness target.' });
        }
        if (node.NodeType === 'kafka') {
          if (!incoming(node.id).length) items.push({ level: 'warn', title: `${node.Label.text} has no producer`, detail: 'Topics should show who publishes the event and expected payload size.' });
          if (!outgoing(node.id).length) items.push({ level: 'warn', title: `${node.Label.text} has no consumer`, detail: 'Show at least one consumer or mark it as out of scope.' });
        }
      });

      edges.forEach(edge => {
        const target = graphs.current.getNode(edge.To);
        const kind = edge.EdgeKind ?? 'sync';
        const edgeLatency = edgeCost(edge) + nodeCost(edge.To);
        if (!hasCompleteSemantics(edge)) {
          items.push({ level: 'info', title: `${edge.Label?.text || `${nodeName(edge.From)} -> ${nodeName(edge.To)}`} needs edge semantics`, detail: 'Purpose, limits, failure mode, and observability make edge questions actionable.' });
        }
        if (kind === 'sync') {
          items.push({ level: edgeLatency > 180 ? 'warn' : 'info', title: `Sync edge: ${edge.Label?.text || `${nodeName(edge.From)} -> ${nodeName(edge.To)}`}`, detail: `Sync edges are suspicious by default. Downstream budget is about ${Math.round(edgeLatency)} ms; require fast target, timeout, and fallback.`, action: { kind: edgeLatency > 180 ? 'circuit-breaker-edge' : 'queue-edge', id: edge.id, label: edgeLatency > 180 ? 'Add breaker' : 'Insert queue' } });
        }
        if (kind === 'read' && edgeLatency > 80) {
          items.push({ level: 'info', title: `${edge.Label?.text || 'Read'} may benefit from cache`, detail: `Read path costs about ${Math.round(edgeLatency)} ms. Cache only if hit rate and staleness assumptions are explicit.`, action: { kind: 'cache-edge', id: edge.id, label: 'Add cache' } });
        }
        if ((kind === 'async' || kind === 'write') && !hasFailurePlan(edge)) {
          items.push({ level: 'warn', title: `${edge.Label?.text || kind} has no failure policy`, detail: 'Add retry/backoff, DLQ, idempotency, compensation, or reconciliation notes.', action: { kind: 'dlq-edge', id: edge.id, label: 'Add DLQ' } });
        }
        if (kind === 'async' && edge.FreshnessMs != null) {
          items.push({ level: 'info', title: `${edge.Label?.text || 'Async edge'} freshness budget`, detail: `Data may be stale for up to ${Math.round(edge.FreshnessMs / 1000)}s. Alert on lag and age of oldest message.` });
        }
        if (target && edge.ThroughputRps != null && target.ExpectedRps != null && edge.ThroughputRps > target.ExpectedRps) {
          items.push({ level: 'warn', title: `${edge.Label?.text || 'Edge'} can overload ${target.Label.text}`, detail: `${edge.ThroughputRps}/s exceeds target budget ${target.ExpectedRps}/s. Add backpressure, queueing, shedding, or scaling.`, action: { kind: 'queue-edge', id: edge.id, label: 'Buffer' } });
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
      return items.slice(0, 12);
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
          if (obs.action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'design-observation-action';
            button.dataset.command = 'systemDesign.action.apply';
            button.dataset.semanticAction = obs.action.kind;
            button.dataset.semanticId = obs.action.id;
            button.textContent = obs.action.label;
            row.append(button);
          }
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
