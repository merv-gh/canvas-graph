import type { Bus, ItemRef } from '../types';
import { edgeRef, itemKey, nodeRef, refKey } from './item-ref';

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
  const changed = (facet: 'modes' | 'overlays', source?: string, refs?: ItemRef[]) =>
    bus.emit('decoration.changed', { facet, source, refs });

  // A rendered nested ref includes its parent path while selection/focus store
  // the canonical kind+id. Decorations belong to the item across either view.
  const sameDecoratedItem = (a: ItemRef, b: ItemRef) => refKey(a) === refKey(b);
  const modesFor = (ref: ItemRef) => [...modeMap.values()].flat().filter(e => sameDecoratedItem(e.ref, ref));
  const dropRef = (map: Map<string, { ref: ItemRef }[]>, ref: ItemRef): boolean => {
    let touched = false;
    for (const [src, list] of map) {
      const next = list.filter(e => !sameDecoratedItem(e.ref, ref));
      if (next.length === list.length) continue;
      touched = true;
      if (next.length) map.set(src, next); else map.delete(src);
    }
    return touched;
  };
  const remove = (ref: ItemRef) => {
    if (dropRef(modeMap, ref)) changed('modes', undefined, [ref]);
    if (dropRef(overlayMap, ref)) changed('overlays', undefined, [ref]);
  };

  const modes = {
    set(source: string, mode: string, refs: ItemRef[], className = mode) {
      const previous = modeMap.get(source)?.map(entry => entry.ref) ?? [];
      modeMap.set(source, refs.map(ref => ({ source, mode, ref, className })));
      changed('modes', source, [...previous, ...refs]);
    },
    for: modesFor,
    has(ref: ItemRef, mode: string) { return modesFor(ref).some(e => e.mode === mode); },
    all() { return [...modeMap.values()].flat().sort((a, b) => itemKey(a.ref).localeCompare(itemKey(b.ref))); },
  };
  const overlays = {
    set(source: string, next: Overlay[]) {
      const previous = overlayMap.get(source)?.map(entry => entry.ref) ?? [];
      overlayMap.set(source, next);
      changed('overlays', source, [...previous, ...next.map(entry => entry.ref)]);
    },
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
      const refs = [
        ...(modeMap.get(origin)?.map(entry => entry.ref) ?? []),
        ...(overlayMap.get(origin)?.map(entry => entry.ref) ?? []),
      ];
      const hadModes = modeMap.delete(origin);
      const hadOverlays = overlayMap.delete(origin);
      if (hadModes) changed('modes', origin, refs);
      if (hadOverlays) changed('overlays', origin, refs);
    },
  };
}

export type DecorationsApi = ReturnType<typeof decorationsContext>;
