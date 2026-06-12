import type { Id, ItemKind, ItemRef, Position } from '../types';
import { sameItemRef } from './item-ref';

const key = (ref: ItemRef) => `${ref.kind}:${ref.id}`;

/** A navigable, orderable item in the app's hierarchy.
 *  - `anchor` — graph-space position; present for on-canvas items (jump / fit).
 *  - `order`  — importance among siblings (lower = earlier / more prominent). */
export type HierarchyItem = { ref: ItemRef; label: string; anchor?: Position; order?: number };
/** A system that produces navigable items (graph → nodes+edges, containers →
 *  containers). Read live each call so switching graphs needs no re-register. */
export type HierarchySource = () => HierarchyItem[];
/** A system that owns parent links. `parentRefOf` returns the *immediate*
 *  parent of an item, or undefined when it has none in this provider's view. */
export type HierarchyParent = { parentRefOf(ref: ItemRef): ItemRef | undefined };
/** A HierarchyItem with its resolved children — the assembled tree. */
export type HierarchyNode = HierarchyItem & { children: HierarchyNode[] };

/** hierarchy — the app's tree of navigable, orderable items.
 *
 *  It answers the two questions the app keeps asking:
 *    1. *ordered importance* — what nests under what, and in what order
 *       (`tree`, `roots`, `childrenOf`, sorted by `HierarchyItem.order`).
 *    2. *shortest paths* — how to get from an item to its context
 *       (`parentChain` / `ancestors` upward, `childrenOf` downward → log-N
 *       navigation for jump, search, and contextual commands).
 *
 *  Two registration facets, merged from the old hierarchy + itemTargets
 *  contexts so nesting and navigation share one seam:
 *    - `sources` → who the items are (was itemTargets providers)
 *    - `parents` → who is whose parent (was hierarchy providers)
 *  With no sources/parents the app is a flat graph. `createNesting` (below) is
 *  the matching *mutable* engine a containing kind uses to maintain its links. */
export function hierarchyContext() {
  const sources = new Map<string, HierarchySource>();
  const parents = new Map<string, HierarchyParent>();
  const byOrder = (a: HierarchyItem, b: HierarchyItem) => (a.order ?? 0) - (b.order ?? 0);

  const items = (): HierarchyItem[] => [...sources.values()].flatMap(source => source());
  const parentRefOf = (ref: ItemRef): ItemRef | undefined => {
    for (const provider of parents.values()) {
      const parent = provider.parentRefOf(ref);
      if (parent) return parent;
    }
    return undefined;
  };
  /** Outermost-first chain of typed ancestor refs, or [] when root. */
  const parentChain = (ref: ItemRef): ItemRef[] => {
    const chain: ItemRef[] = [];
    const seen = new Set<string>();
    let current = parentRefOf(ref);
    while (current) {
      const k = key(current);
      if (seen.has(k)) break; // cycle guard — providers can be buggy
      seen.add(k);
      chain.unshift(current);
      current = parentRefOf(current);
    }
    return chain;
  };
  const parentIds = (ref: ItemRef): Id[] | undefined => {
    const chain = parentChain(ref);
    return chain.length ? chain.map(p => p.id) : undefined;
  };

  const get = (ref: ItemRef) => items().find(it => sameItemRef(it.ref, ref));
  const anchor = (ref: ItemRef) => get(ref)?.anchor ?? null;
  const childrenOf = (ref: ItemRef): HierarchyItem[] =>
    items().filter(it => { const p = parentRefOf(it.ref); return !!p && sameItemRef(p, ref); }).sort(byOrder);

  /** All items with no parent, ordered. */
  const roots = (): HierarchyItem[] => items().filter(it => !parentRefOf(it.ref)).sort(byOrder);

  /** Assemble the full forest in a single pass (parent index, not O(n²) walk). */
  const tree = (): HierarchyNode[] => {
    const list = items();
    const childIndex = new Map<string, HierarchyItem[]>();
    const rootList: HierarchyItem[] = [];
    for (const it of list) {
      const parent = parentRefOf(it.ref);
      if (parent) (childIndex.get(key(parent)) ?? childIndex.set(key(parent), []).get(key(parent))!).push(it);
      else rootList.push(it);
    }
    const build = (it: HierarchyItem, seen: Set<string>): HierarchyNode => {
      const k = key(it.ref);
      const kids = seen.has(k) ? [] : (childIndex.get(k) ?? []).slice().sort(byOrder);
      const nextSeen = new Set(seen).add(k);
      return { ...it, children: kids.map(child => build(child, nextSeen)) };
    };
    return rootList.sort(byOrder).map(it => build(it, new Set()));
  };

  return {
    /** Register the items a system contributes (ref, label, anchor?, order?). */
    sources: {
      register(origin: string, source: HierarchySource) {
        sources.set(origin, source);
        return () => { if (sources.get(origin) === source) sources.delete(origin); };
      },
    },
    /** Register a parent-link provider (containers, future groups). */
    parents: {
      register(origin: string, provider: HierarchyParent) {
        parents.set(origin, provider);
        return () => { if (parents.get(origin) === provider) parents.delete(origin); };
      },
    },
    // Upward navigation.
    parentRefOf, parentChain, parentIds, ancestors: parentChain,
    // Flat read (jump / picker / fit).
    items, targets: items, get, anchor,
    // Downward / tree navigation (outline / palette).
    childrenOf, roots, tree,
    unregisterOrigin(origin: string) { sources.delete(origin); parents.delete(origin); },
  };
}

