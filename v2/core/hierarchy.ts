import type { Id, ItemRef } from '../types';

/** A system that owns parent-child relationships (e.g. containers) contributes
 *  one of these. `parentRefOf` returns the *immediate* parent ref of an item,
 *  or undefined if it has no parent in this provider's view. */
export type HierarchyProvider = {
  parentRefOf(ref: ItemRef): ItemRef | undefined;
};

/** Cross-system hierarchy registry. Multiple providers can contribute (one per
 *  origin); the first non-undefined parent wins. Consumers walk up via
 *  `parentChain` or just read the id chain via `parentIds`.
 *
 *  This is the single seam that lets layout, render, and selection treat
 *  nestedness uniformly without knowing which system owns it. With no
 *  providers registered the app behaves as a flat graph. */
export function hierarchyContext() {
  const providers = new Map<string, HierarchyProvider>();
  const parentRefOf = (ref: ItemRef): ItemRef | undefined => {
    for (const provider of providers.values()) {
      const parent = provider.parentRefOf(ref);
      if (parent) return parent;
    }
    return undefined;
  };
  /** Outermost-first chain of typed parent refs, or [] when root. */
  const parentChain = (ref: ItemRef): ItemRef[] => {
    const chain: ItemRef[] = [];
    const seen = new Set<string>();
    let current = parentRefOf(ref);
    while (current) {
      const key = `${current.kind}:${current.id}`;
      if (seen.has(key)) break; // cycle guard — providers can be buggy
      seen.add(key);
      chain.unshift(current);
      current = parentRefOf(current);
    }
    return chain;
  };
  /** Outermost-first id chain matching `ItemRef.parent`. Undefined when root. */
  const parentIds = (ref: ItemRef): Id[] | undefined => {
    const chain = parentChain(ref);
    return chain.length ? chain.map(p => p.id) : undefined;
  };
  return {
    parentRefOf,
    parentChain,
    parentIds,
    register(origin: string, provider: HierarchyProvider) {
      providers.set(origin, provider);
      return () => { if (providers.get(origin) === provider) providers.delete(origin); };
    },
    unregisterOrigin(origin: string) {
      providers.delete(origin);
    },
  };
}
