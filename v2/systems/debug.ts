import {
  flattenSnapshotTree,
  snapshot,
  snapshotTree,
  traceToTest,
  type Assertion,
  type Registry,
  type Snapshot,
  type SnapshotNode,
} from '../core';
import { Places } from '../types';
import type { Trace } from '../core';

declare module '../types' {
  interface CustomEvents {
    /** Toggle the whole toolbar group. Persisted via io. */
    'debug.enable': { on: boolean };
    'debug.enabled.changed': { on: boolean };
    /** Recorder lifecycle. */
    'debug.record.start': void;
    'debug.record.stop': void;
    'debug.record.clear': void;
    'debug.recording.changed': { active: boolean; count: number };
    /** Modals. */
    'debug.assert.open': void;
    'debug.replay.open': void;
    /** Authoring actions inside the assert modal. */
    'debug.assert.pick': { code: string; matcher: string; expected: string };
    'debug.assert.search': { query: string };
    'debug.assert.clear-asserts': void;
    'debug.assert.copy': void;
    'debug.assert.download': void;
    'debug.assert.replay': void;
    /** Replay actions inside the replay modal. */
    'debug.replay.run': void;
  }
  interface CustomExposable {
    debug?: DebugApi;
  }
}

/** Devtools/test surface exposed via window.v2.debug. Lets a Playwright test
 *  (or a browser-console session) drive the recorder + snapshot directly,
 *  without going through the UI. */
export type DebugApi = {
  enabled(): boolean;
  recording(): boolean;
  trace(): Trace;
  setEnabled(on: boolean): void;
  start(): void;
  stop(): void;
  clear(): void;
  snapshot(): Snapshot;
  generate(assertions?: Assertion[], title?: string): string;
};

const STORAGE_KEY = 'v2.debug.enabled';

