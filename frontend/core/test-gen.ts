import type { Trace, TraceEvent } from './sim';

/** One assertion picked by the user from the snapshot tree. The matcher is
 *  applied directly: `expect(<code>).<matcher>(<expected>)`. The renderer of
 *  the assertion modal supplies both pieces; this module just stitches strings. */
export type Assertion = {
  /** TS expression from SnapshotNode.code. */
  code: string;
  /** Vitest matcher (`toBe`, `toEqual`, `toHaveLength`, `toBeNull`, etc.). */
  matcher: string;
  /** Pre-stringified expected value, or empty for matchers that take no arg. */
  expected: string;
};

export type TestGenOptions = {
  /** describe() title. Defaults to "recorded case". */
  title?: string;
  /** it() name. Defaults to "replays and asserts". */
  testName?: string;
  /** Recorded events. Filtered before stringification. */
  trace: Trace;
  /** Assertions to emit after the replay step. */
  assertions: Assertion[];
  /** Override which events survive filtering. Defaults to `defaultEventFilter`. */
  shouldInclude?: (event: TraceEvent) => boolean;
};

/** Strip events that would either fire as a downstream of something we already
 *  keep, or that are pure UI/paint coordination:
 *
 *   - `render.*`, `affordance.*`, `fold.*`, `commandModal.*`, `outline.*` — UI
 *   - `app.start`, `app.notice`, `decoration.changed` — boot/notices
 *   - `view.changed` — fact emitted after every view set
 *   - `*.created` / `.updated` / `.deleted` / `.switched` / `.selected` /
 *     `.focused` / `.changed` — facts (storage emits them in response to
 *     imperatives we keep)
 *   - `graph.node.*`, `graph.edge.*`, `graph.container.*` — downstream storage
 *     CRUD that the `editing.*` features will emit when replayed
 *   - `selection.node.*`, `focus.*` — downstream of `selection.item.select`
 *   - `item.update` / `item.update.batch` — emitted by drag/edit/nudge from their own intent events;
 *     replaying those events reproduces it
 *
 *  What survives is the user-intent slice: `editing.*`, `commandForm.submit`,
 *  `commandPicker.*`, `selection.item.select`, `selection.item.delete`,
 *  top-level graph CRUD (`graph.create`, `graph.switch`, `graph.delete`),
 *  view commands, layout commands, modal toggles, jump/picker steps.
 *  Replaying that exact set drives the same lifecycle as the original
 *  recording without doubling the storage calls. */
export function defaultEventFilter(event: TraceEvent): boolean {
  const name = String(event.name);
  if (name.startsWith('render.')) return false;
  if (name.startsWith('affordance.')) return false;
  if (name.startsWith('fold.changed')) return false;
  if (name.startsWith('commandModal.')) return false;
  if (name.startsWith('outline.')) return false;
  if (name.startsWith('focus.')) return false;
  if (name === 'view.changed') return false;
  if (name === 'app.notice') return false;
  if (name === 'app.start') return false;
  if (name === 'decoration.changed') return false;
  if (name === 'item.update' || name === 'item.update.batch') return false;
  // Downstream storage CRUD — re-fired by the editing.* feature flow.
  if (/^graph\.(node|edge|container)\.(create|update|delete)$/.test(name)) return false;
  // Downstream of selection.item.select.
  if (/^selection\.(node|item)\.(selected|cleared)$/.test(name)) return false;
  if (/^selection\.node\.(select|clear)$/.test(name)) return false;
  // Container facts + nested downstream.
  if (/^container\.(children|collapsed)\.changed$/.test(name)) return false;
  // Generic fact suffixes — storage emits them after imperatives.
  if (/\.(created|updated|deleted|switched|selected|focused|changed)$/.test(name)) return false;
  return true;
}

const indent = (text: string, spaces: number): string => {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(line => line ? pad + line : line).join('\n');
};

/** Render a value for inclusion in generated source. Wraps strings/numbers via
 *  JSON.stringify; `undefined` becomes the literal `undefined`. */
const renderValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  try { return JSON.stringify(value); } catch { return 'undefined'; }
};

/** Convert a recorded trace + chosen assertions into a complete vitest file
 *  string. The output is self-contained and runnable from `tests/commands/`
 *  using the existing `bootApp` testkit. */
export function traceToTest(opts: TestGenOptions): string {
  const title = opts.title ?? 'recorded case';
  const testName = opts.testName ?? 'replays and asserts';
  const filter = opts.shouldInclude ?? defaultEventFilter;
  const filteredTrace = opts.trace.filter(filter);

  const traceLines = filteredTrace.map(event =>
    `  { name: ${JSON.stringify(event.name)}, data: ${renderValue(event.data)}, at: 0 },`,
  ).join('\n');

  const assertLines = opts.assertions.length
    ? opts.assertions.map(a => {
        const head = `expect(${a.code}).${a.matcher}`;
        return a.expected.length ? `    ${head}(${a.expected});` : `    ${head}();`;
      }).join('\n')
    : '    // TODO: click leaves in the snapshot tree to add assertions';

  return `import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';

const trace = [
${indent(traceLines, 0)}
];

describe('${title}', () => {
  it('${testName}', async () => {
    const ctx = bootApp();
    await settle();

    ctx.sim.replay(trace);
    await settle();

${assertLines}
  });
});
`;
}
