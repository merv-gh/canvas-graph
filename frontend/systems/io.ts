import { STORAGE_KEYS, type Registry } from '../core';
import type { GraphSnapshot } from '../model';

declare module '../types' {
  interface CustomEvents {
    'flag.changed': void;
    'command.shortcut.changed': { id: string; shortcut: string };
    'command.enabled.changed': { id: string; enabled: boolean };
  }
}

/** Persisted multi-graph shape: every graph's snapshot + which one was active. */
type PersistedGraphs = { current: string; graphs: { id: string; snapshot: GraphSnapshot }[] };

/** io — persist flag / command / fold / graph state to the IoApi adapter.
 *  Reads happen at boot (core contexts hydrate from io.get; graphs restore on
 *  `app.start`); writes go through events so core contexts never call io.set
 *  directly (Principle 9). The io system owns the persistence boundary — all
 *  other systems just emit facts and this system writes them to storage. */
export function registerIo(system: Registry) {
  system('io', ({ on, emit, bus, io, flags, contexts, graphs }) => {
    on('flag.changed', () => io.set(STORAGE_KEYS.flags, flags.all()));
    on('command.shortcut.changed', ({ id, shortcut }) => {
      const overrides = io.get<Record<string, string>>(STORAGE_KEYS.shortcuts, {});
      overrides[id] = shortcut;
      io.set(STORAGE_KEYS.shortcuts, overrides);
    });
    on('command.enabled.changed', ({ id, enabled }) => {
      const disabled = new Set(io.get<string[]>(STORAGE_KEYS.disabledCommands, []));
      if (enabled) disabled.delete(id); else disabled.add(id);
      io.set(STORAGE_KEYS.disabledCommands, [...disabled]);
    });
    on('fold.changed', () => io.set('frontend.fold', contexts.fold.all()));

    // ----- Graph persistence -----
    // Every graph.* fact schedules a debounced save of all graphs. Restore runs
    // on app.start; io registers before share, so a `?g=` link still wins — its
    // async import lands after restore and overwrites the current graph.
    const saveGraphs = () => io.set(STORAGE_KEYS.graphs, {
      current: graphs.current.id,
      graphs: graphs.all().map(graph => ({ id: graph.id, snapshot: graph.snapshot() })),
    } satisfies PersistedGraphs);
    let pendingSave: ReturnType<typeof setTimeout> | undefined;
    const scheduleSave = () => {
      clearTimeout(pendingSave);
      pendingSave = setTimeout(() => { pendingSave = undefined; saveGraphs(); }, 300);
    };
    const flushSave = () => {
      if (pendingSave === undefined) return;
      clearTimeout(pendingSave);
      pendingSave = undefined;
      saveGraphs();
    };
    const offAny = bus.onAny(({ name }) => {
      // Past-tense graph facts only: graph.node.created, graph.edge.updated,
      // graph.switched, graph.imported, … (requests don't mean the data moved).
      if (name.startsWith('graph.') && name.endsWith('ed')) scheduleSave();
    });
    on('app.start', () => {
      const saved = io.get<PersistedGraphs | null>(STORAGE_KEYS.graphs, null);
      if (!saved?.graphs?.length) return;
      const bootGraph = graphs.current;
      const savedIds = new Set(saved.graphs.map(entry => entry.id));
      saved.graphs.forEach(({ id, snapshot }) => graphs.create(id).replace(snapshot));
      if (savedIds.has(saved.current)) graphs.switch(saved.current);
      // Drop the empty boot-default graph when the restore didn't include it.
      if (!savedIds.has(bootGraph.id) && !bootGraph.nodes().length && !bootGraph.edges().length) {
        graphs.delete(bootGraph.id);
      }
      // Saved positions may sit far from the default camera — bring them in view.
      if (graphs.current.nodes().length) emit('view.fit.all');
    });
    // Tab close / navigation: flush the pending debounce so the last edit sticks.
    globalThis.addEventListener?.('pagehide', flushSave);
    return () => {
      globalThis.removeEventListener?.('pagehide', flushSave);
      clearTimeout(pendingSave);
      pendingSave = undefined;
      offAny();
    };
  });
}
