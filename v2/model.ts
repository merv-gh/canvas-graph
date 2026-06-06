import { collapsible, configurable, draggable, editable, selectable } from './abilities';
import type {
  CollectionDef,
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

export class Graph {
  static new(id: Id) { return new Graph(id); }

  selected: Id | null = null;
  focused: Id | null = null;
  private nextNode = 1;
  private items = new Map<Id, GraphNode>();

  private constructor(readonly id: Id) {}

  node(draft?: NodeDraft, options?: NodeCreateOptions): GraphNode;
  node(id: Id): GraphNode | undefined;
  node(value: NodeDraft | Id = {}, options: NodeCreateOptions = {}) {
    if (typeof value === 'string') return this.items.get(value);
    const id = `e${this.nextNode++}`;
    const node = new GraphNode(this, id, this.withDefaults(value, options));
    this.items.set(id, node);
    return node;
  }

  nodes() { return [...this.items.values()]; }
  selectedNode() { return this.selected ? this.node(this.selected) : undefined; }
  createNode(draft: NodeDraft = {}, options: NodeCreateOptions = {}) { return this.node(draft, options).id; }
  updateNode(id: Id, patch: NodePatch) {
    const node = this.node(id);
    if (!node) return false;
    Object.assign(node, patch);
    return true;
  }
  deleteNode(id: Id) {
    const deleted = this.items.delete(id);
    if (this.selected === id) this.selected = null;
    if (this.focused === id) this.focused = null;
    return deleted;
  }

  private withDefaults(draft: NodeDraft, options: NodeCreateOptions): NodeDraft {
    const nearId = options.near ?? this.selected;
    const selected = options.near === null || !nearId ? undefined : this.node(nearId);
    const anchor = selected?.Position ?? options.at ?? { x: 0, y: 0 };
    const spread = this.items.size % 4;
    return {
      ...draft,
      Position: draft.Position ?? {
        x: anchor.x + (selected ? 180 : spread * 24),
        y: anchor.y + (selected ? 0 : (this.items.size % 3) * 18),
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

export const nodeEntity = entity<GraphNode, NodePatch>('node', {
  label: 'Node',
  labelOf: node => node.Label.text,
  abilities: [selectable<GraphNode>(), draggable<GraphNode>(), collapsible<GraphNode>(), editable<GraphNode>(), configurable<GraphNode>()],
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
  entities: [nodeEntity as EntityDef<unknown>],
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
  ],
} satisfies ModelDef<ModelCtx>;
