import type { Id, ItemRef, Label, Position, Rect, Size } from '../types';
import type { DataScale, SemanticFields } from '../core/semantics';
export type { DataScale, SemanticFields } from '../core/semantics';

// ----- Domain types -----
// Live here, next to the classes implementing them. Anything kind-specific
// (node, edge, future container) belongs in the model layer, not in types.ts.
export type Entity = { id: Id; kind: string; Label: Label; Size: Size; Position?: Position };

export type SystemNodeType = 'database' | 'kafka' | 'service' | 'index' | 'user-input' | 'gateway' | 'cache' | 'rate-limit' | 'circuit-breaker';
export type NodeType = 'text' | 'square' | 'circle' | SystemNodeType;
export type EdgeKind = 'read' | 'write' | 'sync' | 'async';
export type NodeEntity = Entity & SemanticFields & {
  kind: 'node';
  NodeType: NodeType;
  Description?: string;
  ComputeMs?: number;
  ExpectedRps?: number;
  LatencyMs?: number;
};
export type NodeDraft = {
  Label?: Label;
  Position?: Position;
  Size?: Size;
  NodeType?: NodeType;
  Description?: string;
  ComputeMs?: number;
  ExpectedRps?: number;
  LatencyMs?: number;
} & SemanticFields;
export type NodePatch = Partial<Pick<NodeEntity, 'Label' | 'Size' | 'Position' | 'NodeType' | 'Description' | 'ComputeMs' | 'ExpectedRps' | 'LatencyMs' | 'Purpose' | 'Assumptions' | 'Limits' | 'WhatThen' | 'Observability' | 'FailureMode' | 'DataScale' | 'FreshnessMs'>>;
export type NodeCreateOptions = { at?: Position; near?: Id | null };

/** Operation-time hints attached to create events. They control the lifecycle around the
 *  new node — focus behavior, edge creation, placement anchor — without polluting NodeDraft. */
export type CreateHints = {
  /** Don't move focus to the new node. Selection still moves (so user can keep editing). */
  keepFocus?: boolean;
  /** Place the new node near this id, using the same near-placement heuristic as the graph store. */
  relativeTo?: Id;
  /** After the node lands, also create an edge from this id to the new node id. */
  connectFrom?: Id;
  /** Edge kind for the optional created edge. */
  connectKind?: EdgeKind;
};

export type EdgeEntity = SemanticFields & {
  id: Id;
  kind: 'edge';
  From: Id;
  To: Id;
  Label?: Label;
  EdgeKind?: EdgeKind;
  LatencyMs?: number;
  ThroughputRps?: number;
  PayloadKb?: number;
};
export type EdgeDraft = { From: Id; To: Id; Label?: Label; EdgeKind?: EdgeKind; LatencyMs?: number; ThroughputRps?: number; PayloadKb?: number } & SemanticFields;
export type EdgeCreateDraft = Partial<EdgeDraft>;
export type EdgePatch = Partial<Pick<EdgeEntity, 'Label' | 'From' | 'To' | 'EdgeKind' | 'LatencyMs' | 'ThroughputRps' | 'PayloadKb' | 'Purpose' | 'Assumptions' | 'Limits' | 'WhatThen' | 'Observability' | 'FailureMode' | 'DataScale' | 'FreshnessMs'>>;
export type GraphSnapshot = { nodes: NodeDraftWithId[]; edges: EdgeDraftWithId[] };
export type NodeDraftWithId = NodeDraft & { id: Id };
export type EdgeDraftWithId = EdgeDraft & { id: Id };

type StoredItem = { id?: Id; parent?: Id[] };
type ItemStore<T = unknown> = () => T[];

const parentKey = (parent?: Id[]) => JSON.stringify(parent ?? []);

