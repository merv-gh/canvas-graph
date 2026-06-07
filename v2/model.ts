import { collapsible, configurable, draggable, editable, nudgeable, selectable } from './abilities';
import { clamp, itemIdFrom, type CollectionCommandsApi } from './core';
import type {
  CollectionDef,
  CommandSource,
  EdgeCreateDraft,
  EdgeDraft,
  EdgeEntity,
  EdgePatch,
  EntityDef,
  EntityRenderer,
  Id,
  ItemKind,
  ItemRef,
  Label,
  ModelDef,
  NodeCreateOptions,
  NodeDraft,
  NodeEntity,
  NodePatch,
  Position,
  PropertyDef,
  Rect,
  Size,
} from './types';
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
  getItem(ref: ItemRef) {
    if (ref.kind === 'node') return this.getNode(ref.id);
    if (ref.kind === 'edge') return this.getEdge(ref.id);
    return undefined;
  }
  edges() { return [...this.edgeMap.values()]; }
  edgesOf(nodeId: Id) { return this.edges().filter(e => e.From === nodeId || e.To === nodeId); }
  updateEdge(id: Id, patch: EdgePatch) {
    const edge = this.edgeMap.get(id); if (!edge) return false;
    Object.assign(edge, patch);
    return true;
  }
  deleteEdge(id: Id) { return this.edgeMap.delete(id); }

  itemsOfKind(kind: ItemKind): (GraphNode | GraphEdge | Graph)[] {
    if (kind === 'node') return this.nodes();
    if (kind === 'edge') return this.edges();
    return [];
  }
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
type ModelCollectionDef<T> = CollectionDef<T, ModelCtx, CollectionCommandsApi>;
const collection = <T,>(id: string, def: Omit<ModelCollectionDef<T>, 'id'>): ModelCollectionDef<T> => ({ id, ...def });

const nextGraphId = (graphs: ReturnType<typeof graphStore>) =>
  graphs.all().find(g => g.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

const SVG_NS = 'http://www.w3.org/2000/svg';

const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
};

const edgeRenderer: EntityRenderer<GraphEdge> = {
  layer: 'svg',
  draw(edge, ctx) {
    const from = ctx.graph.getNode(edge.From);
    const to = ctx.graph.getNode(edge.To);
    if (!from?.Position || !to?.Position) return null;
    const ref: ItemRef = { kind: 'edge', id: edge.id };
    const g = svg('g', {});
    g.setAttribute('class', 'edge');
    (g as unknown as HTMLElement).dataset.edgeId = edge.id;
    const line = (className: string, extra: Record<string, string | number> = {}) => {
      const el = svg('line', {
        x1: from.Position!.x, y1: from.Position!.y, x2: to.Position!.x, y2: to.Position!.y,
        class: className, ...extra,
      });
      (el as unknown as HTMLElement).dataset.edgeId = edge.id;
      ctx.tagItem(el, ref);
      ctx.applyItemModes(el, ref);
      return el;
    };
    g.append(line('edge-hit', { tabindex: -1 }));
    g.append(line('edge-line'));
    if (edge.Label?.text) {
      const text = svg('text', {
        class: 'edge-label',
        x: (from.Position.x + to.Position.x) / 2,
        y: (from.Position.y + to.Position.y) / 2 - 4,
        'text-anchor': 'middle',
      });
      text.textContent = edge.Label.text;
      g.append(text);
    }
    return g;
  },
};

// Edge entity: pure data + label property (configurable later). No abilities yet —
// edges don't carry their own affordances. When edges grow features (e.g., delete via X
// while selected), declare them as abilities here.
export const edgeEntity = entity<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text ?? `${edge.From}→${edge.To}`,
  abilities: [],
  render: edgeRenderer,
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

const nodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};

