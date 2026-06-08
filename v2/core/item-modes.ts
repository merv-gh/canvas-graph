import type { Bus, ItemRef } from '../types';
import { edgeRef, itemKey, nodeRef, sameItemRef } from './item-ref';

export type ItemMode = { source: string; mode: string; ref: ItemRef; className?: string };

export function itemModesContext(bus: Bus) {
  const modes = new Map<string, ItemMode[]>();
  const changed = (source?: string) => bus.emit('itemMode.changed', { source });
  const entriesFor = (ref: ItemRef) =>
    [...modes.values()].flat().filter(entry => sameItemRef(entry.ref, ref));
  const api = {
    set(source: string, mode: string, refs: ItemRef[], className = mode) {
      modes.set(source, refs.map(ref => ({ source, mode, ref, className })));
      changed(source);
    },
    unregisterOrigin(origin: string) {
      if (!modes.delete(origin)) return;
      changed(origin);
    },
    remove(ref: ItemRef) {
      let touched = false;
      for (const [source, list] of modes) {
        const next = list.filter(entry => !sameItemRef(entry.ref, ref));
        if (next.length === list.length) continue;
        touched = true;
        if (next.length) modes.set(source, next);
        else modes.delete(source);
      }
      if (touched) changed();
    },
    for(ref: ItemRef) {
      return entriesFor(ref);
    },
    has(ref: ItemRef, mode: string) {
      return entriesFor(ref).some(entry => entry.mode === mode);
    },
    all() {
      return [...modes.values()].flat().sort((a, b) => itemKey(a.ref).localeCompare(itemKey(b.ref)));
    },
  };
  bus.on('graph.node.deleted', ({ id }) => api.remove(nodeRef(id)));
  bus.on('graph.edge.deleted', ({ id }) => api.remove(edgeRef(id)));
  return api;
}