export class GraphNode implements NodeEntity {
  kind = 'node' as const;
  Label: Label;
  Size: Size;
  Position?: Position;
  NodeType: NodeType;
  Description?: string;
  ComputeMs?: number;
  ExpectedRps?: number;
  LatencyMs?: number;
  Purpose?: string;
  Assumptions?: string;
  Limits?: string;
  WhatThen?: string;
  Observability?: string;
  FailureMode?: string;
  DataScale?: DataScale;
  FreshnessMs?: number;

  constructor(readonly graph: Graph, readonly id: Id, draft: NodeDraft = {}) {
    this.Label = draft.Label ?? { text: id };
    this.Size = draft.Size ?? { w: 150, h: 64 };
    this.Position = draft.Position;
    this.NodeType = draft.NodeType ?? 'text';
    this.Description = draft.Description ?? '';
    this.ComputeMs = draft.ComputeMs;
    this.ExpectedRps = draft.ExpectedRps;
    this.LatencyMs = draft.LatencyMs;
    this.Purpose = draft.Purpose;
    this.Assumptions = draft.Assumptions;
    this.Limits = draft.Limits;
    this.WhatThen = draft.WhatThen;
    this.Observability = draft.Observability;
    this.FailureMode = draft.FailureMode;
    this.DataScale = draft.DataScale;
    this.FreshnessMs = draft.FreshnessMs;
  }
}

export class GraphEdge implements EdgeEntity {
  kind = 'edge' as const;
  Label?: Label;
  EdgeKind?: EdgeKind;
  LatencyMs?: number;
  ThroughputRps?: number;
  PayloadKb?: number;
  Purpose?: string;
  Assumptions?: string;
  Limits?: string;
  WhatThen?: string;
  Observability?: string;
  FailureMode?: string;
  DataScale?: DataScale;
  FreshnessMs?: number;
  constructor(readonly graph: Graph, readonly id: Id, draft: EdgeDraft) {
    this.From = draft.From;
    this.To = draft.To;
    this.Label = draft.Label;
    this.EdgeKind = draft.EdgeKind ?? (draft.Label?.text as EdgeKind | undefined);
    this.LatencyMs = draft.LatencyMs;
    this.ThroughputRps = draft.ThroughputRps;
    this.PayloadKb = draft.PayloadKb;
    this.Purpose = draft.Purpose;
    this.Assumptions = draft.Assumptions;
    this.Limits = draft.Limits;
    this.WhatThen = draft.WhatThen;
    this.Observability = draft.Observability;
    this.FailureMode = draft.FailureMode;
    this.DataScale = draft.DataScale;
    this.FreshnessMs = draft.FreshnessMs;
  }
  From: Id;
  To: Id;
}

export class Graph {
  static new(id: Id) { return new Graph(id); }

  private nextNode = 1;
  private nextEdge = 1;
  private items = new Map<Id, GraphNode>();
  private edgeMap = new Map<Id, GraphEdge>();
  private itemStores = new Map<string, ItemStore>();
  // Snapshot caches: nodes()/edges() handed out a fresh `[...spread]` on every
  // call (hot — the renderer iterates per redraw). Cache the array and null it
  // only on *structural* change (create/delete); in-place updates keep the same
  // objects, so the cached array stays valid.
  private nodeArr: GraphNode[] | null = null;
  private edgeArr: GraphEdge[] | null = null;
  // Adjacency index nodeId → incident edge ids. Turns edgesOf / delete-cascade
  // from O(E) scans into O(degree).
  private adjacency = new Map<Id, Set<Id>>();

