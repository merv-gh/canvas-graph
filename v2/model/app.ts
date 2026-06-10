import type { EntityDef, ModelDef } from '../types';
import { appCollections, type AppModelCtx } from './collections';

/** Empty entity seed — entities are registered by their owning systems via
 *  `ctx.model.registerEntity`. The graph system contributes node/edge/graph;
 *  containers system contributes container; future kinds plug in the same way.
 *  Collections still seed here because they're declarations of "what lists
 *  exist on the model", not domain stores. */
export const appModel: ModelDef<AppModelCtx> = {
  entities: [] as EntityDef<unknown, unknown>[],
  collections: appCollections,
};

export type AppModel = typeof appModel;
export type { AppModelCtx };
