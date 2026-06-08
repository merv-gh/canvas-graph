import type { EntityDef, ModelDef } from '../types';
import { appCollections, type AppModelCtx } from './collections';
import { edgeEntity, graphEntity, nodeEntity } from './entities';

export const appModel: ModelDef<AppModelCtx> = {
  entities: [graphEntity, nodeEntity, edgeEntity] as EntityDef<unknown, unknown>[],
  collections: appCollections,
};

export type AppModel = typeof appModel;
export type { AppModelCtx };
