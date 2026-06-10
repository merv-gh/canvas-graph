import {
  Graph,
  GraphEdge,
  type CreateHints,
  type EdgeDraft,
  type EdgeEntity,
  type EdgePatch,
  type GraphNode,
  type GraphStore,
  type NodeDraft,
  type NodeEntity,
  type NodePatch,
} from '../model';
import { clamp, edgeRef, itemIdFrom, nodeRef, type Registry } from '../core';
import {
  collapsible,
  configurable,
  draggable,
  editable,
  nudgeable,
  selectable,
} from '../abilities';
import { Places } from '../types';
import type {
  EntityDef,
  EntityRenderer,
  Id,
  PropertyDef,
  Rect,
} from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
};

const property = <T, Patch>(def: PropertyDef<T, Patch>) => def;
const entityDef = <T, Patch = unknown>(kind: string, def: Omit<EntityDef<T, Patch>, 'kind'>): EntityDef<T, Patch> => ({ kind, ...def });

const graphEntity: EntityDef<Graph> = entityDef<Graph>('graph', {
  label: 'Graph',
  labelOf: graph => graph.id,
  abilities: [],
});

const edgeRenderer: EntityRenderer<GraphEdge> = {
  layer: 'svg',
  draw(edge, ctx) {
    const from = ctx.graph.getItem({ kind: 'node', id: edge.From }) as NodeEntity | undefined;
    const to = ctx.graph.getItem({ kind: 'node', id: edge.To }) as NodeEntity | undefined;
    if (!from?.Position || !to?.Position) return null;
    const ref = ctx.refOf(edge.id);
    const g = svg('g', {});
    g.setAttribute('class', 'edge');
    const line = (className: string, extra: Record<string, string | number> = {}) => {
      const el = svg('line', {
        x1: from.Position!.x, y1: from.Position!.y, x2: to.Position!.x, y2: to.Position!.y,
        class: className, ...extra,
      });
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

const edgeEntity: EntityDef<GraphEdge, EdgePatch> = entityDef<GraphEdge, EdgePatch>('edge', {
  label: 'Edge',
  labelOf: edge => edge.Label?.text ?? `${edge.From}->${edge.To}`,
  abilities: [],
  render: edgeRenderer,
  properties: [
    property<GraphEdge, EdgePatch>({
      id: 'label', label: 'Label', input: 'text',
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
    const ref = ctx.refOf(node.id);
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

const nodeEntity: EntityDef<GraphNode, NodePatch> = entityDef<GraphNode, NodePatch>('node', {
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
      id: 'title', label: 'Title', input: 'text',
      value: node => node.Label.text,
      patch: (_node, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphNode, NodePatch>({
      id: 'width', label: 'Width', input: 'number', min: 96, step: 8,
      value: node => node.Size.w,
      patch: (node, value) => {
        const width = Number(value);
        return Number.isFinite(width) ? { Size: { ...node.Size, w: clamp(width, 96, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'height', label: 'Height', input: 'number', min: 40, step: 8,
      value: node => node.Size.h,
      patch: (node, value) => {
        const height = Number(value);
        return Number.isFinite(height) ? { Size: { ...node.Size, h: clamp(height, 40, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'collapsed', label: 'Collapsed', input: 'checkbox',
      value: node => !!node.Collapsed,
      patch: (_node, value) => ({ Collapsed: !!value }),
    }),
  ],
});

export { graphEntity, edgeEntity, nodeEntity, nodeBoundsOf };

declare module '../types' {
  interface CustomEvents {
    'graph.create': void;
    'graph.created': { id: Id };
    'graph.delete': { id: Id };
    'graph.deleted': { id: Id; nextId: Id };
    'graph.switch': { id: Id };
    'graph.switched': { id: Id };
    'graph.node.create': NodeDraft & CreateHints;
    'graph.node.created': { graphId: Id; id: Id; hints?: CreateHints };
    'graph.node.update': { id: Id; patch: NodePatch };
    'graph.node.updated': { graphId: Id; id: Id };
    'graph.node.delete': { id: Id };
    'graph.node.deleted': { graphId: Id; id: Id };
    'graph.edge.create': EdgeDraft;
    'graph.edge.created': { graphId: Id; id: Id; edge: EdgeEntity };
    'graph.edge.update': { id: Id; patch: EdgePatch };
    'graph.edge.updated': { graphId: Id; id: Id };
    'graph.edge.delete': { id: Id };
    'graph.edge.deleted': { graphId: Id; id: Id };
  }
}

const nextGraphId = (graphs: GraphStore) =>
  graphs.all().find(g => g.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

export function registerGraph(system: Registry) {
  system('graph', ({ on, emit, graphs, contexts, selection, origin, model }) => {
    const offGraph = model.registerEntity(graphEntity as EntityDef<unknown, unknown>);
    const offNode = model.registerEntity(nodeEntity as EntityDef<unknown, unknown>);
    const offEdge = model.registerEntity(edgeEntity as EntityDef<unknown, unknown>);
    contexts.storage.register('node', origin, (ref, patch) => {
      if (graphs.current.updateNode(ref.id, patch as NodePatch)) {
        emit('graph.node.updated', { graphId: graphs.current.id, id: ref.id });
      }
    });
    contexts.storage.register('edge', origin, (ref, patch) => {
      if (graphs.current.updateEdge(ref.id, patch as EdgePatch)) {
        emit('graph.edge.updated', { graphId: graphs.current.id, id: ref.id });
      }
    });
    const selectedEdgeId = () => {
      const ref = selection.selected();
      return ref?.kind === 'edge' ? ref.id : '';
    };

    contexts.commands.register([
      {
        id: 'graph.create',
        label: 'Create graph',
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
        id: 'graph.switch',
        label: 'Switch graph',
        group: 'graph',
        hidden: true,
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
      },
      {
        id: 'graph.delete',
        label: 'Delete graph',
        group: 'graph',
        available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.id }),
      },
      {
        id: 'graph.node.delete',
        label: 'Delete node',
        group: 'graph',
        available: source => !!itemIdFrom(source?.target) || !!selection.selectedNode(),
        payload: source => ({ id: itemIdFrom(source.target) || selection.selectedNode()?.id || '' }),
      },
      {
        id: 'graph.edge.delete',
        label: 'Delete edge',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target) || !!selectedEdgeId(),
        payload: source => ({ id: itemIdFrom(source.target) || selectedEdgeId() }),
      },
    ]);

    on('graph.create', () => {
      const graph = graphs.create();
      graphs.switch(graph.id);
      emit('graph.created', { id: graph.id });
      emit('graph.switched', { id: graph.id });
    });
    on('graph.switch', ({ id }) => {
      const graph = graphs.switch(id);
      emit('graph.switched', { id: graph.id });
    });
    on('graph.node.create', draft => {
      const { relativeTo, keepFocus, connectFrom, ...store } = draft as typeof draft & { relativeTo?: string; keepFocus?: boolean; connectFrom?: string };
      const anchorNode = relativeTo ? graphs.current.getNode(relativeTo) : (selection.selectedNode() as GraphNode | undefined);
      const node = graphs.current.createNode(store, {
        at: contexts.view.spaceCenter(Places.Stage),
        nearPosition: anchorNode?.Position,
      });
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id, hints: { keepFocus, connectFrom, relativeTo } });
    });
    on('graph.node.update', ({ id, patch }) => {
      if (graphs.current.updateNode(id, patch)) emit('graph.node.updated', { graphId: graphs.current.id, id });
    });
    on('graph.node.delete', ({ id }) => {
      const incident = graphs.current.edgesOf(id).map(e => e.id);
      if (graphs.current.deleteNode(id)) {
        incident.forEach(eid => emit('graph.edge.deleted', { graphId: graphs.current.id, id: eid }));
        emit('graph.node.deleted', { graphId: graphs.current.id, id });
      }
    });
    on('graph.edge.create', draft => {
      if (!draft.From || !draft.To || draft.From === draft.To) return;
      if (!graphs.current.getNode(draft.From) || !graphs.current.getNode(draft.To)) return;
      const edge = graphs.current.createEdge(draft);
      emit('graph.edge.created', { graphId: graphs.current.id, id: edge.id, edge });
    });
    on('graph.edge.update', ({ id, patch }) => {
      if (graphs.current.updateEdge(id, patch)) emit('graph.edge.updated', { graphId: graphs.current.id, id });
    });
    on('graph.edge.delete', ({ id }) => {
      if (graphs.current.deleteEdge(id)) emit('graph.edge.deleted', { graphId: graphs.current.id, id });
    });
    on('graph.delete', ({ id }) => {
      const next = graphs.delete(id);
      emit('graph.deleted', { id, nextId: next.id });
      emit('graph.switched', { id: next.id });
    });
    const offTargets = contexts.itemTargets.register(origin, () => {
      const nodes = graphs.current.nodes().map(node => ({
        ref: nodeRef(node.id),
        label: node.Label.text || node.id,
        anchor: node.Position ?? { x: 0, y: 0 },
      }));
      const edges = graphs.current.edges().flatMap(edge => {
        const from = graphs.current.getNode(edge.From);
        const to = graphs.current.getNode(edge.To);
        if (!from?.Position || !to?.Position) return [];
        return [{
          ref: edgeRef(edge.id),
          label: edge.Label?.text || `${from.Label.text} to ${to.Label.text}`,
          anchor: {
            x: (from.Position.x + to.Position.x) / 2,
            y: (from.Position.y + to.Position.y) / 2,
          },
        }];
      });
      return [...nodes, ...edges];
    });
    return () => { offGraph(); offNode(); offEdge(); offTargets(); };
  });
}
