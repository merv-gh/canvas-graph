import type { CollectionDef, Id } from '../types';
import type { EdgeEntity, Graph, GraphStore, NodeEntity } from './graph';

type Identified = { id: Id };
export type AppModelCtx = { graphs: GraphStore };

const collection = <T extends Identified>(def: CollectionDef<T, AppModelCtx>) =>
  def as CollectionDef<unknown, AppModelCtx>;

export const appCollections = [
  collection<Graph>({
    id: 'graphs',
    label: 'Graphs',
    kind: 'graph',
    items: ctx => ctx.graphs.all(),
    // Graph creation is a rare workspace action. Keep it in commands and
    // shortcuts, not in the persistent canvas tool panel.
    toolbar: false,
  }),
  collection<NodeEntity>({
    id: 'nodes',
    label: 'Nodes',
    kind: 'node',
    items: ctx => ctx.graphs.current.nodes(),
    // Palette owns the pointer Add Node mode because it carries the active
    // catalog type/style. Keyboard A remains the collection create command.
    toolbar: false,
  }),
  collection<EdgeEntity>({
    id: 'edges',
    label: 'Edges',
    kind: 'edge',
    items: ctx => ctx.graphs.current.edges(),
    toolbar: { text: 'Connect', icon: 'connect', order: 15 },
  }),
];
