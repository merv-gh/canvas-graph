import type { Bus, ItemRef } from '../types';
import { edgeRef, nodeRef, sameItemRef } from './item-ref';

export type ItemOverlay = {
  ref: ItemRef;
  text: string;
  id?: string;
  className?: string;
};

export function itemOverlaysContext(bus: Bus) {
  const overlays = new Map<string, ItemOverlay[]>();
  const changed = (source?: string) => bus.emit('itemOverlay.changed', { source });
  const api = {
    set(source: string, next: ItemOverlay[]) {
      overlays.set(source, next);
      changed(source);
    },
    unregisterOrigin(origin: string) {
      if (!overlays.delete(origin)) return;
      changed(origin);
    },
    remove(ref: ItemRef) {
      let touched = false;
      for (const [source, list] of overlays) {
        const next = list.filter(entry => !sameItemRef(entry.ref, ref));
        if (next.length === list.length) continue;
        touched = true;
        if (next.length) overlays.set(source, next);
        else overlays.delete(source);
      }
      if (touched) changed();
    },
    all() {
      return [...overlays.values()].flat();
    },
  };
  bus.on('graph.node.deleted', ({ id }) => api.remove(nodeRef(id)));
  bus.on('graph.edge.deleted', ({ id }) => api.remove(edgeRef(id)));
  return api;
}
