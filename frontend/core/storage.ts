import type { Bus, ItemRef } from '../types';

/** Apply a patch for a given item kind. Called by the storage dispatcher in
 *  response to `item.update`. Implementations resolve the underlying store
 *  (graph.current, container map, …) and emit the appropriate fact event. */
export type StorageApply = (ref: ItemRef, patch: unknown) => void;

export type StorageApi = {
  /** Register a handler for `kind`. Last registration wins (kinds are owned by
   *  exactly one storage at a time). The teardown removes only the registered
   *  apply — re-registering by another origin survives. */
  register(kind: string, origin: string, apply: StorageApply): () => void;
  kinds(): string[];
  has(kind: string): boolean;
  /** Claim exclusive post-create defaulting for an item kind. Duplicate owners
   * throw during boot instead of depending on registry order. */
  claimDefaults(kind: string, origin: string): () => void;
  defaultOwners(): { kind: string; origin: string }[];
  unregisterOrigin(origin: string): void;
};

/** Centralized `item.update` dispatcher. One bus subscription, O(1) lookup by
 *  ref.kind. Replaces the previous pattern where every storage system filtered
 *  every item.update via `if (ref.kind !== 'mine') return`.
 *
 *  DX checks every patchable entity has a handler — adding a new kind without
 *  registering storage now fails the boot contract instead of silently dropping
 *  patches. */
export function storageContext(bus: Bus): StorageApi {
  const handlers = new Map<string, { origin: string; apply: StorageApply }>();
  const defaultOwners = new Map<string, string>();
  const applyOne = ({ ref, patch }: { ref: ItemRef; patch: unknown }) => handlers.get(ref.kind)?.apply(ref, patch);
  bus.on('item.update', applyOne);
  bus.on('item.update.batch', ({ updates }) => updates.forEach(applyOne));
  return {
    register(kind, origin, apply) {
      handlers.set(kind, { origin, apply });
      return () => {
        const current = handlers.get(kind);
        if (current?.apply === apply) handlers.delete(kind);
      };
    },
    kinds: () => [...handlers.keys()],
    has: (kind) => handlers.has(kind),
    claimDefaults(kind, origin) {
      const current = defaultOwners.get(kind);
      if (current && current !== origin) {
        throw new Error(`Default owner conflict for "${kind}": "${current}" and "${origin}"`);
      }
      defaultOwners.set(kind, origin);
      return () => { if (defaultOwners.get(kind) === origin) defaultOwners.delete(kind); };
    },
    defaultOwners: () => [...defaultOwners].map(([kind, origin]) => ({ kind, origin })),
    unregisterOrigin(origin) {
      for (const [kind, entry] of handlers) {
        if (entry.origin === origin) handlers.delete(kind);
      }
      for (const [kind, owner] of defaultOwners) if (owner === origin) defaultOwners.delete(kind);
    },
  };
}
