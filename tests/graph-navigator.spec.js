const { test, expect, setup, openPaletteDrawer, openTypeCatalog } = require('./browser-testkit.cjs');

test('graph drawer stays graph-only and searches graph names', async ({ page }) => {
  await setup.app(page);
  await page.evaluate(() => window.app.contexts.commands.run('graph.create'));
  await openPaletteDrawer(page);
  await expect(page.locator('.graph-navigator input[type="search"]')).toHaveCount(1);
  await expect(page.locator('.tool-panel[data-panel-id="palette"]')).toBeVisible();
  await expect(page.locator('[data-fold-id="palette.catalog"]')).toContainText('Change type · Text');
  await expect(page.locator('.graph-nav-list .graph-nav-card')).toHaveCount(2);
  await expect(page.locator('.graph-nav-list .graph-nav-card').first()).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.graph-nav-list button').first()).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('.graph-nav-choose strong')).toHaveCount(0);
  await expect(page.locator('.graph-nav-name')).toHaveCount(2);
  await expect(page.locator('.graph-nav-list .graph-nav-item')).toHaveCount(0);
  await expect(page.locator('.graph-nav-create')).toHaveCount(1);
  await expect(page.locator('.graph-nav-duplicate, .graph-nav-duplicate-current')).toHaveCount(0);
  await expect(page.locator('.graph-nav-card.active .graph-nav-choose')).toBeDisabled();
  const search = page.locator('[data-graph-nav-search]');
  await search.fill('Graph 2');
  await expect(page.locator('.graph-nav-list .graph-nav-card')).toHaveCount(1);
  await expect(page.locator('.graph-nav-list .graph-nav-card')).toContainText('Graph 2');
});

test('new graph sits beside search and the current graph is a no-op', async ({ page }) => {
  await setup.app(page);
  const state = await page.evaluate(() => {
    window.app.contexts.commands.run('editing.node.create');
    return { graphId: window.app.graphs.current.id, selected: window.app.selection.selected() };
  });
  await openPaletteDrawer(page);
  const current = page.locator('.graph-nav-card.active .graph-nav-choose');
  await expect(current).toBeDisabled();
  await current.evaluate(element => element.click());
  await expect.poll(() => page.evaluate(() => ({
    graphId: window.app.graphs.current.id,
    selected: window.app.selection.selected(),
  }))).toEqual(state);

  await page.getByRole('button', { name: 'New graph', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.app.graphs.all().length)).toBe(2);
  await expect.poll(() => page.evaluate(id => window.app.graphs.current.id !== id, state.graphId)).toBe(true);
  await expect(page.locator('[data-panel-id="palette"]')).toBeVisible();
});

test('drawer disclosure keeps toolbar fixed and graph list bounded', async ({ page }) => {
  await setup.app(page);
  const toolbar = page.locator('.tool-panel[data-anchor="top-center"]');
  const before = await toolbar.boundingBox();
  await openPaletteDrawer(page);
  const after = await toolbar.boundingBox();
  expect(Math.abs((after.x + after.width / 2) - (before.x + before.width / 2))).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);

  await expect(page.locator('.outline-panel-body')).toBeVisible();
  const drawer = await page.locator('.graph-navigator').boundingBox();
  const list = await page.locator('.graph-nav-list').boundingBox();
  expect(drawer.width).toBe(248);
  expect(list.x).toBeGreaterThanOrEqual(drawer.x);
  expect(list.x + list.width).toBeLessThanOrEqual(drawer.x + drawer.width);
});

test('flat drawer uses intrinsic height and keeps the hamburger visible', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  await openPaletteDrawer(page);
  expect((await page.locator('.outline-panel').boundingBox()).height).toBeLessThan(180);
  await expect(page.locator('.tool-panel[data-panel-id="palette"]')).toBeVisible();

  await page.locator('.node').first().click();
  await expect(page.locator('.properties-inspector')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse graph navigator', exact: true }).click();
  const hamburger = page.getByRole('button', { name: 'Expand graph navigator', exact: true }).locator('.ui-icon');
  await expect(hamburger).toBeVisible();
  const iconBox = await hamburger.boundingBox();
  const drawerBox = await page.locator('.graph-navigator').boundingBox();
  const railBox = await page.locator('.left').boundingBox();
  expect(iconBox.x).toBeGreaterThanOrEqual(drawerBox.x);
  expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);
  expect(iconBox.y).toBeGreaterThanOrEqual(drawerBox.y);
  expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(drawerBox.y + drawerBox.height);
  expect(drawerBox.height).toBeGreaterThanOrEqual(iconBox.height + 10);
  expect(railBox.height).toBeGreaterThanOrEqual(drawerBox.height);
  await expect(page.locator('.properties-inspector')).toBeHidden();
  await expect(page.locator('.graph-navigator')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByRole('button', { name: 'Fit canvas to content' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

