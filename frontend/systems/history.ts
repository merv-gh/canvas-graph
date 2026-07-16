import type { GraphSnapshot } from '../model';
import type { Id } from '../types';
import type { Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'history.replace.start': void;
    'history.replace.end': void;
    'history.undo': void;
    'history.redo': void;
    'history.changed': { graphId: Id; canUndo: boolean; canRedo: boolean };
  }
}

type Entry = { json: string; snapshot: GraphSnapshot };
type Timeline = { entries: Entry[]; index: number };

const cloneSnapshot = (snapshot: GraphSnapshot): GraphSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as GraphSnapshot;

/** Document history. Facts are coalesced briefly so one gesture or composed
 *  command (create node + attached edge) becomes one undo step. */
export function registerHistory(system: Registry) {
  system('history', ({ on, emit, bus, contexts, graphs, selection, contribute }) => {
    const timelines = new Map<Id, Timeline>();
    let pending: ReturnType<typeof setTimeout> | undefined;
    let applying = false;
    let replacing = 0;
    const LIMIT = 100;

    const entry = (): Entry => {
      const snapshot = cloneSnapshot(graphs.current.snapshot());
      return { json: JSON.stringify(snapshot), snapshot };
    };
    const ensure = (id = graphs.current.id) => {
      let timeline = timelines.get(id);
      if (!timeline) {
        const initial = entry();
        timeline = { entries: [initial], index: 0 };
        timelines.set(id, timeline);
      }
      return timeline;
    };
    const announce = () => {
      const timeline = ensure();
      emit('history.changed', {
        graphId: graphs.current.id,
        canUndo: timeline.index > 0,
        canRedo: timeline.index < timeline.entries.length - 1,
      });
    };
    const capture = () => {
      clearTimeout(pending);
      pending = undefined;
      if (applying || replacing) return;
      const timeline = ensure();
      const next = entry();
      if (timeline.entries[timeline.index]?.json === next.json) return;
      timeline.entries.splice(timeline.index + 1);
      timeline.entries.push(next);
      if (timeline.entries.length > LIMIT) timeline.entries.shift();
      timeline.index = timeline.entries.length - 1;
      announce();
    };
    const scheduleCapture = () => {
      if (applying || replacing) return;
      clearTimeout(pending);
      pending = setTimeout(capture, 120);
    };
    const flushCapture = () => { if (pending !== undefined) capture(); };
    const restore = (offset: -1 | 1) => {
      flushCapture();
      const timeline = ensure();
      const target = timeline.index + offset;
      if (target < 0 || target >= timeline.entries.length) return;
      timeline.index = target;
      applying = true;
      graphs.current.replace(cloneSnapshot(timeline.entries[target].snapshot));
      selection.select(null);
      selection.focus(null);
      emit('graph.imported', { graphId: graphs.current.id });
      emit('graph.switched', { id: graphs.current.id });
      queueMicrotask(() => { applying = false; announce(); });
    };

    contexts.commands.register([
      {
        id: 'history.undo', label: 'Undo', group: 'history', shortcut: 'Ctrl+Z',
        input: { on: 'keydown', key: 'z', ctrl: true, prevent: true },
        available: () => { flushCapture(); return ensure().index > 0; },
      },
      {
        id: 'history.undo.meta', label: 'Undo', event: 'history.undo', group: 'history', hidden: true,
        shortcut: 'Cmd+Z', input: { on: 'keydown', key: 'z', meta: true, prevent: true },
      },
      {
        id: 'history.redo', label: 'Redo', group: 'history', shortcut: 'Ctrl+Shift+Z',
        input: { on: 'keydown', key: 'Z', ctrl: true, shift: true, prevent: true },
        available: () => { flushCapture(); const timeline = ensure(); return timeline.index < timeline.entries.length - 1; },
      },
      {
        id: 'history.redo.meta', label: 'Redo', event: 'history.redo', group: 'history', hidden: true,
        shortcut: 'Cmd+Shift+Z', input: { on: 'keydown', key: 'Z', meta: true, shift: true, prevent: true },
      },
    ]);
    contribute({ surface: 'top', command: 'history.undo', kind: 'button', text: 'Undo', label: 'Undo', order: 26, group: 'history' });
    contribute({ surface: 'top', command: 'history.redo', kind: 'button', text: 'Redo', label: 'Redo', order: 27, group: 'history' });

    on('history.undo', () => restore(-1));
    on('history.redo', () => restore(1));
    on('history.replace.start', () => {
      if (replacing++ === 0) flushCapture();
    });
    on('history.replace.end', () => {
      replacing = Math.max(0, replacing - 1);
      if (!replacing) capture();
    });
    on('app.start', () => { ensure(); announce(); });
    on('graph.switched', ({ id }) => { clearTimeout(pending); pending = undefined; ensure(id); announce(); });
    on('graph.deleted', ({ id }) => { timelines.delete(id); });
    const offAny = bus.onAny(({ name }) => {
      const graphFact = name.startsWith('graph.') && /\.(created|updated|deleted|renamed|imported)$/.test(name);
      const containerFact = name.startsWith('container.') && /\.(created|updated|deleted|changed)$/.test(name);
      if (graphFact || containerFact) scheduleCapture();
    });

    return () => {
      clearTimeout(pending);
      offAny();
      timelines.clear();
    };
  }, { requires: ['graph'] });
}
