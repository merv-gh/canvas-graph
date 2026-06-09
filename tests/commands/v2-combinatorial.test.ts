import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';
import type { AppCtx } from '../../v2/core';

/**
 * Combinatorial action graph — exhaustive sweep.
 *
 * The model derives the action set from `commands.all()` at boot. We:
 *   1. List every command that is visible, available without a target, and
 *      doesn't open a form/picker (the picker would block on user input).
 *   2. For each length-1 sequence: boot fresh, run command, assert the app
 *      didn't crash and gained no NEW DX errors.
 *   3. For each length-2 sequence: same, with two commands in a row.
 *
 * Pass = no exception + no new DX errors + snapshot stable.
 * Fail = report the offending sequence with the captured state.
 *
 * This is the "test all reachable states" net. Adding a new entity / system /
 * ability automatically expands the sweep — no manual sequence list.
 */

/** State summary captured after a sequence runs. Diff-friendly for snapshots. */
type Snapshot = {
  nodes: number;
  edges: number;
  containers: number;
  selected: string | null;
  focused: string | null;
  scale: number;
  dxErrors: number;
};

const snapshotOf = (ctx: AppCtx): Snapshot => ({
  nodes: ctx.graphs.current.nodes().length,
  edges: ctx.graphs.current.edges().length,
  containers: (ctx.graphs.current.itemsOfKind('container') as unknown[]).length,
  selected: ctx.selection.selected() ? `${ctx.selection.selected()!.kind}:${ctx.selection.selected()!.id}` : null,
  focused: ctx.selection.focused() ? `${ctx.selection.focused()!.kind}:${ctx.selection.focused()!.id}` : null,
  scale: Math.round((ctx.contexts.view.get().scale ?? 1) * 100) / 100,
  dxErrors: ctx.dx?.run().filter(i => i.level === 'error').length ?? 0,
});

/** Command is auto-runnable when:
 *  - it's not hidden,
 *  - it doesn't require a form/picker (those need user keystrokes),
 *  - its `available` predicate returns true on a fresh boot. */
const isAutoRunnable = (ctx: AppCtx, id: string) => {
  const c = ctx.contexts.commands.get(id);
  if (!c) return false;
  if (c.hidden) return false;
  if (c.form || c.picker) return false;
  if (c.available && !c.available()) return false;
  return true;
};

/** All commands that compose the auto-runnable action graph for length-1. */
const autoRunnableAtBoot = (ctx: AppCtx) =>
  ctx.contexts.commands.all().map(c => c.id).filter(id => isAutoRunnable(ctx, id));

/** Run a sequence in a fresh boot. Returns the post-state snapshot, or throws
 *  with the offending step labeled. */
const runSequence = async (sequence: string[]): Promise<Snapshot> => {
  const ctx = bootV2();
  await settle();
  for (const id of sequence) {
    try {
      runCommand(ctx, id);
      await settle();
    } catch (err) {
      throw new Error(`Step "${id}" threw: ${(err as Error).message}\nSequence so far: ${sequence.join(' → ')}`);
    }
  }
  return snapshotOf(ctx);
};

describe('combinatorial action graph', () => {
  const probe = bootV2();
  const commands = autoRunnableAtBoot(probe);

  describe('length-1: every auto-runnable command boots and runs', () => {
    commands.forEach(id => {
      it(`runs [${id}]`, async () => {
        const snap = await runSequence([id]);
        // Boot baseline has 0 DX errors; running one auto-runnable command
        // shouldn't introduce any.
        expect(snap.dxErrors, `[${id}] introduced DX errors`).toBe(0);
        // Smoke-snapshot the resulting state. Updates flag intentional changes.
        expect({ sequence: [id], snap }).toMatchSnapshot();
      });
    });
  });

  describe('length-2: every pair of auto-runnable commands composes', () => {
    // Skip pair sweep when there are too many — keeps the suite under a minute.
    // 14 commands × 14 pairs = 196 in current shape; fine.
    const pairs = commands.flatMap(a => commands.map(b => [a, b] as [string, string]));
    pairs.forEach(([a, b]) => {
      it(`runs [${a} → ${b}]`, async () => {
        const snap = await runSequence([a, b]);
        expect(snap.dxErrors, `[${a} → ${b}] introduced DX errors`).toBe(0);
      });
    });
  });

  it('enumerates the auto-runnable command set (for visibility)', () => {
    // This test only exists so the contributor sees the live action set in
    // the report. If a new system adds a runnable command, the snapshot here
    // changes and the maintainer reviews it.
    expect(commands.sort()).toMatchSnapshot();
  });
});
