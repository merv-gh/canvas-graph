import type { Bus, ItemRef } from '../types';
import { edgeRef, itemKey, nodeRef, sameItemRef } from './item-ref';

/** A CSS-state mark on an item (selected, focused, dragging…). `mode` (or the
 *  optional `className`) becomes a class on the item's rendered element. */
export type ItemMode = { source: string; mode: string; ref: ItemRef; className?: string };
/** A floating chip drawn over an item (jump letter, picker letter, badge). */
export type Overlay = { ref: ItemRef; text: string; id?: string; className?: string };

/** decorations — *transient, per-item visual state keyed by origin*.
 *
 *  Two facets of one idea ("how an item looks right now, beyond its base
 *  render"), merged into ONE context so there is ONE `.changed` signal and ONE
 *  origin teardown:
 *    - `modes`    → state classes applied to the item element   (was itemModes)
 *    - `overlays` → floating chips drawn over the item          (was itemOverlays)
 *
 *  Mergeable/splittable by design: each facet is a self-contained object, so
 *  splitting one back into its own context is a lift-and-rename. Everything an
 *  origin set is dropped together by `unregisterOrigin` — that is what makes a
 *  flag-flip a clean teardown. */
export function decorationsContext(bus: Bus) {
  const modeMap = new Map<string, ItemMode[]>();
  const overlayMap = new Map<string, Overlay[]>();
  const changed = (facet: 'modes' | 'overlays', source?: string) =>
    bus.emit('decoration.changed', { facet, source });

  const modesFor = (ref: ItemRef) => [...modeMap.values()].flat().filter(e => sameItemRef(e.ref, ref));
  const dropRef = (map: Map<string, { ref: ItemRef }[]>, ref: ItemRef): boolean => {
    let touched = false;
    for (const [src, list] of map) {
      const next = list.filter(e => !sameItemRef(e.ref, ref));
      if (next.length === list.length) continue;
      touched = true;
      if (next.length) map.set(src, next); else map.delete(src);
    }
    return touched;
  };
  const remove = (ref: ItemRef) => {
    if (dropRef(modeMap, ref)) changed('modes');
    if (dropRef(overlayMap, ref)) changed('overlays');
  };

  const modes = {
    set(source: string, mode: string, refs: ItemRef[], className = mode) {
      modeMap.set(source, refs.map(ref => ({ source, mode, ref, className })));
      changed('modes', source);
    },
    for: modesFor,
    has(ref: ItemRef, mode: string) { return modesFor(ref).some(e => e.mode === mode); },
    all() { return [...modeMap.values()].flat().sort((a, b) => itemKey(a.ref).localeCompare(itemKey(b.ref))); },
  };
  const overlays = {
    set(source: string, next: Overlay[]) { overlayMap.set(source, next); changed('overlays', source); },
    all() { return [...overlayMap.values()].flat(); },
  };

  bus.on('graph.node.deleted', ({ id }) => remove(nodeRef(id)));
  bus.on('graph.edge.deleted', ({ id }) => remove(edgeRef(id)));

  return {
    modes,
    overlays,
    remove,
    /** Drop every mode AND overlay this origin set — used by registry teardown. */
    unregisterOrigin(origin: string) {
      const hadModes = modeMap.delete(origin);
      const hadOverlays = overlayMap.delete(origin);
      if (hadModes) changed('modes', origin);
      if (hadOverlays) changed('overlays', origin);
    },
  };
}

export type DecorationsApi = ReturnType<typeof decorationsContext>;
