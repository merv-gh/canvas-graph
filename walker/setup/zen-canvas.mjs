// Re-introduce the zen-mode canvas bug in a workspace copy: remove the
// grid-row pins (the fix) and the regression test that encodes it.
// The snapshot `ui.shell.zen` field stays — observability is not the fix.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXED_STAGE_HEAD = `.stage {
  /* Pin the stage to column 2 AND row 2 explicitly. Without the column pin,
     hiding \`.left\` via \`display: none\` removes it from grid auto-flow and the
     stage drops into column 1 (which collapses to 0px when the panel folds).
     Without the row pin, zen mode (\`display: none\` on .top + .left) auto-flows
     the stage into row 1 — which zen collapses to 0px height. */
  grid-column: 2;
  grid-row: 2;`;

const BROKEN_STAGE_HEAD = `.stage {
  /* Pin the stage to column 2 explicitly. Without this, hiding \`.left\` via
     \`display: none\` removes it from grid auto-flow and the stage drops into
     column 1 (which collapses to 0px when the panel folds). */
  grid-column: 2;`;

export async function setup(wsDir) {
  const cssPath = join(wsDir, 'v2/styles.css');
  let css = readFileSync(cssPath, 'utf8');

  const replaceOnce = (from, to, label) => {
    if (!css.includes(from)) throw new Error(`zen-canvas setup: cannot find ${label} — styles.css drifted, update walker/setup/zen-canvas.mjs`);
    css = css.replace(from, to);
  };
  replaceOnce(FIXED_STAGE_HEAD, BROKEN_STAGE_HEAD, 'fixed .stage block');
  replaceOnce('  grid-column: 1 / -1;\n  grid-row: 1;\n', '  grid-column: 1 / -1;\n', '.top grid-row pin');
  replaceOnce('  grid-column: 1;\n  grid-row: 2;\n', '  grid-column: 1;\n', '.left grid-row pin');
  writeFileSync(cssPath, css);

  rmSync(join(wsDir, 'tests/commands/recorded/canvas-disappears-on-zen.test.ts'), { force: true });
}
