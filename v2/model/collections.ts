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
    toolbar: { text: '+ Graph', order: 20 },
  }),
  collection<NodeEntity>({
    id: 'nodes',
    label: 'Nodes',
    kind: 'node',
    items: ctx => ctx.graphs.current.nodes(),
    toolbar: { text: '+ Node', order: 10 },
  }),
  collection<EdgeEntity>({
    id: 'edges',
    label: 'Edges',
    kind: 'edge',
    items: ctx => ctx.graphs.current.edges(),
    toolbar: { text: '+ Edge', order: 15 },
  }),
];
