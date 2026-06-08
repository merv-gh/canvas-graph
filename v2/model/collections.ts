import { itemIdFrom, type CollectionCommandsApi } from '../core';
import type {
  CollectionDef,
  CommandSource,
  EdgePatch,
  EntityDef,
  Id,
  ModelDef,
  NodePatch,
} from '../types';
import { edgeEntity, nodeEntity } from './entities';
import { Graph, GraphEdge, GraphNode, graphStore } from './graph';

type ModelCtx = { graphs: ReturnType<typeof graphStore> };
type ModelCollectionDef<T> = CollectionDef<T, ModelCtx, CollectionCommandsApi>;
const collection = <T,>(id: string, def: Omit<ModelCollectionDef<T>, 'id'>): ModelCollectionDef<T> => ({ id, ...def });

const nextGraphId = (graphs: ReturnType<typeof graphStore>) =>
  graphs.all().find(g => g.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

/** Resolve a target id for a node-targeted command — prefers explicit interaction
 *  source (clicked row), falls back to current selection. */
const nodeIdFromSource = (api: CollectionCommandsApi) => (source: CommandSource) =>
  itemIdFrom(source.target) || api.selection.selectedNode()?.id || '';

export const appModel: ModelDef<ModelCtx, CollectionCommandsApi> = {
  entities: [nodeEntity as EntityDef<unknown, NodePatch>, edgeEntity as EntityDef<unknown, EdgePatch>],
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
        /** When a node is already selected, A creates a child of it and wires the
         *  edge in one keystroke; the new node becomes the selection so further
         *  A keystrokes build a chain. Shift+A does the same but keeps the
         *  selection on the source — sequence builders use it to fan out
         *  multiple children from a single anchor without re-selecting. */
        const attachedDraft = (keepFocus: boolean) => {
          const selected = api.selection.selectedNode();
          const base = { Label: { text: `Node ${api.graphs.current.nodes().length + 1}` } };
          if (!selected) return base;
          return { ...base, relativeTo: selected.id, connectFrom: selected.id, ...(keepFocus ? { keepFocus: true } : {}) };
        };
        return [
          {
            id: 'editing.node.create',
            label: 'Create node',
            event: 'editing.node.create',
            group: 'editing',
            shortcut: 'A',
            input: { on: 'keydown', key: 'a', prevent: true },
            payload: () => attachedDraft(false),
          },
          {
            id: 'editing.node.create.keep',
            label: 'Create attached node (keep selection)',
            event: 'editing.node.create',
            group: 'editing',
            shortcut: 'Shift+A',
            input: { on: 'keydown', key: 'A', shift: true, prevent: true },
            available: () => !!api.selection.selectedNode(),
            payload: () => attachedDraft(true),
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
      itemLabel: edge => edge.Label?.text ?? `${edge.From} -> ${edge.To}`,
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
        return [
          {
            id: 'graph.edge.create',
            label: 'Create edge',
            event: 'editing.edge.create',
            group: 'edge',
            shortcut: 'E',
            input: { on: 'keydown', key: 'e', prevent: true },
            // No `available` filter: the picker itself emits an app.notice when
            // a step has no candidates (e.g. zero/one nodes). Keeps the
            // command discoverable from the palette and the failure mode
            // observable in the event log.
            picker: {
              title: 'Create edge',
              steps: [
                {
                  id: 'From',
                  prompt: 'Pick source node',
                  filter: () => ref => ref.kind === 'node',
                  // Fast path: when a node is already selected it becomes From
                  // and the user only has to pick To. Edge in 2 keystrokes.
                  seed: () => {
                    const ref = selection.selected();
                    return ref?.kind === 'node' ? ref : null;
                  },
                },
                {
                  id: 'To',
                  prompt: 'Pick target node',
                  filter: (values) => ref => ref.kind === 'node' && ref.id !== values.From?.id,
                },
              ],
              validate: (values) => {
                if (graphs.current.nodes().length < 2) return 'Create at least two nodes before creating an edge.';
                if (!values.From || !values.To) return 'Pick both source and target.';
                if (values.From.id === values.To.id) return 'Source and target must be different nodes.';
                return undefined;
              },
              payload: (values) => ({ From: values.From?.id ?? '', To: values.To?.id ?? '' }),
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

export type AppModelCtx = ModelCtx;
export type AppModel = typeof appModel;
export type AppEntityId = Id;