  // ----- Spatial index (uniform grid) -----
  // Buckets node ids by their position cell so the renderer can ask "which
  // nodes fall in this viewport rect" in O(cells + hits) instead of scanning
  // every node each pan/zoom frame. Maintained on create/move/delete.
  private static readonly CELL = 256;
  private grid = new Map<string, Set<Id>>();
  private nodeCell = new Map<Id, string>();
  private cellKey(x: number, y: number) {
    return `${Math.floor(x / Graph.CELL)},${Math.floor(y / Graph.CELL)}`;
  }
  private indexNode(node: GraphNode) {
    const p = node.Position;
    if (!p) return;
    const key = this.cellKey(p.x, p.y);
    const prev = this.nodeCell.get(node.id);
    if (prev === key) return;
    if (prev) this.grid.get(prev)?.delete(node.id);
    (this.grid.get(key) ?? this.grid.set(key, new Set()).get(key)!).add(node.id);
    this.nodeCell.set(node.id, key);
  }
  private unindexNode(id: Id) {
    const prev = this.nodeCell.get(id);
    if (prev) { this.grid.get(prev)?.delete(id); this.nodeCell.delete(id); }
  }
  /** Node ids whose cell overlaps `rect`. A node spans at most one extra cell
   *  beyond its center, and callers pass a margin-expanded rect, so cell-level
   *  granularity is sufficient (the renderer still has exact bounds to refine). */
  nodeIdsInRect(rect: Rect): Id[] {
    const x0 = Math.floor(rect.x / Graph.CELL), x1 = Math.floor((rect.x + rect.w) / Graph.CELL);
    const y0 = Math.floor(rect.y / Graph.CELL), y1 = Math.floor((rect.y + rect.h) / Graph.CELL);
    const out: Id[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        this.grid.get(`${cx},${cy}`)?.forEach(id => out.push(id));
      }
    }
    return out;
  }

  private addAdj(edge: GraphEdge) {
    (this.adjacency.get(edge.From) ?? this.adjacency.set(edge.From, new Set()).get(edge.From)!).add(edge.id);
    (this.adjacency.get(edge.To) ?? this.adjacency.set(edge.To, new Set()).get(edge.To)!).add(edge.id);
  }
  private removeAdj(edge: GraphEdge) {
    this.adjacency.get(edge.From)?.delete(edge.id);
    this.adjacency.get(edge.To)?.delete(edge.id);
  }

  private constructor(readonly id: Id) {
    this.registerItemStore('node', () => this.nodes());
    this.registerItemStore('edge', () => this.edges());
  }

  registerItemStore<T>(kind: string, provider: ItemStore<T>) {
    this.itemStores.set(kind, provider as ItemStore);
    return () => {
      if (this.itemStores.get(kind) === provider) this.itemStores.delete(kind);
    };
  }

  itemsOfKind<T = unknown>(kind: string): T[] {
    const provider = this.itemStores.get(kind);
    if (!provider) return [];
    // node/edge providers return our cached arrays — hand them out directly.
    // Other kinds keep the defensive copy (their stores are externally owned).
    return (kind === 'node' || kind === 'edge') ? provider() as T[] : [...provider()] as T[];
  }

  getItem<T = unknown>(ref: ItemRef): T | undefined {
    // node/edge are id-keyed Maps with no embedded parent, so an id hit is the
    // match — O(1) instead of the former linear scan (the #1 bench hot path).
    if (ref.kind === 'node') return this.items.get(ref.id) as T | undefined;
    if (ref.kind === 'edge') return this.edgeMap.get(ref.id) as T | undefined;
    return this.itemsOfKind<T & StoredItem>(ref.kind).find(item => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as StoredItem;
      if (candidate.id !== ref.id) return false;
      // ItemRef.parent is hierarchy hint — useful when an item kind stores its
      // own parent chain (e.g. ids could collide across scopes). When the item
      // doesn't carry an embedded parent (containers track parenthood in the
      // hierarchy provider, not on the data), the ref's parent is informational
      // only and matching ignores it.
      if (candidate.parent == null) return true;
      return parentKey(candidate.parent) === parentKey(ref.parent);
    }) as T | undefined;
  }

  // ----- Edges -----
  createEdge(draft: EdgeDraft) {
    const id = `r${this.nextEdge++}`;             // 'r' = relation, to keep ids distinct from nodes (e1, e2, ...).
    const edge = new GraphEdge(this, id, draft);
    this.edgeMap.set(id, edge);
    this.addAdj(edge);
    this.edgeArr = null;
    return edge;
  }
  getEdge(id: Id) { return this.edgeMap.get(id); }
  edges() { return this.edgeArr ??= [...this.edgeMap.values()]; }
  edgesOf(nodeId: Id) {
    const ids = this.adjacency.get(nodeId);
    if (!ids) return [];
    const out: GraphEdge[] = [];
    ids.forEach(eid => { const e = this.edgeMap.get(eid); if (e) out.push(e); });
    return out;
  }
  updateEdge(id: Id, patch: EdgePatch) {
    const edge = this.edgeMap.get(id); if (!edge) return false;
    // From/To re-points the edge → its adjacency entries must move with it.
    const reindex = 'From' in patch || 'To' in patch;
    if (reindex) this.removeAdj(edge);
    Object.assign(edge, patch);
    if (reindex) this.addAdj(edge);
    return true;
  }
  deleteEdge(id: Id) {
    const edge = this.edgeMap.get(id);
    if (!edge) return false;
    this.removeAdj(edge);
    this.edgeMap.delete(id);
    this.edgeArr = null;
    return true;
  }

  getNode(id: Id) { return this.items.get(id); }
  /** Create-or-place-near. `nearPosition` is the caller's job — Graph stays unaware of selection. */
  createNode(draft: NodeDraft = {}, options: NodeCreateOptions & { nearPosition?: Position } = {}) {
    const id = `e${this.nextNode++}`;
    const node = new GraphNode(this, id, this.withDefaults(draft, options));
    this.items.set(id, node);
    this.indexNode(node);
    this.nodeArr = null;
    return node;
  }
  /** Backwards-compatible overload: `node(id)` reads, `node(draft, opts)` creates.
   *  Prefer `getNode` / `createNode` in new code. */
  node(draft?: NodeDraft, options?: NodeCreateOptions & { nearPosition?: Position }): GraphNode;
  node(id: Id): GraphNode | undefined;
  node(value: NodeDraft | Id = {}, options: NodeCreateOptions & { nearPosition?: Position } = {}) {
    if (typeof value === 'string') return this.items.get(value);
    return this.createNode(value, options);
  }
  nodes() { return this.nodeArr ??= [...this.items.values()]; }
  updateNode(id: Id, patch: NodePatch) {
    const node = this.items.get(id);
    if (!node) return false;
    // In-place mutation keeps the same object identity, so the cached nodes()
    // array stays valid — no invalidation needed.
    Object.assign(node, patch);
    if ('Position' in patch) this.indexNode(node); // moved → re-bucket
    return true;
  }
  deleteNode(id: Id) {
    // Cascade: any edge touching this node is dead too. Callers that need to react to
    // edge removal should subscribe to graph.edge.deleted, which the graph system emits.
    // O(degree) via the adjacency index instead of scanning every edge.
    const incident = this.adjacency.get(id);
    if (incident) {
      [...incident].forEach(eid => {
        const e = this.edgeMap.get(eid);
        if (e) { this.removeAdj(e); this.edgeMap.delete(eid); }
      });
      this.adjacency.delete(id);
      this.edgeArr = null;
    }
    const removed = this.items.delete(id);
    if (removed) { this.unindexNode(id); this.nodeArr = null; }
    return removed;
  }

  private withDefaults(draft: NodeDraft, options: NodeCreateOptions & { nearPosition?: Position }): NodeDraft {
    const anchor = options.nearPosition ?? options.at ?? { x: 0, y: 0 };
    const hasAnchor = options.nearPosition != null;
    const index = this.items.size;
    if (hasAnchor) {
      const row = index % 3;
      return {
        ...draft,
        Position: draft.Position ?? {
          x: anchor.x + 220,
          y: anchor.y + row * 100,
        },
      };
    }
    const cols = 3;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      ...draft,
      Position: draft.Position ?? {
        x: anchor.x + (col - (cols - 1) / 2) * 240,
        y: anchor.y + row * 100,
      },
    };
  }

  snapshot(): GraphSnapshot {
    return {
      nodes: this.nodes().map(({ id, Label, Position, Size, NodeType, Description, ComputeMs, ExpectedRps, LatencyMs, Purpose, Assumptions, Limits, WhatThen, Observability, FailureMode, DataScale, FreshnessMs }) => ({
        id, Label, Position, Size, NodeType, Description, ComputeMs, ExpectedRps, LatencyMs, Purpose, Assumptions, Limits, WhatThen, Observability, FailureMode, DataScale, FreshnessMs,
      })),
      edges: this.edges().map(({ id, From, To, Label, EdgeKind, LatencyMs, ThroughputRps, PayloadKb, Purpose, Assumptions, Limits, WhatThen, Observability, FailureMode, DataScale, FreshnessMs }) => ({
        id, From, To, Label, EdgeKind, LatencyMs, ThroughputRps, PayloadKb, Purpose, Assumptions, Limits, WhatThen, Observability, FailureMode, DataScale, FreshnessMs,
      })),
    };
  }

  replace(snapshot: GraphSnapshot) {
    this.items.clear();
    this.edgeMap.clear();
    this.adjacency.clear();
    this.grid.clear();
    this.nodeCell.clear();
    let maxNode = 0;
    let maxEdge = 0;
    snapshot.nodes.forEach(draft => {
      const node = new GraphNode(this, draft.id, draft);
      this.items.set(node.id, node);
      this.indexNode(node);
      const seq = parseInt(node.id.replace(/^\D+/, ''), 10);
      if (Number.isFinite(seq)) maxNode = Math.max(maxNode, seq);
    });
    snapshot.edges.forEach(draft => {
      if (!this.items.has(draft.From) || !this.items.has(draft.To) || draft.From === draft.To) return;
      const edge = new GraphEdge(this, draft.id, draft);
      this.edgeMap.set(edge.id, edge);
      this.addAdj(edge);
      const seq = parseInt(edge.id.replace(/^\D+/, ''), 10);
      if (Number.isFinite(seq)) maxEdge = Math.max(maxEdge, seq);
    });
    this.nextNode = maxNode + 1;
    this.nextEdge = maxEdge + 1;
    this.nodeArr = null;
    this.edgeArr = null;
  }
}

