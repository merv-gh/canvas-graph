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
  bus.on('item.update', ({ ref, patch }) => handlers.get(ref.kind)?.apply(ref, patch));
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
    unregisterOrigin(origin) {
      for (const [kind, entry] of handlers) {
        if (entry.origin === origin) handlers.delete(kind);
      }
    },
  };
}