export function registerDebug(system: Registry) {
  system('debug', (ctx) => {
    const { on, emit, contexts, contribute, io, sim } = ctx;

    // ----- Recorder state ------------------------------------------------------
    let enabled = io.get<boolean>(STORAGE_KEY, false);
    let recording = false;
    let trace: Trace = [];
    const recorder = sim.record();

    // Assert-modal session state. Persists for the lifetime of one open modal.
    let assertions: Assertion[] = [];
    let assertSearch = '';
    let lastSnapshot: Snapshot | null = null;
    let replayDraft = '';

    const writeEnabled = (on: boolean) => {
      enabled = on;
      io.set(STORAGE_KEY, on);
      emit('debug.enabled.changed', { on });
    };

    const writeRecording = (active: boolean) => {
      recording = active;
      emit('debug.recording.changed', { active, count: trace.length });
    };

    // ----- Toolbar contribution (visible only when enabled) --------------------
    // Approach: always contribute the "Debug" toggle. When enabled, the toggle
    // re-renders the toolbar and the additional buttons are conditionally
    // contributed below. Simpler than dynamic affordance contribute/withdraw:
    // we ALWAYS contribute the affordances; their `command.available` predicate
    // gates them when disabled.
    contribute({ surface: 'top', command: 'debug.enable', kind: 'button', text: '🐞 Debug', order: 70 });
    contribute({ surface: 'top', command: 'debug.record.start', kind: 'button', text: '● Rec', order: 71, className: 'debug-rec' });
    contribute({ surface: 'top', command: 'debug.record.stop', kind: 'button', text: '■ Stop', order: 72 });
    contribute({ surface: 'top', command: 'debug.record.clear', kind: 'button', text: 'Clear', order: 73 });
    contribute({ surface: 'top', command: 'debug.assert.open', kind: 'button', text: 'Assert', order: 74 });
    contribute({ surface: 'top', command: 'debug.replay.open', kind: 'button', text: 'Replay', order: 75 });

    // ----- Commands ------------------------------------------------------------
    contexts.commands.register([
      {
        id: 'debug.enable',
        label: 'Toggle debug tools',
        group: 'debug',
        payload: () => ({ on: !enabled }),
      },
      {
        id: 'debug.record.start',
        label: 'Start recording',
        group: 'debug',
        available: () => enabled && !recording,
      },
      {
        id: 'debug.record.stop',
        label: 'Stop recording',
        group: 'debug',
        available: () => enabled && recording,
      },
      {
        id: 'debug.record.clear',
        label: 'Clear recording',
        group: 'debug',
        available: () => enabled,
      },
      {
        id: 'debug.assert.open',
        label: 'Open assertion authoring',
        group: 'debug',
        available: () => enabled,
      },
      {
        id: 'debug.replay.open',
        label: 'Open replay modal',
        group: 'debug',
        available: () => enabled,
      },
      {
        id: 'debug.assert.pick',
        label: 'Pick assertion',
        group: 'debug',
        hidden: true,
        input: { on: 'click', selector: '[data-snapshot-pick]', prevent: true, stop: true },
        payload: ({ target }) => {
          const el = (target as HTMLElement | null)?.closest('[data-snapshot-pick]') as HTMLElement | null;
          if (!el) return undefined;
          return {
            code: el.dataset.code ?? '',
            matcher: el.dataset.matcher ?? 'toBe',
            expected: el.dataset.expected ?? '',
          };
        },
      },
      {
        id: 'debug.assert.search',
        label: 'Filter snapshot tree',
        group: 'debug',
        hidden: true,
        input: { on: 'input', selector: '.debug-assert .debug-search' },
        payload: ({ target }) => ({ query: (target as HTMLInputElement).value }),
      },
      {
        id: 'debug.assert.clear-asserts',
        label: 'Clear picked assertions',
        group: 'debug',
        hidden: true,
      },
      {
        id: 'debug.assert.copy',
        label: 'Copy generated test',
        group: 'debug',
        hidden: true,
      },
      {
        id: 'debug.assert.download',
        label: 'Download generated test',
        group: 'debug',
        hidden: true,
      },
      {
        id: 'debug.assert.replay',
        label: 'Replay recording in place',
        group: 'debug',
        hidden: true,
      },
      {
        id: 'debug.replay.run',
        label: 'Run pasted trace',
        group: 'debug',
        hidden: true,
        payload: () => {
          // Pull the current textarea value from the modal place — never reach
          // for the global document. Principle 5: render-adjacent DOM access
          // goes through contexts.places.
          const modalEl = contexts.places.el(Places.Modal);
          const textarea = modalEl?.querySelector('.debug-replay textarea') as HTMLTextAreaElement | null;
          if (textarea) replayDraft = textarea.value;
          return undefined;
        },
      },
    ]);

    // ----- Handlers ------------------------------------------------------------
    on('debug.enable', ({ on }) => writeEnabled(on));
    on('debug.record.start', () => {
      recorder.start();
      trace = [];
      writeRecording(true);
    });
    on('debug.record.stop', () => {
      trace = recorder.stop();
      writeRecording(false);
    });
    on('debug.record.clear', () => {
      trace = [];
      // If recording is active, reset the recorder buffer in place.
      if (recording) recorder.start();
      writeRecording(recording);
    });

    const renderTreeNode = (node: SnapshotNode, depth: number): HTMLElement => {
      const row = document.createElement('div');
      row.className = `debug-tree-row depth-${depth}`;
      row.dataset.path = node.code;
      const label = document.createElement('span');
      label.className = 'debug-tree-label';
      label.textContent = node.label;
      row.append(label);
      if (node.kind === 'literal') {
        const value = document.createElement('button');
        value.type = 'button';
        value.className = 'debug-tree-value';
        value.dataset.snapshotPick = '';
        value.dataset.code = node.code;
        value.dataset.matcher = node.value === null ? 'toBeNull' : node.value === undefined ? 'toBeUndefined' : 'toBe';
        value.dataset.expected = node.value === null || node.value === undefined ? '' : JSON.stringify(node.value);
        value.textContent = node.value === null ? 'null' : node.value === undefined ? 'undefined' : JSON.stringify(node.value);
        value.title = `Click → expect(${node.code}).${value.dataset.matcher}(${value.dataset.expected})`;
        row.append(value);
      } else if (node.kind === 'array') {
        const length = (node.value as unknown[]).length;
        const value = document.createElement('button');
        value.type = 'button';
        value.className = 'debug-tree-value debug-tree-array';
        value.dataset.snapshotPick = '';
        value.dataset.code = node.code;
        value.dataset.matcher = 'toHaveLength';
        value.dataset.expected = String(length);
        value.textContent = `Array(${length})`;
        value.title = `Click → expect(${node.code}).toHaveLength(${length})`;
        row.append(value);
      } else {
        const summary = document.createElement('span');
        summary.className = 'debug-tree-summary';
        summary.textContent = '{…}';
        row.append(summary);
      }
      return row;
    };

    const buildTree = (root: SnapshotNode, query: string): HTMLElement => {
      const list = document.createElement('div');
      list.className = 'debug-tree';
      const q = query.trim().toLowerCase();
      const flat = flattenSnapshotTree(root);
      const visible = q
        ? flat.filter(n => n.code.toLowerCase().includes(q) || n.label.toLowerCase().includes(q))
        : flat;
      visible.forEach(n => {
        // Depth derived from how many separators are in the code path — keeps
        // indentation roughly aligned with nesting.
        const depth = (n.code.match(/[.[]/g) || []).length;
        list.append(renderTreeNode(n, depth));
      });
      if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'debug-tree-empty';
        empty.textContent = `No matches for "${query}".`;
        list.append(empty);
      }
      return list;
    };

    const buildAssertModal = (): HTMLElement => {
      const snap = lastSnapshot ?? snapshot(ctx);
      lastSnapshot = snap;
      const tree = snapshotTree(snap);
      const wrap = document.createElement('section');
      wrap.className = 'debug-assert';

      const left = document.createElement('div');
      left.className = 'debug-state';
      const search = document.createElement('input');
      search.className = 'debug-search';
      search.placeholder = 'Filter state… (ctx.graphs.current.nodes…)';
      search.value = assertSearch;
      search.autofocus = true;
      left.append(search);
      left.append(buildTree(tree, assertSearch));
      wrap.append(left);

      const right = document.createElement('div');
      right.className = 'debug-test';
      const heading = document.createElement('div');
      heading.className = 'debug-test-head';
      const count = document.createElement('strong');
      count.textContent = `${trace.length} events captured · ${assertions.length} assertion${assertions.length === 1 ? '' : 's'}`;
      heading.append(count);
      const clearAsserts = document.createElement('button');
      clearAsserts.type = 'button';
      clearAsserts.dataset.command = 'debug.assert.clear-asserts';
      clearAsserts.textContent = 'Clear asserts';
      clearAsserts.className = 'icon-button';
      heading.append(clearAsserts);
      right.append(heading);

      const code = document.createElement('textarea');
      code.className = 'debug-code';
      code.spellcheck = false;
      code.readOnly = true;
      code.value = traceToTest({ trace, assertions });
      right.append(code);

      const actions = document.createElement('div');
      actions.className = 'debug-actions';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.command = 'debug.assert.copy';
      copy.textContent = 'Copy';
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.dataset.command = 'debug.assert.download';
      dl.textContent = 'Download .test.ts';
      const replay = document.createElement('button');
      replay.type = 'button';
      replay.dataset.command = 'debug.assert.replay';
      replay.textContent = 'Replay in place';
      actions.append(copy, dl, replay);
      right.append(actions);

      wrap.append(right);
      return wrap;
    };

    const reopenAssertModal = () => emit('modal.open', {
      title: 'Debug · author assertion',
      visual: 'panel',
      body: buildAssertModal,
    });

    on('debug.assert.open', () => {
      assertions = [];
      assertSearch = '';
      lastSnapshot = snapshot(ctx);
      reopenAssertModal();
    });

    on('debug.assert.pick', ({ code, matcher, expected }) => {
      assertions.push({ code, matcher, expected });
      reopenAssertModal();
    });

    on('debug.assert.search', ({ query }) => {
      assertSearch = query;
      // Re-render the tree only; leave the textarea alone so the user keeps
      // their scroll position. Cheap path: replace just the .debug-tree subtree.
      const modalEl = contexts.places.el(Places.Modal);
      const modalBody = modalEl?.querySelector('.debug-assert .debug-state');
      if (!modalBody) return;
      const tree = snapshotTree(lastSnapshot ?? snapshot(ctx));
      modalBody.querySelector('.debug-tree')?.remove();
      modalBody.querySelector('.debug-tree-empty')?.remove();
      modalBody.append(buildTree(tree, query));
    });

    on('debug.assert.clear-asserts', () => {
      assertions = [];
      reopenAssertModal();
    });

    on('debug.assert.copy', () => {
      const text = traceToTest({ trace, assertions });
      navigator.clipboard?.writeText(text).then(
        () => emit('app.notice', { message: 'Test copied to clipboard.', level: 'info' }),
        () => emit('app.notice', { message: 'Copy failed — see textarea.', level: 'warn' }),
      );
    });

    on('debug.assert.download', () => {
      const text = traceToTest({ trace, assertions });
      const blob = new Blob([text], { type: 'text/typescript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `recorded-${ts}.test.ts`;
      a.click();
      URL.revokeObjectURL(url);
    });

    on('debug.assert.replay', () => {
      ctx.sim.replay(trace);
      lastSnapshot = snapshot(ctx);
      reopenAssertModal();
    });

    on('debug.replay.open', () => {
      emit('modal.open', {
        title: 'Debug · paste & replay',
        visual: 'panel',
        body: () => {
          const wrap = document.createElement('section');
          wrap.className = 'debug-replay';
          const hint = document.createElement('p');
          hint.className = 'debug-replay-hint';
          hint.textContent = 'Paste a recorded trace (array of {name, data, at}) and Run.';
          wrap.append(hint);
          const textarea = document.createElement('textarea');
          textarea.spellcheck = false;
          textarea.placeholder = '[\n  { "name": "editing.node.create", "data": {}, "at": 0 }\n]';
          textarea.value = replayDraft || JSON.stringify(trace, null, 2);
          wrap.append(textarea);
          const actions = document.createElement('div');
          actions.className = 'debug-actions';
          const run = document.createElement('button');
          run.type = 'button';
          run.dataset.command = 'debug.replay.run';
          run.textContent = 'Run';
          run.className = 'primary';
          actions.append(run);
          wrap.append(actions);
          return wrap;
        },
      });
    });

    on('debug.replay.run', () => {
      let parsed: Trace;
      try {
        parsed = JSON.parse(replayDraft || '[]') as Trace;
      } catch (err) {
        emit('app.notice', { message: `Invalid JSON: ${(err as Error).message}`, level: 'error' });
        return;
      }
      if (!Array.isArray(parsed)) {
        emit('app.notice', { message: 'Trace must be a JSON array.', level: 'error' });
        return;
      }
      emit('modal.close');
      ctx.sim.replay(parsed);
      emit('app.notice', { message: `Replayed ${parsed.length} event${parsed.length === 1 ? '' : 's'}.`, level: 'info' });
    });

    // ----- Public devtool surface -----
    const api: DebugApi = {
      enabled: () => enabled,
      recording: () => recording,
      trace: () => trace.slice(),
      setEnabled: writeEnabled,
      start: () => { recorder.start(); trace = []; writeRecording(true); },
      stop: () => { trace = recorder.stop(); writeRecording(false); },
      clear: () => { trace = []; if (recording) recorder.start(); writeRecording(recording); },
      snapshot: () => snapshot(ctx),
      generate: (a = [], title) => traceToTest({ trace, assertions: a, title }),
    };
    ctx.expose('debug', api);

    // Surface initial state for any listener that boots after debug.
    on('app.start', () => emit('debug.enabled.changed', { on: enabled }));
  }, { requires: ['render', 'modal'] });
}
