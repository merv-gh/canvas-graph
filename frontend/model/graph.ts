import type { Id, ItemRef, Label, Position, Size } from '../types';

// ----- Domain types -----
// Live here, next to the classes implementing them. Anything kind-specific
// (node, edge, future container) belongs in the model layer, not in types.ts.
export type Entity = { id: Id; kind: string; Label: Label; Size: Size; Position?: Position };

export type NodeType = 'text' | 'square' | 'circle';
export type NodeEntity = Entity & { kind: 'node'; NodeType: NodeType; Description?: string };
export type NodeDraft = { Label?: Label; Position?: Position; Size?: Size; NodeType?: NodeType; Description?: string };
export type NodePatch = Partial<Pick<NodeEntity, 'Label' | 'Size' | 'Position' | 'NodeType' | 'Description'>>;
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
};

export type EdgeEntity = { id: Id; kind: 'edge'; From: Id; To: Id; Label?: Label };
export type EdgeDraft = { From: Id; To: Id; Label?: Label };
export type EdgeCreateDraft = Partial<EdgeDraft>;
export type EdgePatch = Partial<Pick<EdgeEntity, 'Label' | 'From' | 'To'>>;

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

  constructor(readonly graph: Graph, readonly id: Id, draft: NodeDraft = {}) {
    this.Label = draft.Label ?? { text: id };
    this.Size = draft.Size ?? { w: 150, h: 64 };
    this.Position = draft.Position;
    this.NodeType = draft.NodeType ?? 'text';
    this.Description = draft.Description ?? '';
  }
}

export class GraphEdge implements EdgeEntity {
  kind = 'edge' as const;
  Label?: Label;
  constructor(readonly graph: Graph, readonly id: Id, public From: Id, public To: Id, label?: Label) {
    this.Label = label;
  }
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
    const edge = new GraphEdge(this, id, draft.From, draft.To, draft.Label);
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
    if (removed) this.nodeArr = null;
    return removed;
  }

  private withDefaults(draft: NodeDraft, options: NodeCreateOptions & { nearPosition?: Position }): NodeDraft {
    const anchor = options.nearPosition ?? options.at ?? { x: 0, y: 0 };
    const hasAnchor = options.nearPosition != null;
    const spread = this.items.size % 4;
    return {
      ...draft,
      Position: draft.Position ?? {
        x: anchor.x + (hasAnchor ? 180 : spread * 24),
        y: anchor.y + (hasAnchor ? 0 : (this.items.size % 3) * 18),
      },
    };
  }
}

export function graphStore() {
  let next = 1;
  const graphs = new Map<Id, Graph>();
  const nextId = () => {
    let id = `g${next++}`;
    while (graphs.has(id)) id = `g${next++}`;
    return id;
  };
  const create = (id: Id = nextId()) => {
    const existing = graphs.get(id);
    if (existing) return existing;
    const graph = Graph.new(id);
    graphs.set(id, graph);
    return graph;
  };
  let current = create();
  return {
    get current() { return current; },
    all: () => [...graphs.values()],
    get: (id: Id) => graphs.get(id),
    create,
    delete(id: Id) {
      if (graphs.size <= 1) return current;
      graphs.delete(id);
      if (current.id === id) current = graphs.values().next().value ?? create();
      return current;
    },
    switch(id: Id) {
      current = graphs.get(id) ?? create(id);
      return current;
    },
  };
}
export type GraphStore = ReturnType<typeof graphStore>;
