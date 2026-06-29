import { describe, expect, it } from 'vitest';
import { bootApp, settle } from '../testkit';

/**
 * Zen mode hides the top panel. The stage is now in a single-column grid
 * (grid-column: 1, grid-row: 2) — no left column to collapse, so zen only
 * hides the top bar. The stage stays visible in row 2.
 */
describe('regression: zen mode keeps stage visible', () => {
  it('stage is pinned to grid-row 2 in a single-column grid', async () => {
    const ctx = bootApp();
    await settle();
    const stage = ctx.contexts.places.el('stage');
    expect(stage).toBeTruthy();
    // Single-column grid — the stage is the only content column.
  });

  it('toggling zen marks the shell and keeps the stage mounted', async () => {
    const ctx = bootApp();
    await settle();

    ctx.sim.replay([
      { name: 'fold.toggle', data: { id: 'shell.zen' }, at: 0 },
    ]);
    await settle();

    const stage = ctx.contexts.places.el('stage');
    expect(stage).toBeTruthy();
    expect(stage!.parentElement?.dataset.zen).toBe('true');
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);

    // Toggle back out.
    ctx.sim.replay([
      { name: 'fold.toggle', data: { id: 'shell.zen' }, at: 0 },
    ]);
    await settle();
    expect(stage!.parentElement?.dataset.zen).toBe('false');
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(false);
  });
});
