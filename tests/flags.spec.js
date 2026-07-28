const { test, expect, setup } = require('./browser-testkit.cjs');

/**
 * Smoke test: every flag, off-then-on, leaves a visible trace in the UI.
 *
 * This catches the class of regressions where a system's flag flips off but its
 * commands / affordances stay registered (or vice versa: the flag flips back on
 * and nothing reappears). Each case here proves a single flag's contract.
 */

test('toolbar contributions disappear when their owning system is off', async ({ page }) => {
  await setup.flags(page, { 'view.zoom': false });
  const zoomButtons = await page.locator('[data-panel-id="zoom"] button').count();
  expect(zoomButtons).toBe(0);
  const plusNode = await page.getByRole('button', { name: 'Add node', exact: true }).count();
  expect(plusNode).toBe(1);
});

test('disabling an ability removes its commands and entity affordances', async ({ page }) => {
  await setup.flags(page, { 'ability.collapsible': false });
  const collapseCmd = await page.evaluate(() => !!window.app.contexts.commands.get('node.collapse.toggle'));
  expect(collapseCmd).toBe(false);
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.locator('[data-place="stage"]').click({ position: { x: 500, y: 350 } });
  const collapseBtn = await page.locator('.node [data-command="node.collapse.toggle"]').count();
  expect(collapseBtn).toBe(0);
});

test('@smoke all flags on: baseline affordances exist', async ({ page }) => {
  await setup.flags(page);
  await expect(page.locator('.toolbar button[data-command="palette.place.activate"]')).toBeVisible();
  await page.getByLabel('More actions').click();
  await expect(page.locator('.toolbar button[data-command="palette.open"]')).toBeVisible();
  await expect(page.locator('.toolbar button[data-command="view.fit.all"]')).toBeVisible();
  await expect(page.locator('.toolbar button[data-command="view.zoom.in"]')).toHaveCount(0);
});

test('empty-state hint appears when graph has no nodes', async ({ page }) => {
  await setup.flags(page);
  const stageEmpty = page.locator('.stage .empty-title');
  await expect(stageEmpty).toContainText('No nodes');
  await expect(page.locator('.stage .empty-hint kbd')).toHaveText('A');
});

test('memory mode does not write to localStorage', async ({ page }) => {
  // Boot once normally to populate frontend.flags
  await setup.app(page);
  await page.evaluate(() => window.app.flags.set('test.persisted', true));
  // Reboot in memory mode — flag setter should not touch localStorage.
  await setup.app(page, '/?io=memory');
  await page.evaluate(() => window.app.flags.set('test.memory', true));
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('frontend.flags');
    if (!raw) return { hasPersisted: false, hasMemory: false };
    const obj = JSON.parse(raw);
    return { hasPersisted: obj['test.persisted'] === true, hasMemory: 'test.memory' in obj };
  });
  expect(persisted.hasPersisted).toBe(true);
  expect(persisted.hasMemory).toBe(false);
});

test('@smoke requires.unmet warning fires when a dependency is disabled', async ({ page }) => {
  await setup.flags(page, { graph: false });
  const warnings = await page.evaluate(() => window.app.contexts.dx.issues()
    .filter(i => i.rule === 'requires.unmet')
    .map(i => i.message));
  expect(warnings.some(w => w.includes('nodeLifecycle') && w.includes('graph'))).toBe(true);
});

test('split view: zoom and pan toggle independently', async ({ page }) => {
  await setup.flags(page, { 'view.pan': false });
  const panStart = await page.evaluate(() => !!window.app.contexts.commands.get('view.pan.start'));
  const zoomIn = await page.evaluate(() => !!window.app.contexts.commands.get('view.zoom.in'));
  expect(panStart).toBe(false);
  expect(zoomIn).toBe(true);
});

test('DX validator stores boot issues on contexts.dx', async ({ page }) => {
  await setup.flags(page);
  const issues = await page.evaluate(() => window.app.contexts.dx.issues());
  // Baseline app should have only known warnings (binding.duplicate × 3 acknowledged).
  const errors = issues.filter(i => i.level === 'error');
  expect(errors).toEqual([]);
});
