// Browser coverage for landed layout/focus tasks. Each dx `layout` task lands
// a tests/commands/dx/<id>.layout.json ({steps, asserts}); this spec runs every
// one through the SAME oracle the dx loop used (dx/ollama-runner/layout-probe.mjs), so a
// fix proven in the loop is permanently guarded by `npm run test:browser`.
//
// jsdom can't see focus/geometry/computed-style — these run in real Chromium.
// (Playwright transpiles specs to CJS, so the ESM oracle is loaded via dynamic
// import() inside the test, and paths come from process.cwd(), not import.meta.)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const SPEC_DIR = join(process.cwd(), 'tests', 'commands', 'dx');
const specs = existsSync(SPEC_DIR)
  ? readdirSync(SPEC_DIR).filter(name => name.endsWith('.layout.json'))
  : [];

for (const file of specs) {
  const spec = JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8'));
  test(`layout: ${spec.title ?? file}`, async ({ page }) => {
    const { runLayoutProbe } = await import('../dx/ollama-runner/layout-probe.mjs');
    await page.goto('/?io=memory');
    await page.waitForFunction(() => !!(window as unknown as { app?: unknown }).app, undefined, { timeout: 8000 });
    const { pass, results } = await runLayoutProbe(page, spec);
    const failed = results.filter(r => !r.ok).map(r => `${r.label} — actual: ${JSON.stringify(r.actual)}`);
    expect(pass, `layout oracle failed:\n${failed.join('\n')}`).toBe(true);
  });
}

// Keep the file non-empty so Playwright doesn't error when no layout task has
// landed yet (a spec file that defines zero tests is treated as an error).
if (!specs.length) {
  test('layout: no landed layout specs yet', () => {
    expect(specs.length).toBe(0);
  });
}
