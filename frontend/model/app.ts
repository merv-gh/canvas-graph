import type { ModelDef } from '../types';
import { appCollections, type AppModelCtx } from './collections';
import { builtinEntities } from './entities';

/** The built-in domain. Entities (graph / node / edge) are declared in
 *  `entities.ts`, collections in `collections.ts`. Behavior lives in systems.
 *  Plugin kinds (containers, future groups/regions) register themselves at boot
 *  via `ctx.model.registerEntity` from their own system file — the model seed is
 *  only the always-on built-ins. */
export const appModel: ModelDef<AppModelCtx> = {
  entities: builtinEntities,
  collections: appCollections,
};

export type AppModel = typeof appModel;
export type { AppModelCtx };
