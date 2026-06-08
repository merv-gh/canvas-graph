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
  const entities = new Map<string, EntityDef<unknown, unknown>>();
  const collections = new Map<string, ResolvedCollectionDef<unknown, unknown>>();
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
  const registerEntity = <T, Patch = unknown>(entityDef: EntityDef<T, Patch>) => {
    entities.set(entityDef.kind, entityDef as EntityDef<unknown, unknown>);
    return () => { if (entities.get(entityDef.kind) === entityDef as unknown) entities.delete(entityDef.kind); };
  };
  const registerCollection = <T,>(collectionDef: CollectionDef<T, Ctx>) => {
    const resolved = resolveCollection(collectionDef);
    collections.set(resolved.id, resolved as unknown as ResolvedCollectionDef<unknown, unknown>);
    return () => { if (collections.get(resolved.id) === resolved as unknown) collections.delete(resolved.id); };
  };
  // Seed from the initial ModelDef. After boot, systems can keep adding via
  // registerEntity / registerCollection — container, group, region, layer, …
  model.entities.forEach(entityDef => registerEntity(entityDef));
  model.collections.forEach(collectionDef => registerCollection(collectionDef));
  // Disabled abilities disappear from the live model — render, palette, and DX all stop seeing them.
  const filterAbilities = <T,>(entityDef: EntityDef<T>): EntityDef<T> => {
    if (!flags) return entityDef;
    const liveAbilities = entityDef.abilities.filter(ability => flags.isOn(`ability.${ability.id}`));
    return liveAbilities.length === entityDef.abilities.length ? entityDef : { ...entityDef, abilities: liveAbilities };
  };
  const ordered = () => [...entities.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    entity<T, Patch = unknown>(kind: string) {
      const entityDef = entities.get(kind) as EntityDef<T, Patch> | undefined;
      return entityDef ? filterAbilities(entityDef) as EntityDef<T, Patch> : undefined;
    },
    collection<T>(id: string) { return collections.get(id) as ResolvedCollectionDef<T, unknown> | undefined; },
    /** Live entities, ordered by `EntityDef.order` (lower first = paints behind). */
    entities: () => ordered().map(e => filterAbilities(e)),
    collections: () => [...collections.values()],
    /** Raw, unfiltered, ordered — DX validator uses this to compare declared vs live. */
    rawEntities: () => ordered(),
    /** Add an entity at runtime. Returns a teardown that removes it. */
    registerEntity,
    /** Add a collection at runtime. Returns a teardown that removes it. */
    registerCollection,
  };
};
