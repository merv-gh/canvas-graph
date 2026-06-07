import type { ItemRef, Renderable } from '../types';

/** Insert a Renderable (string, Node, or factory) into a slot. */
export const appendRenderable = (slot: Element, view: Renderable) => {
  const value = typeof view === 'function' ? view() : view;
  if (typeof value === 'string') slot.insertAdjacentHTML('beforeend', value);
  else slot.append(value);
};

/** Closest item id from any of the common item-tagging attributes. */
export const itemIdFrom = (target?: Element | null) =>
  target?.closest('[data-item-id]')?.getAttribute('data-item-id')
  ?? target?.closest('[data-node-id]')?.getAttribute('data-node-id')
  ?? target?.closest('[data-edge-id]')?.getAttribute('data-edge-id')
  ?? target?.closest('[data-graph-id]')?.getAttribute('data-graph-id')
  ?? '';

/** Closest ItemRef from a DOM target. Prefers `[data-item-kind][data-item-id]`,
 *  falls back to legacy kind-specific attributes. */
export const itemRefFrom = (target?: Element | null): ItemRef | null => {
  const item = target?.closest('[data-item-kind][data-item-id]');
  const kind = item?.getAttribute('data-item-kind') as ItemRef['kind'] | null;
  const id = item?.getAttribute('data-item-id');
  if (kind && id) return { kind, id };
  const node = target?.closest('[data-node-id]')?.getAttribute('data-node-id');
  if (node) return { kind: 'node', id: node };
  const edge = target?.closest('[data-edge-id]')?.getAttribute('data-edge-id');
  if (edge) return { kind: 'edge', id: edge };
  const graph = target?.closest('[data-graph-id]')?.getAttribute('data-graph-id');
  if (graph) return { kind: 'graph', id: graph };
  return null;
};
