const { test, expect } = require('@playwright/test');

const expectModelNodeCount = async (page, count) => {
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(count);
};

test('nested C4 document survives reload and share', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  await expect(page.locator('.container')).toHaveCount(2);
  await expectModelNodeCount(page, 5);
  await expect(page.locator('.save-state')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.container')).toHaveCount(2);
  await expectModelNodeCount(page, 5);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const url = await page.getByRole('textbox', { name: 'Share link', exact: true }).inputValue();
  const copy = await context.newPage();
  await copy.goto(url);
  await expect(copy.locator('.container')).toHaveCount(2);
  await expectModelNodeCount(copy, 5);
});

test('Mermaid import validates, previews, and remains undoable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect(page.locator('.node')).toHaveCount(1);

  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByLabel('Mermaid flowchart source').fill('flowchart LR\nA -->');
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.locator('.import-preview')).toHaveCount(0);
  await expect(page.locator('.node')).toHaveCount(1);

  await page.getByLabel('Mermaid flowchart source').fill('flowchart LR\nA[Draft] --> B[Published]');
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.locator('.import-preview')).toContainText('2 nodes and 1 edge');
  await page.getByRole('button', { name: 'Replace graph' }).click();
  await expect(page.locator('.node')).toHaveCount(2);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.node')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.node')).toHaveCount(2);
});

test('phone starts canvas-first with usable primary commands', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.graph-navigator')).toHaveAttribute('data-outline-folded', 'true');
  await expect(page.getByRole('button', { name: 'Expand graph navigator' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show editing actions' })).toBeVisible();
  const navigatorWidth = await page.locator('.graph-navigator').evaluate(element => element.getBoundingClientRect().width);
  expect(navigatorWidth).toBeLessThan(220);
  const toolbar = await page.locator('.tool-panel[data-anchor="top-center"]').boundingBox();
  const navigator = await page.locator('.graph-navigator').boundingBox();
  expect(toolbar.x).toBeGreaterThanOrEqual(7);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(383);
  expect(navigator.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height + 4);
  expect(navigator.height).toBeLessThan(50);
  await page.getByRole('button', { name: 'Show editing actions' }).click();
  await expect(page.getByRole('button', { name: 'Add node', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search commands and graph items (P)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open getting-started guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('edge picker accepts a target click and explains the active mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  const nodes = page.locator('.node');
  await expect(nodes).toHaveCount(2);
  await nodes.nth(0).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.picker-prompt')).toContainText('Click a highlighted item or press its letter');
  await nodes.nth(1).click();
  await expect(page.locator('.edge-line')).toHaveCount(1);
  await expect(page.locator('.app-notice')).toHaveText('Edge created.');
});

test('edge picker never leaks into a new graph', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.picker-prompt')).toBeVisible();
  await page.locator('.top-tool-panel [data-command="graph.create"]').click();
  await expect(page.locator('.picker-prompt')).toHaveCount(0);
  await expect(page.locator('[data-place="stage"] > .empty')).toContainText('No nodes in this graph yet');
});

test('fit control reports actual zoom after fitting a large document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  const reset = page.locator('[data-command="view.zoom.reset"]');
  await expect(reset).not.toHaveText('100%');
  await expect(reset).toHaveAttribute('aria-label', /current \d+%/);
});

test('phone fit ignores overlay navigator width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  const percent = Number((await page.locator('[data-command="view.zoom.reset"]').textContent()).replace('%', ''));
  expect(percent).toBeGreaterThanOrEqual(42);
});

test('phone chrome stays legible and touch-sized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const navigator = page.getByRole('button', { name: 'Expand graph navigator' });
  const navigatorBox = await navigator.boundingBox();
  expect(navigatorBox.height).toBeGreaterThanOrEqual(36);
  await page.getByRole('button', { name: 'Show editing actions' }).click();
  const primary = page.getByRole('button', { name: 'Add node', exact: true });
  const primaryBox = await primary.boundingBox();
  expect(primaryBox.height).toBeGreaterThanOrEqual(40);
  const touchTargets = await page.locator('.top-tool-panel button, [data-panel-id="zoom"] button, [data-panel-id="layout"] button').evaluateAll(
    buttons => buttons.filter(button => button.getClientRects().length).map(button => button.getBoundingClientRect().height),
  );
  expect(Math.min(...touchTargets)).toBeGreaterThanOrEqual(40);
  await page.getByRole('button', { name: 'Show editing actions' }).click();
  await navigator.click();
  await expect(page.getByRole('button', { name: 'Collapse graph navigator' })).toBeVisible();
});

test('export dialog exposes backup and image formats', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Canvas Graph JSON' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SVG' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PNG' })).toBeVisible();
});

test('SVG and PNG exports produce downloadable files', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG' }).click();
  expect((await svgDownload).suggestedFilename()).toMatch(/\.svg$/);
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);
});

test('deleting a graph requires explicit confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  await page.locator('.graph-nav-create').click();
  const remove = page.locator('.graph-nav-delete');
  await expect(remove).toHaveCount(1);
  await remove.click();
  await expect(page.locator('.delete-preview')).toContainText('cannot be undone');
  await page.getByRole('button', { name: 'Keep graph' }).click();
  await expect(page.locator('.graph-nav-delete')).toHaveCount(1);

  await page.locator('.graph-nav-delete').click();
  await page.getByRole('button', { name: 'Delete graph', exact: true }).click();
  await expect(page.locator('.graph-nav-delete')).toHaveCount(0);
});

test('deleting a populated container warns and offers ungroup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  // Oversized Fit deliberately leaves lower content off-screen at 80%.
  // Address the container through the navigator, which also frames it before
  // exposing contextual deletion.
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  await page.locator('.graph-nav-item[data-item-kind="container"]').first().click();
  await expect(page.locator('.item-toolbar')).toHaveAttribute('data-item-kind', 'container');
  await page.keyboard.press('x');
  await expect(page.getByRole('dialog', { name: 'Delete container?' })).toBeVisible();
  await expect(page.locator('.container-delete-preview')).toContainText('cannot be undone');
  await expect(page.locator('.container-delete-preview')).toContainText('Ungroup and keep contents');
  await page.getByRole('button', { name: 'Keep container' }).click();
  await expect(page.locator('.container')).toHaveCount(2);
  await expectModelNodeCount(page, 5);
});

test('selected edges expose a nearby editor with connection actions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  // At fit-to-document zoom, the navigator is the reliable, intended route
  // for selecting a fine connection without pixel-level hit testing.
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  await page.locator('.graph-nav-item[data-item-kind="edge"]').first().click();
  const edit = page.locator('.item-toolbar [data-command="item.properties.open"]');
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole('button', { name: 'Reverse direction' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete connection' })).toBeVisible();
});

test('mobile selected-item toolbar stays fully reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  // The reading-scale floor intentionally leaves the far end off-screen.
  // Select it through the addressable navigator, which frames it first.
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  await page.locator('.graph-nav-item[data-item-kind="node"]')
    .filter({ hasText: 'Payment provider' }).click();

  const toolbar = page.locator('.item-toolbar');
  await expect(toolbar).toBeVisible();
  const box = await toolbar.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(382);
});

test('previous-save recovery stays in command search, not export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.save-state')).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.export-json [data-command="io.backup.restore.request"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Search commands and graph items (P)' }).click();
  await page.getByRole('button', { name: 'Restore previous browser save', exact: true }).click();
  await expect(page.locator('.restore-preview')).toContainText('Current graphs will be replaced');
});
