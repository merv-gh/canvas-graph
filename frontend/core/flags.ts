import type { Bus, FeatureFlags } from '../types';
import { localStorageIo, STORAGE_KEYS, type IoApi } from './io';

/** What a flag controls. Set by the registry that declares it.
 *  Used by demo, DX, and devtools to group/inspect flags without hardcoded lists. */
export type FlagKind = 'system' | 'ability' | 'feature';

export type FlagsApi = {
  all(): FeatureFlags;
  isOn(name: string): boolean;
  set(name: string, on: boolean): void;
  declared(kind?: FlagKind): string[];
  declare(name: string, defaultOn?: boolean, requires?: string[], kind?: FlagKind): void;
  kind(name: string): FlagKind | undefined;
  /** Names the given flag depends on. Populated by registry.start. */
  requires(name: string): string[];
};

export function createFlags(bus: Bus, initial: FeatureFlags = {}, io: IoApi = localStorageIo()): FlagsApi {
  const persisted = io.get<FeatureFlags>(STORAGE_KEYS.flags, {});
  const state: FeatureFlags = { ...initial, ...persisted };
  const deps = new Map<string, string[]>();
  const kinds = new Map<string, FlagKind>();
  return {
    all: () => ({ ...state }),
    isOn: (name) => state[name] !== false,
    declare(name, defaultOn = true, requires, kind) {
      if (!(name in state)) state[name] = defaultOn;
      if (requires?.length) deps.set(name, requires);
      if (kind) kinds.set(name, kind);
    },
    set(name, on) { state[name] = on; bus.emit('flag.changed'); },
    declared: (kind) => kind == null ? Object.keys(state) : Object.keys(state).filter(name => kinds.get(name) === kind),
    kind: (name) => kinds.get(name),
    requires: (name) => deps.get(name) ?? [],
  };
}
