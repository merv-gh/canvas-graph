import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootV2, settle } from '../v2-testkit';

const stylesText = readFileSync(resolve(process.cwd(), 'v2/styles.css'), 'utf8');

/**
 * Discovered via the in-app debug recorder. Original symptom: folding the left
 * panel made the canvas (stage) disappear — the user saw nothing on the right
 * of the hamburger. Snapshot showed:
 *
 *   ui.places.stage.width    : 0
 *   ui.shell.leftFolded      : true
 *   ui.stage.emptyStateVisible : true   ← DOM is fine, layout collapsed
 *
 * Root cause: `.left { display: none }` removed the left grid item from
 * auto-flow; `.stage` then auto-placed into column 1 (`0px`) instead of
 * column 2 (`1fr`). The fix pins `.stage { grid-column: 2 }` and `.left
 * { grid-column: 1 }` so the placement survives a folded sibling.
 *
 * jsdom can't compute grid widths, so the regression assertion checks the
 * applied CSS rule rather than `getBoundingClientRect()`. The same intent —
 * "stage stays in column 2 when left is folded" — falls out of either.
 */
describe('regression: left panel collapse keeps stage visible', () => {
  /** jsdom doesn't load external stylesheets, so read the source. The rule we
   *  care about is the *first* `.stage { ... }` block — the one that declares
   *  layout, not state-modifier rules like `.stage.panning`. */
  const stageGridColumn = (): string | undefined => {
    const match = stylesText.match(/\.stage\s*\{([^}]+)\}/);
    if (!match) return undefined;
    const block = match[1];
    const decl = block.match(/grid-column\s*:\s*([^;]+);/);
    return decl?.[1].trim();
  };

  it('stage is explicitly pinned to grid-column 2', async () => {
    const ctx = bootV2();
    await settle();
    void ctx;
    // The fix: .stage must have an explicit grid-column declaration so it
    // can't auto-flow into the folded column.
    expect(stageGridColumn()).toBe('2');
  });

  it('folding the left panel marks the shell and keeps the stage mounted', async () => {
    const ctx = bootV2();
    await settle();

    // Replay the recorded user gesture — clicking the hamburger.
    ctx.sim.replay([
      { name: 'fold.toggle', data: { id: 'outline.panel' }, at: 0 },
    ]);
    await settle();

    const stage = ctx.contexts.places.el('stage');
    expect(stage).toBeTruthy();
    expect(stage!.parentElement?.dataset.leftFolded).toBe('true');
    // The empty-state placeholder lives on the stage — its mere DOM presence
    // doesn't catch the original bug, but combined with the grid-column rule
    // above it does.
    expect(stage!.querySelector('.empty')).not.toBeNull();
  });

  it('snapshot.ui.shell.leftFolded flips with the fold toggle', async () => {
    const ctx = bootV2();
    await settle();
    expect(ctx.debug!.snapshot().ui.shell.leftFolded).toBe(false);
    ctx.sim.replay([{ name: 'fold.toggle', data: { id: 'outline.panel' }, at: 0 }]);
    await settle();
    expect(ctx.debug!.snapshot().ui.shell.leftFolded).toBe(true);
    expect(ctx.debug!.snapshot().ui.stage.emptyStateVisible).toBe(true);
  });
});
