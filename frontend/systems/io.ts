import { STORAGE_KEYS, type Registry } from '../core';
import type { GraphSnapshot } from '../model';

declare module '../types' {
  interface CustomEvents {
    'flag.changed': void;
    'command.shortcut.changed': { id: string; shortcut: string };
    'command.enabled.changed': { id: string; enabled: boolean };
    'io.backup.restore.request': void;
    'io.backup.restore.confirm': void;
    'io.backup.restore.cancel': void;
  }
}

/** Persisted multi-graph shape: every graph's snapshot + which one was active. */
type PersistedGraphs = { current: string; graphs: { id: string; snapshot: GraphSnapshot }[] };

const validSnapshot = (snapshot: unknown): snapshot is GraphSnapshot => {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const candidate = snapshot as Partial<GraphSnapshot>;
  return Array.isArray(candidate.nodes)
    && Array.isArray(candidate.edges)
    && candidate.nodes.every(node => !!node && typeof node === 'object' && typeof node.id === 'string')
    && candidate.edges.every(edge => !!edge && typeof edge === 'object' && typeof edge.id === 'string');
};

const validPersisted = (value: unknown): value is PersistedGraphs => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedGraphs>;
  return typeof candidate.current === 'string'
    && Array.isArray(candidate.graphs)
    && candidate.graphs.length > 0
    && candidate.graphs.some(entry => entry?.id === candidate.current)
    && candidate.graphs.every(entry => !!entry && typeof entry.id === 'string' && validSnapshot(entry.snapshot));
};

/** io — persist flag / command / fold / graph state to the IoApi adapter.
 *  Reads happen at boot (core contexts hydrate from io.get; graphs restore on
 *  `app.start`); writes go through events so core contexts never call io.set
 *  directly (Principle 9). The io system owns the persistence boundary — all
 *  other systems just emit facts and this system writes them to storage. */
