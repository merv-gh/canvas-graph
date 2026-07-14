import {
  snapshot,
  snapshotTree,
  traceToTest,
  type Assertion,
  type Registry,
  type Snapshot,
} from '../core';
import { Places } from '../types';
import type { Trace } from '../core';
import { buildDebugAssertView, buildDebugReplayView, buildDebugTree } from './debug-views';

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
    'debug.assert.edit': { code: string };
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

/** Devtools/test surface exposed via window.app.debug. Lets a Playwright test
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

const STORAGE_KEY = 'frontend.debug.enabled';

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
    /** Manual edits to the generated test. When non-null, takes over the
     *  textarea instead of the auto-generated string — lets the user flip
     *  captured-actual into desired-actual (e.g. `toBe(false)` → `toBe(true)`)
     *  to encode a regression. New picks re-generate from scratch (clearing
     *  the override), so the convention is "pick, then edit". */
    let manualOverride: string | null = null;

    const writeEnabled = (on: boolean) => {
      enabled = on;
      io.set(STORAGE_KEY, on);
      emit('debug.enabled.changed', { on });
    };

    const writeRecording = (active: boolean) => {
      recording = active;
      emit('debug.recording.changed', { active, count: trace.length });
    };

    // Debug is a developer surface: its commands stay registered (palette,
    // scenario, tests) but are no longer contributed as top-toolbar buttons —
    // the release top bar is graph editing + layout + zen + search only.
    void contribute;

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
        id: 'debug.assert.edit',
        label: 'Edit generated test',
        group: 'debug',
        hidden: true,
        input: { on: 'input', selector: '.debug-assert .debug-code' },
        payload: ({ target }) => ({ code: (target as HTMLTextAreaElement).value }),
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

    const buildAssertModal = (): HTMLElement => {
      const snap = lastSnapshot ?? snapshot(ctx);
      lastSnapshot = snap;
      return buildDebugAssertView({
        tree: snapshotTree(snap),
        query: assertSearch,
        traceCount: trace.length,
        assertionCount: assertions.length,
        code: manualOverride ?? traceToTest({ trace, assertions }),
      });
    };

    const reopenAssertModal = () => emit('modal.open', {
      title: 'Debug · author assertion',
      visual: 'panel',
      body: buildAssertModal,
    });

    on('debug.assert.open', () => {
      assertions = [];
      assertSearch = '';
      manualOverride = null;
      lastSnapshot = snapshot(ctx);
      reopenAssertModal();
    });

    on('debug.assert.pick', ({ code, matcher, expected }) => {
      assertions.push({ code, matcher, expected });
      // A new pick invalidates the manual override — auto-regenerate so the
      // user sees the new assertion appended. They can edit again afterward.
      manualOverride = null;
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
      modalBody.append(buildDebugTree(tree, query));
    });

    on('debug.assert.edit', ({ code }) => {
      manualOverride = code;
    });

    on('debug.assert.clear-asserts', () => {
      assertions = [];
      manualOverride = null;
      reopenAssertModal();
    });

    /** Pull the text currently in the textarea — that's the user's
     *  authoritative version (auto-generated or hand-edited). Falls back to a
     *  fresh generation when the modal isn't mounted. */
    const currentTestText = (): string => {
      const modalEl = contexts.places.el(Places.Modal);
      const textarea = modalEl?.querySelector('.debug-code') as HTMLTextAreaElement | null;
      if (textarea) return textarea.value;
      return manualOverride ?? traceToTest({ trace, assertions });
    };

    on('debug.assert.copy', () => {
      const text = currentTestText();
      navigator.clipboard?.writeText(text).then(
        () => emit('app.notice', { message: 'Test copied to clipboard.', level: 'info' }),
        () => emit('app.notice', { message: 'Copy failed — see textarea.', level: 'warn' }),
      );
    });

    on('debug.assert.download', () => {
      const text = currentTestText();
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
        body: () => buildDebugReplayView(replayDraft || JSON.stringify(trace, null, 2)),
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
