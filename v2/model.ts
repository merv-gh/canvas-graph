import { collapsible, configurable, draggable, editable, nudgeable, selectable } from './abilities';
import type {
  CollectionDef,
  EdgeDraft,
  EdgeEntity,
  EdgePatch,
  EntityDef,
  Id,
  Label,
  ModelDef,
  NodeCreateOptions,
  NodeDraft,
  NodeEntity,
  NodePatch,
  Position,
  PropertyDef,
  Size,
} from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const property = <T, Patch>(def: PropertyDef<T, Patch>) => def;
const entity = <T, Patch = unknown>(kind: string, def: Omit<EntityDef<T, Patch>, 'kind'>): EntityDef<T, Patch> => ({ kind, ...def });

export class GraphNode implements NodeEntity {
  kind = 'node' as const;
  Label: Label;
  Size: Size;
  Position?: Position;
  Collapsed?: boolean;

  constructor(readonly graph: Graph, readonly id: Id, draft: NodeDraft = {}) {
    this.Label = draft.Label ?? { text: id };
    this.Size = draft.Size ?? { w: 150, h: 64 };
    this.Position = draft.Position;
    this.Collapsed = draft.Collapsed;
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

  private constructor(readonly id: Id) {}

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

type ModelCtx = { graphs: ReturnType<typeof graphStore> };
type ModelCollectionDef<T> = CollectionDef<T, ModelCtx>;
const collection = <T,>(id: string, def: Omit<ModelCollectionDef<T>, 'id'>): ModelCollectionDef<T> => ({ id, ...def });

// Edge entity: pure data + label property (configurable later). No abilities yet —
// edges don't carry their own affordances. When edges grow features (e.g., delete via X
// while selected), declare them as abilities here.
export const edgeEntity = entity<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text ?? `${edge.From}→${edge.To}`,
  abilities: [],
  properties: [
    property<GraphEdge, EdgePatch>({
      id: 'label',
      label: 'Label',
      input: 'text',
      value: edge => edge.Label?.text ?? '',
      patch: (_edge, value) => ({ Label: { text: String(value) } }),
    }),
  ],
});

export const nodeEntity = entity<GraphNode, NodePatch>('node', {
  label: 'Node',
  labelOf: node => node.Label.text,
  abilities: [
    selectable<GraphNode>(),
    draggable<GraphNode>(),
    nudgeable<GraphNode>(),
    collapsible<GraphNode>(),
    editable<GraphNode>(),
    configurable<GraphNode>(),
  ],
  properties: [
    property<GraphNode, NodePatch>({
      id: 'title',
      label: 'Title',
      input: 'text',
      value: node => node.Label.text,
      patch: (_node, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphNode, NodePatch>({
      id: 'width',
      label: 'Width',
      input: 'number',
      min: 96,
      step: 8,
      value: node => node.Size.w,
      patch: (node, value) => {
        const width = Number(value);
        return Number.isFinite(width) ? { Size: { ...node.Size, w: clamp(width, 96, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'height',
      label: 'Height',
      input: 'number',
      min: 40,
      step: 8,
      value: node => node.Size.h,
      patch: (node, value) => {
        const height = Number(value);
        return Number.isFinite(height) ? { Size: { ...node.Size, h: clamp(height, 40, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'collapsed',
      label: 'Collapsed',
      input: 'checkbox',
      value: node => !!node.Collapsed,
      patch: (_node, value) => ({ Collapsed: !!value }),
    }),
  ],
});

export const appModel = {
  entities: [nodeEntity as EntityDef<unknown>, edgeEntity as EntityDef<unknown>],
  collections: [
    collection<Graph>('graphs', {
      label: 'Graphs',
      items: ctx => ctx.graphs.all(),
      itemId: graph => graph.id,
      itemLabel: graph => graph.id,
      selectCommand: 'graph.switch.item',
      crud: { create: 'graph.create', delete: 'graph.delete.current' },
      search: true,
      order: 'created',
    }) as CollectionDef<unknown, ModelCtx>,
    collection<GraphNode>('nodes', {
      label: 'Nodes',
      entity: nodeEntity,
      items: ctx => ctx.graphs.current.nodes(),
      itemId: node => node.id,
      itemLabel: node => node.Label.text,
      selectCommand: 'selection.node.select',
      crud: { create: 'editing.node.create', delete: 'graph.node.delete.selected' },
      search: true,
      order: 'created',
    }) as CollectionDef<unknown, ModelCtx>,
    collection<GraphEdge>('edges', {
      label: 'Edges',
      entity: edgeEntity,
      items: ctx => ctx.graphs.current.edges(),
      itemId: edge => edge.id,
      itemLabel: edge => edge.Label?.text ?? `${edge.From} → ${edge.To}`,
      crud: { create: 'graph.edge.create', delete: 'graph.edge.delete.selected' },
      search: true,
      order: 'created',
    }) as CollectionDef<unknown, ModelCtx>,
  ],
} satisfies ModelDef<ModelCtx>;
