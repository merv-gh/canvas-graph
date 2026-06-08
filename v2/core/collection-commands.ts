import type { CollectionDef } from '../types';

export const singular = (id: string) => id.endsWith('s') ? id.slice(0, -1) : id;

export const collectionKind = (collection: Pick<CollectionDef<unknown>, 'id' | 'kind' | 'entity'>) =>
  collection.kind || collection.entity?.kind || singular(collection.id);

export const collectionCreateCommand = (collection: Pick<CollectionDef<unknown>, 'id' | 'kind' | 'entity'>) => {
  const kind = collectionKind(collection);
  return kind === 'graph' ? 'graph.create' : `editing.${kind}.create`;
};

export const collectionDeleteCommand = (collection: Pick<CollectionDef<unknown>, 'id' | 'kind' | 'entity'>) => {
  const kind = collectionKind(collection);
  return kind === 'graph' ? 'graph.delete' : `graph.${kind}.delete`;
};

export const collectionSelectCommand = (collection: Pick<CollectionDef<unknown>, 'id' | 'kind' | 'entity'>) => {
  const kind = collectionKind(collection);
  return kind === 'graph' ? 'graph.switch' : 'selection.item.select';
};
