import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootV2, settle } from '../v2-testkit';

const stylesText = readFileSync(resolve(process.cwd(), 'v2/styles.css'), 'utf8');

/**
 * Sibling of canvas-disappears-on-fold. Original symptom: toggling zen mode
 * (`\` / view.zen) made the canvas disappear entirely — zen hides .top and
 * .left and collapses row 1 / column 1 to 0, so the stage (the only grid item
 * left in flow) auto-placed into row 1 (`0px` tall) instead of row 2 (`1fr`).
 *
 * The fold fix pinned `.stage { grid-column: 2 }` but not the row. The zen fix
 * pins `.stage { grid-row: 2 }` so the placement survives BOTH hidden siblings.
 *
 * jsdom can't compute grid heights, so the regression assertion checks the
 * applied CSS rule (same approach as the fold test): "stage stays in row 2
 * when top+left are display:none" falls out of the explicit pin.
 */
describe('regression: zen mode keeps stage visible', () => {
  /** First `.stage { ... }` block — the layout declaration, not state
   *  modifiers like `.stage.panning`. */
  const stageDecl = (prop: string): string | undefined => {
    const match = stylesText.match(/\.stage\s*\{([^}]+)\}/);
    if (!match) return undefined;
    const decl = match[1].match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
    return decl?.[1].trim();
  };

  it('stage is explicitly pinned to grid-row 2 (and still column 2)', () => {
    expect(stageDecl('grid-row')).toBe('2');
    expect(stageDecl('grid-column')).toBe('2');
  });

  it('toggling zen marks the shell and keeps the stage mounted', async () => {
    const ctx = bootV2();
    await settle();

    // Replay the recorded user gesture — the `\` shortcut fires fold.toggle
    // with the shell.zen fold id (see systems/main.ts).
    ctx.sim.replay([
      { name: 'fold.toggle', data: { id: 'shell.zen' }, at: 0 },
    ]);
    await settle();

    const stage = ctx.contexts.places.el('stage');
    expect(stage).toBeTruthy();
    expect(stage!.parentElement?.dataset.zen).toBe('true');
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);

    // Toggle back out — `\` is the only exit, it must round-trip.
    ctx.sim.replay([
      { name: 'fold.toggle', data: { id: 'shell.zen' }, at: 0 },
    ]);
    await settle();
    expect(stage!.parentElement?.dataset.zen).toBe('false');
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(false);
  });
});