export function registerIo(system: Registry) {
  system('io', ({ on, emit, bus, io, flags, contexts, graphs, frameLoop }) => {
    let restorePending = false;
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

    const backup = () => {
      const value = io.get<unknown>(STORAGE_KEYS.graphsBackup, null);
      return validPersisted(value) ? value : null;
    };
    const restorePreview = (saved: PersistedGraphs) => () => {
      const panel = document.createElement('section');
      panel.className = 'delete-preview restore-preview';
      const warning = document.createElement('p');
      const nodeCount = saved.graphs.reduce((sum, entry) => sum + entry.snapshot.nodes.length, 0);
      warning.textContent = `Restore the previous browser save with ${saved.graphs.length} graph${saved.graphs.length === 1 ? '' : 's'} and ${nodeCount} node${nodeCount === 1 ? '' : 's'}? Current graphs will be replaced.`;
      const note = document.createElement('small');
      note.textContent = 'Your current state becomes the next recovery point.';
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.command = 'io.backup.restore.cancel';
      cancel.textContent = 'Keep current graphs';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary';
      confirm.dataset.command = 'io.backup.restore.confirm';
      confirm.textContent = 'Restore previous save';
      actions.append(cancel, confirm);
      panel.append(warning, note, actions);
      return panel;
    };
    contexts.commands.register([
      {
        id: 'io.backup.restore.request', label: 'Restore previous browser save', group: 'history',
        available: () => !!backup(),
      },
      { id: 'io.backup.restore.confirm', label: 'Confirm previous save restore', group: 'history', hidden: true },
      { id: 'io.backup.restore.cancel', label: 'Cancel previous save restore', group: 'history', hidden: true },
    ]);

    // ----- Graph persistence -----
    // Every graph.* fact schedules a debounced save of all graphs. Restore runs
    // on app.start; io registers before share, so a `?g=` link still wins — its
    // async import lands after restore and overwrites the current graph.
    let restoring = false;
    const applySaved = (saved: PersistedGraphs, announceRecovery = false, emitFacts = true) => {
      const existing = [...graphs.all()];
      const savedIds = new Set(saved.graphs.map(entry => entry.id));
      restoring = true;
      try {
        saved.graphs.forEach(({ id, snapshot }) => graphs.create(id).replace(snapshot));
        graphs.switch(saved.current);
        existing.filter(graph => !savedIds.has(graph.id)).forEach(graph => {
          const next = graphs.delete(graph.id);
          emit('graph.deleted', { id: graph.id, nextId: next.id });
        });
      } finally {
        restoring = false;
      }
      if (emitFacts) {
        emit('selection.item.clear');
        emit('graph.imported', { graphId: graphs.current.id });
        emit('graph.switched', { id: graphs.current.id });
      }
      if (announceRecovery) emit('app.notice', { message: 'Restored the previous browser save.' });
    };
    const saveGraphs = () => {
      const next = {
        current: graphs.current.id,
        graphs: graphs.all().map(graph => ({ id: graph.id, snapshot: graph.snapshot() })),
      } satisfies PersistedGraphs;
      const previous = io.get<unknown>(STORAGE_KEYS.graphs, null);
      if (validPersisted(previous)) io.set(STORAGE_KEYS.graphsBackup, previous);
      if (!io.set(STORAGE_KEYS.graphs, next)) {
        emit('app.notice', { message: 'Local save failed. Export JSON before closing this tab.', level: 'error' });
      }
    };
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
      const graphFact = name.startsWith('graph.') && name.endsWith('ed');
      const containerFact = name.startsWith('container.') && /\.(created|updated|deleted|changed)$/.test(name);
      if (!restoring && (graphFact || containerFact)) scheduleSave();
    });
    on('app.start', () => {
      const primary = io.get<unknown>(STORAGE_KEYS.graphs, null);
      const backup = io.get<unknown>(STORAGE_KEYS.graphsBackup, null);
      const saved = validPersisted(primary) ? primary : validPersisted(backup) ? backup : null;
      if (!saved) return;
      if (saved === backup) emit('app.notice', { message: 'Recovered graphs from the last valid local backup.', level: 'warn' });
      applySaved(saved, false, false);
      // Restoring changes the active graph just as surely as an interactive
      // graph switch. Publish that fact so graph-specific projections (the
      // requirements navigator/read-only surface in particular) cannot keep
      // the pre-restore first frame until the user types or clicks. Keep the
      // restore guard active so this fact does not schedule a redundant save.
      restoring = true;
      try {
        emit('graph.switched', { id: graphs.current.id });
      } finally {
        restoring = false;
      }
      // Saved positions may sit far from the default camera. Defer fitting until
      // the first rendered frame: during app.start the stage exists, but its
      // layout can still report the pre-CSS/zero-sized boot rect.
      if (graphs.current.nodes().length) {
        frameLoop.schedule('io.restore.fit', () => emit('view.fit.all'), 20);
      }
    });
    on('io.backup.restore.request', () => {
      const saved = backup();
      if (!saved) { emit('app.notice', { message: 'No previous browser save is available.', level: 'warn' }); return; }
      restorePending = true;
      emit('modal.open', { title: 'Restore previous save?', visual: 'properties', body: restorePreview(saved) });
    });
    on('io.backup.restore.confirm', () => {
      if (!restorePending) return;
      const saved = backup();
      restorePending = false;
      if (saved) applySaved(saved, true);
      emit('modal.close');
    });
    on('io.backup.restore.cancel', () => { restorePending = false; emit('modal.close'); });
    on('modal.closed', () => { restorePending = false; });
    // Tab close / navigation: flush the pending debounce so the last edit sticks.
    globalThis.addEventListener?.('pagehide', flushSave);
    globalThis.addEventListener?.('beforeunload', flushSave);
    return () => {
      globalThis.removeEventListener?.('pagehide', flushSave);
      globalThis.removeEventListener?.('beforeunload', flushSave);
      clearTimeout(pendingSave);
      pendingSave = undefined;
      frameLoop.cancel('io.restore.fit');
      offAny();
    };
  });
}
