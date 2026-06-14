import type { Id, ItemRef, Renderable } from '../types';

/** Insert a Renderable (Node or factory) into a slot. */
export const appendRenderable = (slot: Element, view: Renderable) => {
  slot.append(typeof view === 'function' ? view() : view);
};

export const itemParentAttr = (parent?: Id[]) =>
  parent?.length ? JSON.stringify(parent) : '';

export const itemParentFromAttr = (value: string | null): Id[] | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : undefined;
  } catch { return undefined; }
};

export const tagItem = (el: Element, ref: ItemRef) => {
  el.setAttribute('data-item-kind', ref.kind);
  el.setAttribute('data-item-id', ref.id);
  const parent = itemParentAttr(ref.parent);
  if (parent) el.setAttribute('data-item-parent', parent);
  else el.removeAttribute('data-item-parent');
};

/** Closest item id from the canonical item-tagging attribute. */
export const itemIdFrom = (target?: Element | null) =>
  target?.closest('[data-item-id]')?.getAttribute('data-item-id') ?? '';

/** Closest ItemRef from a DOM target — reads `[data-item-kind][data-item-id]`. */
export const itemRefFrom = (target?: Element | null): ItemRef | null => {
  const item = target?.closest('[data-item-kind][data-item-id]');
  if (!item) return null;
  const kind = item.getAttribute('data-item-kind') as ItemRef['kind'] | null;
  const id = item.getAttribute('data-item-id');
  if (!kind || !id) return null;
  const parent = itemParentFromAttr(item.getAttribute('data-item-parent'));
  return parent ? { kind, id, parent } : { kind, id };
};