const nodeRenderer: EntityRenderer<GraphNode> = {
  layer: 'html',
  bounds: nodeBoundsOf,
  draw(node, ctx) {
    const el = ctx.cloneTemplate<HTMLElement>('node');
    const pos = node.Position ?? { x: 0, y: 0 };
    const ref: ItemRef = { kind: 'node', id: node.id };
    el.dataset.nodeId = node.id;
    ctx.tagItem(el, ref);
    el.tabIndex = -1;
    ctx.applyItemModes(el, ref);
    el.classList.toggle('collapsed', !!node.Collapsed);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${node.Size.w}px`;
    el.style.height = `${node.Size.h}px`;
    ctx.templateText(el, 'title', node.Label.text);
    ctx.templateText(el, 'meta', node.id);
    ctx.wireAffordances(el);
    return el;
  },
};

export const nodeEntity = entity<GraphNode, NodePatch>('node', {
  label: 'Node',
  labelOf: node => node.Label.text,
  render: nodeRenderer,
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

/** Resolve a target id for a node-targeted command — prefers explicit interaction
 *  source (clicked row), falls back to current selection. */
const nodeIdFromSource = (api: CollectionCommandsApi) => (source: CommandSource) =>
  itemIdFrom(source.target) || api.selection.selectedNode()?.id || '';

export const appModel: ModelDef<ModelCtx, CollectionCommandsApi> = {
  entities: [nodeEntity as EntityDef<unknown>, edgeEntity as EntityDef<unknown>],
  collections: [
    collection<Graph>('graphs', {
      label: 'Graphs',
      items: ctx => ctx.graphs.all(),
      itemId: graph => graph.id,
      itemLabel: graph => graph.id,
      selectCommand: 'graph.switch.item',
      crud: { create: 'graph.create', delete: 'graph.delete.current' },
      toolbar: { text: '+ Graph', order: 20 },
      search: true,
      order: 'created',
      commands: ({ graphs }) => [
        {
          id: 'graph.create',
          label: 'Create graph',
          event: 'graph.create',
          group: 'graph',
          shortcut: 'N',
          input: { on: 'keydown', key: 'n', prevent: true },
        },
        {
          id: 'graph.switch.next',
          label: 'Switch graph',
          event: 'graph.switch',
          group: 'graph',
          shortcut: 'G',
          input: { on: 'keydown', key: 'g', prevent: true },
          payload: () => ({ id: nextGraphId(graphs) }),
        },
        {
          id: 'graph.switch.item',
          label: 'Switch graph item',
          event: 'graph.switch',
          group: 'graph',
          hidden: true,
          payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
        },
        {
          id: 'graph.delete.current',
          label: 'Delete graph',
          event: 'graph.delete',
          group: 'graph',
          available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
          payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
        },
      ],
    }) as CollectionDef<unknown, ModelCtx, CollectionCommandsApi>,
    collection<GraphNode>('nodes', {
      label: 'Nodes',
      entity: nodeEntity,
      items: ctx => ctx.graphs.current.nodes(),
      itemId: node => node.id,
      itemLabel: node => node.Label.text,
      selectCommand: 'selection.node.select',
      crud: { create: 'editing.node.create', delete: 'graph.node.delete.selected' },
      toolbar: { text: '+ Node', order: 10 },
      search: true,
      order: 'created',
      commands: (api) => {
        const targetId = nodeIdFromSource(api);
        return [
          {
            id: 'editing.node.create',
            label: 'Create node',
            event: 'editing.node.create',
            group: 'editing',
            shortcut: 'A',
            input: { on: 'keydown', key: 'a', prevent: true },
            payload: () => ({ Label: { text: `Node ${api.graphs.current.nodes().length + 1}` } }),
          },
          {
            id: 'graph.node.delete.selected',
            label: 'Delete node',
            event: 'graph.node.delete',
            group: 'graph',
            available: source => !!itemIdFrom(source?.target) || !!api.selection.selectedNode(),
            payload: source => ({ id: targetId(source) }),
          },
        ];
      },
    }) as CollectionDef<unknown, ModelCtx, CollectionCommandsApi>,
    collection<GraphEdge>('edges', {
      label: 'Edges',
      entity: edgeEntity,
      items: ctx => ctx.graphs.current.edges(),
      itemId: edge => edge.id,
      itemLabel: edge => edge.Label?.text ?? `${edge.From} → ${edge.To}`,
      selectCommand: 'selection.item.select',
      crud: { create: 'graph.edge.create', delete: 'graph.edge.delete' },
      toolbar: { text: '+ Edge', order: 15 },
      search: true,
      order: 'created',
      commands: ({ graphs, selection }) => {
        const selectedEdgeId = () => {
          const ref = selection.selected();
          return ref?.kind === 'edge' ? ref.id : '';
        };
        const nodeRef = (source: CommandSource) => {
          const id = itemIdFrom(source.target);
          return id && graphs.current.getNode(id) ? id : '';
        };
        const nodeOptions = () => graphs.current.nodes().map(node => ({ value: node.id, label: `${node.id} · ${node.Label.text}` }));
        const edgeSeed = (source: CommandSource): EdgeCreateDraft => {
          const ids = graphs.current.nodes().map(node => node.id);
          const from = nodeRef(source) || selection.selectedNode()?.id || ids[0] || '';
          const others = ids.filter(id => id !== from);
          return { From: from, To: others[0] ?? '' };
        };
        const edgeFormValues = (payload: unknown) => {
          const seed = payload as EdgeCreateDraft | undefined;
          return { From: seed?.From ?? '', To: seed?.To ?? '' };
        };
        const edgeFormError = (values: Record<string, string>) => {
          if (graphs.current.nodes().length < 2) return 'Create at least two nodes before creating an edge.';
          if (!values.From || !values.To) return 'Choose source and target nodes.';
          if (values.From === values.To) return 'Source and target must be different nodes.';
          if (!graphs.current.getNode(values.From)) return `Unknown source node "${values.From}".`;
          if (!graphs.current.getNode(values.To)) return `Unknown target node "${values.To}".`;
          return undefined;
        };
        return [
          {
            id: 'graph.edge.create',
            label: 'Create edge',
            event: 'editing.edge.create',
            group: 'edge',
            shortcut: 'E',
            input: { on: 'keydown', key: 'e', prevent: true },
            payload: edgeSeed,
            form: {
              title: 'Create edge',
              submitLabel: 'Create edge',
              fields: [
                { id: 'From', label: 'Source node', placeholder: 'e1', autofocus: true, options: nodeOptions },
                { id: 'To', label: 'Target node', placeholder: 'e2', options: nodeOptions },
              ],
              seed: edgeFormValues,
              shouldOpen: () => true,
              validate: edgeFormError,
              payload: values => ({ From: values.From, To: values.To }),
            },
          },
          {
            id: 'graph.edge.delete',
            label: 'Delete edge',
            event: 'graph.edge.delete',
            group: 'edge',
            available: source => !!itemIdFrom(source?.target) || !!selectedEdgeId(),
            payload: source => ({ id: itemIdFrom(source.target) || selectedEdgeId() }),
          },
        ];
      },
    }) as CollectionDef<unknown, ModelCtx, CollectionCommandsApi>,
  ],
};
