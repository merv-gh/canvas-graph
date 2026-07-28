import type { EntityDef } from '../types';
import type { Graph } from './graph';
import { edgeEntity } from './edge-entity';
import { nodeEntity } from './node-entity';

export * from './entity-options';
export {
  EDGE_LABEL_AVOID_REACH,
  EDGE_LABEL_CHAR_WIDTH,
  EDGE_LABEL_FONT_SIZE,
  EDGE_LABEL_LINE_HEIGHT,
  edgeEntity,
  edgeLabelGeometry,
  edgeLabelRects,
  measureEdgeLabel,
} from './edge-entity';
export { nodeBoundsOf, nodeEntity } from './node-entity';

export const graphEntity: EntityDef<Graph> = {
  kind: 'graph',
  label: 'Graph',
  labelOf: graph => graph.name,
  abilities: [],
};

export const builtinEntities: EntityDef<unknown, unknown>[] = [
  graphEntity as EntityDef<unknown, unknown>,
  nodeEntity as EntityDef<unknown, unknown>,
  edgeEntity as EntityDef<unknown, unknown>,
];
