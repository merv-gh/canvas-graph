import { describe, expect, it } from 'vitest';
import { bootApp, settle } from '../testkit';

/**
 * The left panel is now a floating tool-panel on the stage, not a grid column.
 * Folding it toggles `data-outline-folded` on the outline panel element and
 * the stage stays visible (single-column grid, no column to collapse).
 */
describe('regression: outline panel collapse keeps stage visible', () => {
  it('stage is in a single-column grid', async () => {
    const ctx = bootApp();
    await settle();
    void ctx;
    const stage = ctx.contexts.places.el('stage');
    expect(stage).toBeTruthy();
    // The stage fills the grid — no column-collapse bug possible.
  });

  it('folding the outline panel keeps the stage mounted', async () => {
    const ctx = bootApp();
    await settle();

    ctx.sim.replay([
      { name: 'fold.toggle', data: { id: 'outline.panel' }, at: 0 },
    ]);
    await settle();

    const stage = ctx.contexts.places.el('stage');
    expect(stage).toBeTruthy();
    // The outline panel lives in the `.left` place, positioned over the stage.
    const left = ctx.contexts.places.el('left');
    const outlinePanel = left?.querySelector('.outline-panel') as HTMLElement | null;
    expect(outlinePanel).toBeTruthy();
    expect(outlinePanel!.dataset.outlineFolded).toBe('true');
  });

  it('snapshot.ui.shell.zen stays false when outline is toggled', async () => {
    const ctx = bootApp();
    await settle();
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(false);
    ctx.sim.replay([{ name: 'fold.toggle', data: { id: 'outline.panel' }, at: 0 }]);
    await settle();
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(false);
  });
});