/** The multi-graph registry. A class (like Graph/GraphNode/GraphEdge) so the
 *  whole model layer is constructors, not object literals — one shape, stricter
 *  fields, and instance-property methods stay reassignable for instrumentation
 *  (installGraphPerf wraps create/switch per store). */
export class GraphStore {
  private next = 1;
  private graphs = new Map<Id, Graph>();
  private active: Graph;

  constructor() {
    this.active = this.create();
  }

  private nextId() {
    let id = `g${this.next++}`;
    while (this.graphs.has(id)) id = `g${this.next++}`;
    return id;
  }

  get current() { return this.active; }
  all() { return [...this.graphs.values()]; }
  get(id: Id) { return this.graphs.get(id); }

  /** Instance property (not prototype method) so perf wrapping can reassign it. */
  create = (id: Id = this.nextId()): Graph => {
    const existing = this.graphs.get(id);
    if (existing) return existing;
    const graph = Graph.new(id);
    this.graphs.set(id, graph);
    return graph;
  };

  delete(id: Id) {
    if (this.graphs.size <= 1) return this.active;
    this.graphs.delete(id);
    if (this.active.id === id) this.active = this.graphs.values().next().value ?? this.create();
    return this.active;
  }

  /** Instance property for the same reason as `create`. */
  switch = (id: Id): Graph => {
    this.active = this.graphs.get(id) ?? this.create(id);
    return this.active;
  };
}

export const graphStore = () => new GraphStore();