export type HierarchyApi = ReturnType<typeof hierarchyContext>;

// ---------------------------------------------------------------------------
// Nesting engine — the mutable side of hierarchy
// ---------------------------------------------------------------------------

/** A nestable parent stores children as ItemRefs and is itself looked up by id. */
type NestableParent = { id: Id; Children: ItemRef[] };

export type NestApi = {
  /** Immediate parent ref of an item, if any — register this with `hierarchy.parents`. */
  parentRefOf(ref: ItemRef): ItemRef | undefined;
  /** True if `descendant` is reachable from `ancestor` (or is the same). */
  isAncestorOrSelf(ancestor: ItemRef, descendant: ItemRef): boolean;
  /** Move `childRef` under `parentId`. 'cycle' if it would create one, 'noop' if
   *  the parent is missing or the child is already there, 'ok' otherwise. */
  add(parentId: Id, childRef: ItemRef): 'ok' | 'cycle' | 'noop';
  /** Detach `childRef` from its parent (if any); returns the previous parent id. */
  remove(childRef: ItemRef): Id | undefined;
};

/** Nesting machinery for one parent kind. The owning system passes its parents
 *  map and a kind label; this maintains the child→parent index + cycle guard,
 *  and `onChange(parentId)` fires when a parent's Children list changes (wire it
 *  to emit a `*.children.changed` fact). This is the single piece that makes
 *  nestedness composable: any "I hold a list of refs" system gets parent
 *  walking, cycle-safe add/remove, and a `hierarchy.parents` provider for ~30
 *  lines of its own file. */
export function createNesting<P extends NestableParent>(opts: {
  parents: Map<Id, P>;
  parentKind: ItemKind;
  onChange?: (parentId: Id) => void;
}): NestApi {
  const { parents, parentKind, onChange } = opts;
  const k = (ref: ItemRef) => `${ref.kind}:${ref.id}`;
  const sameRef = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id;
  /** Child kind:id → parent id. The single source of truth for hierarchy. */
  const parentOf = new Map<string, Id>();

  const parentRefOf = (ref: ItemRef): ItemRef | undefined => {
    const pid = parentOf.get(k(ref));
    return pid && parents.has(pid) ? { kind: parentKind, id: pid } : undefined;
  };
  const isAncestorOrSelf = (ancestor: ItemRef, descendant: ItemRef): boolean => {
    let cur: ItemRef | undefined = descendant;
    const seen = new Set<string>();
    while (cur) {
      const ck = k(cur);
      if (seen.has(ck)) return false;
      seen.add(ck);
      if (sameRef(cur, ancestor)) return true;
      const pid = parentOf.get(ck);
      cur = pid ? { kind: parentKind, id: pid } : undefined;
    }
    return false;
  };
  const detach = (childRef: ItemRef): Id | undefined => {
    const ck = k(childRef);
    const prev = parentOf.get(ck);
    if (!prev) return undefined;
    const p = parents.get(prev);
    if (p) p.Children = p.Children.filter(r => !sameRef(r, childRef));
    parentOf.delete(ck);
    onChange?.(prev);
    return prev;
  };

  return {
    parentRefOf,
    isAncestorOrSelf,
    remove: detach,
    add(parentId, childRef) {
      const p = parents.get(parentId);
      if (!p) return 'noop';
      if (isAncestorOrSelf(childRef, { kind: parentKind, id: parentId })) return 'cycle';
      const prev = parentOf.get(k(childRef));
      if (prev === parentId) return 'noop';
      if (prev) detach(childRef);
      if (!p.Children.some(r => sameRef(r, childRef))) p.Children.push(childRef);
      parentOf.set(k(childRef), parentId);
      onChange?.(parentId);
      return 'ok';
    },
  };
}
