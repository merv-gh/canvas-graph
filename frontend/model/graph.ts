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
    return [...(this.itemStores.get(kind)?.() ?? [])] as T[];
  }

  getItem<T = unknown>(ref: ItemRef): T | undefined {
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
    return edge;
  }
  getEdge(id: Id) { return this.edgeMap.get(id); }
  edges() { return [...this.edgeMap.values()]; }
  edgesOf(nodeId: Id) { return this.edges().filter(e => e.From === nodeId || e.To === nodeId); }
  updateEdge(id: Id, patch: EdgePatch) {
    const edge = this.edgeMap.get(id); if (!edge) return false;
    Object.assign(edge, patch);
    return true;
  }
  deleteEdge(id: Id) { return this.edgeMap.delete(id); }

  getNode(id: Id) { return this.items.get(id); }
  /** Create-or-place-near. `nearPosition` is the caller's job — Graph stays unaware of selection. */
  createNode(draft: NodeDraft = {}, options: NodeCreateOptions & { nearPosition?: Position } = {}) {
    const id = `e${this.nextNode++}`;
    const node = new GraphNode(this, id, this.withDefaults(draft, options));
    this.items.set(id, node);
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
  nodes() { return [...this.items.values()]; }
  updateNode(id: Id, patch: NodePatch) {
    const node = this.items.get(id);
    if (!node) return false;
    Object.assign(node, patch);
    return true;
  }
  deleteNode(id: Id) {
    // Cascade: any edge touching this node is dead too. Callers that need to react to
    // edge removal should subscribe to graph.edge.deleted, which the graph system emits.
    [...this.edgeMap.values()].forEach(e => { if (e.From === id || e.To === id) this.edgeMap.delete(e.id); });
    return this.items.delete(id);
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
