export const STORAGE_KEYS = {
  shortcuts: 'frontend.shortcuts',
  flags: 'frontend.flags',
  disabledCommands: 'frontend.commands.disabled',
  graphs: 'frontend.graphs',
  graphsBackup: 'frontend.graphs.backup',
} as const;

/** Swap point between localStorage, memory, IndexedDB, HTTP, etc. */
export type IoApi = {
  get<T>(key: string, fallback: T): T;
  /** Returns false when the backing store rejected the write. */
  set(key: string, value: unknown): boolean;
  del(key: string): void;
  keys(): string[];
};

export const localStorageIo = (): IoApi => ({
  get<T>(key: string, fallback: T): T {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* */ } },
  keys() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (k) keys.push(k);
      }
      return keys;
    } catch { return []; }
  },
});

export const memoryIo = (): IoApi => {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, fallback: T) { return store.has(key) ? store.get(key) as T : fallback; },
    set(key, value) { store.set(key, value); return true; },
    del(key) { store.delete(key); },
    keys: () => [...store.keys()],
  };
};
