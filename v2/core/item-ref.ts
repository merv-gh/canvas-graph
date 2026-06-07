import type { Id, ItemRef } from '../types';

export const itemKey = (ref: ItemRef) => JSON.stringify([ref.parent ?? [], ref.kind, ref.id]);

export const sameItemRef = (a: ItemRef | null | undefined, b: ItemRef | null | undefined) =>
  a === b || (!!a && !!b && itemKey(a) === itemKey(b));

export const nodeRef = (id: Id): ItemRef => ({ kind: 'node', id });

export const edgeRef = (id: Id): ItemRef => ({ kind: 'edge', id });

