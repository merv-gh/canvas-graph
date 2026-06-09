import type { Id, ItemKind, ItemRef } from '../types';

/** A nestable parent stores children as ItemRefs and is itself looked up by id. */
type NestableParent = { id: Id; Children: ItemRef[] };

export type NestApi = {
  /** Hierarchy provider — returns the immediate parent ref of a given item, if any. */
  parentRefOf(ref: ItemRef): ItemRef | undefined;
  /** True if `descendant` is reachable from `ancestor` via parent walk (or is the same). */
  isAncestorOrSelf(ancestor: ItemRef, descendant: ItemRef): boolean;
  /** Move `childRef` under `parentId`. Returns 'cycle' if it would create one,
   *  'noop' if the parent doesn't exist or child is already there, 'ok' otherwise.
   *  Mutates the parent's `Children` array and the internal parent-of map. */
  add(parentId: Id, childRef: ItemRef): 'ok' | 'cycle' | 'noop';
  /** Detach `childRef` from its current parent (if any). Returns the previous
   *  parent id, or undefined if it had no parent. */
  remove(childRef: ItemRef): Id | undefined;
};

/** Nesting machinery for a parent kind. The store passes its parents map
 *  (Map<Id, ParentLike>) and a kind label; the helper maintains the
 *  child-to-parent index plus the cycle guard. `onChange(parentId)` fires
 *  whenever a parent's Children list changes — typically wired to emit a
 *  `*.children.changed` event for redraw / outline.
 *
 *  This is the single piece of infrastructure that makes nestedness composable
 *  across kinds: any system with "I hold a list of refs" gets parent walking,
 *  add/remove with cycle protection, and a hierarchy-context provider, for ~30
 *  lines of integration in its own file. */
export function createNesting<P extends NestableParent>(opts: {
  parents: Map<Id, P>;
  parentKind: ItemKind;
  onChange?: (parentId: Id) => void;
}): NestApi {
  const { parents, parentKind, onChange } = opts;
  const key = (ref: ItemRef) => `${ref.kind}:${ref.id}`;
  const sameRef = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id;
  /** Child kind:id → parent id. The single source of truth for hierarchy. */
  const parentOf = new Map<string, Id>();

  const parentRefOf = (ref: ItemRef): ItemRef | undefined => {
    const pid = parentOf.get(key(ref));
    return pid && parents.has(pid) ? { kind: parentKind, id: pid } : undefined;
  };

  const isAncestorOrSelf = (ancestor: ItemRef, descendant: ItemRef): boolean => {
    let cur: ItemRef | undefined = descendant;
    const seen = new Set<string>();
    while (cur) {
      const k = key(cur);
      if (seen.has(k)) return false;
      seen.add(k);
      if (sameRef(cur, ancestor)) return true;
      const pid = parentOf.get(k);
      cur = pid ? { kind: parentKind, id: pid } : undefined;
    }
    return false;
  };

  const detach = (childRef: ItemRef): Id | undefined => {
    const k = key(childRef);
    const prev = parentOf.get(k);
    if (!prev) return undefined;
    const p = parents.get(prev);
    if (p) p.Children = p.Children.filter(r => !sameRef(r, childRef));
    parentOf.delete(k);
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
      const prev = parentOf.get(key(childRef));
      if (prev === parentId) return 'noop';
      if (prev) detach(childRef);
      if (!p.Children.some(r => sameRef(r, childRef))) p.Children.push(childRef);
      parentOf.set(key(childRef), parentId);
      onChange?.(parentId);
      return 'ok';
    },
  };
}
