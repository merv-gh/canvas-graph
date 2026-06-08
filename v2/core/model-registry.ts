import type {
  CollectionDef,
  EntityDef,
  Id,
  ModelDef,
  ResolvedCollectionDef,
} from '../types';
import { singular } from './collection-commands';
import type { FlagsApi } from './flags';

export type ModelRegistry = ReturnType<typeof createModelRegistry>;

export const createModelRegistry = <Ctx,>(model: ModelDef<Ctx>, flags?: FlagsApi) => {
  const entities = new Map(model.entities.map(entityDef => [entityDef.kind, entityDef]));
  const defaultItemId = <T,>(item: T): Id => {
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' ? id : '';
  };
  const resolveCollection = <T,>(collectionDef: CollectionDef<T, Ctx>): ResolvedCollectionDef<T, Ctx> => {
    const kind = collectionDef.kind ?? collectionDef.entity?.kind ?? singular(collectionDef.id);
    const entityDef = collectionDef.entity ?? entities.get(kind) as EntityDef<T> | undefined;
    const itemId = collectionDef.itemId ?? defaultItemId;
    return {
      ...collectionDef,
      kind,
      entity: entityDef,
      itemId,
      itemLabel: collectionDef.itemLabel ?? entityDef?.labelOf ?? itemId,
      search: collectionDef.search ?? true,
      order: collectionDef.order ?? 'created',
    };
  };
  const collections = new Map(model.collections.map(collectionDef => {
    const resolved = resolveCollection(collectionDef);
    return [resolved.id, resolved as unknown as ResolvedCollectionDef<unknown, unknown>];
  }));
  // Disabled abilities disappear from the live model — render, palette, and DX all stop seeing them.
  const filterAbilities = <T,>(entityDef: EntityDef<T>): EntityDef<T> => {
    if (!flags) return entityDef;
    const liveAbilities = entityDef.abilities.filter(ability => flags.isOn(`ability.${ability.id}`));
    return liveAbilities.length === entityDef.abilities.length ? entityDef : { ...entityDef, abilities: liveAbilities };
  };
  return {
    entity<T, Patch = unknown>(kind: string) {
      const entityDef = entities.get(kind) as EntityDef<T, Patch> | undefined;
      return entityDef ? filterAbilities(entityDef) as EntityDef<T, Patch> : undefined;
    },
    collection<T>(id: string) { return collections.get(id) as ResolvedCollectionDef<T, unknown> | undefined; },
    entities: () => [...entities.values()].map(e => filterAbilities(e)),
    collections: () => [...collections.values()],
    /** Raw, unfiltered access — DX validator uses this to compare declared vs live. */
    rawEntities: () => [...entities.values()],
  };
};
