import type { Bus } from '../types';
import type { IoApi } from './io';
import { STORAGE_KEYS } from './io';

/** Stored fold state by id. Open is the default (`isOpen` returns true unless
 *  set false), so any new id "just works" until the user explicitly collapses
 *  it. Persisted via io so reloads remember. */
export type FoldStore = {
  isOpen(id: string, defaultOpen?: boolean): boolean;
  set(id: string, open: boolean): void;
  toggle(id: string, defaultOpen?: boolean): void;
  all(): Record<string, boolean>;
};

declare module './io' {
  // Augmenting the readonly STORAGE_KEYS const isn't possible in TS, so we
  // declare the key at the call site instead. Kept here as a marker that the
  // 'v2.fold' key lives in the io adapter's keyspace.
}

/** Generic fold/collapse state, shared between UI surfaces (outline sections,
 *  left panel, future inspector pane, …). Lives next to selection / view as a
 *  presentation-layer store — not graph data. */
export function foldContext(bus: Bus, io: IoApi): FoldStore {
  const KEY = 'v2.fold';
  const state: Record<string, boolean> = io.get<Record<string, boolean>>(KEY, {});
  const isOpen = (id: string, defaultOpen = true) =>
    Object.prototype.hasOwnProperty.call(state, id) ? state[id] : defaultOpen;
  const set = (id: string, open: boolean) => {
    state[id] = open;
    io.set(KEY, state);
    bus.emit('fold.changed', { id, open });
  };
  const toggle = (id: string, defaultOpen = true) => set(id, !isOpen(id, defaultOpen));
  return { isOpen, set, toggle, all: () => ({ ...state }) };
}
