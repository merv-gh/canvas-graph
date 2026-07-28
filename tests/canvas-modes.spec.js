const { test, expect, setup, openPaletteDrawer, openTypeCatalog } = require('./browser-testkit.cjs');

test('draw mode exposes only drawing controls and suspends select-mode affordances', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  await openPaletteDrawer(page);
  const node = page.locator('.node').first();
  await node.click();
  await expect(page.locator('.properties-inspector')).toBeVisible();
  await expect(page.locator('.item-toolbar')).toBeVisible();
  await page.locator('[data-command="ink.toggle"]').first().click();
  await expect(page.locator('.palette-catalog-region')).toBeHidden();
  await expect(page.locator('.palette-draw')).toBeVisible();
  await expect(page.locator('.properties-inspector')).toBeHidden();
  await expect(page.locator('.item-toolbar')).toBeHidden();
  await expect(page.locator('.ghost-node')).toBeHidden();

  await node.click({ button: 'right' });
  await expect(page.locator('.item-action-wheel')).toBeVisible();
  await expect(page.locator('.item-toolbar')).toBeHidden();
});

test('toggle node switch keeps persisted state without toggling the whole card', async ({ page }) => {
  await setup.app(page, '/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().some(node => node.NodeType === 'toggle'));
  const card = page.locator('.node[data-node-type="toggle"]').first();
  await card.click();
  expect(await page.evaluate(() => window.app.selection.selected()?.id)).toBeTruthy();
  expect(await card.getAttribute('data-toggle-state')).toBe('off');
  await card.locator('.node-switch-control').click();
  await expect(card).toHaveAttribute('data-toggle-state', 'on');
  expect(await page.evaluate(() => window.app.graphs.current.nodes().find(node => node.NodeType === 'toggle')?.ToggleState)).toBe(true);
});

test('agent observability demo renders report primitives with catalog geometry', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  const report = await page.evaluate(() => {
    const nodes = window.app.graphs.current.nodes();
    const table = nodes.find(node => node.NodeType === 'data-table');
    return {
      preset: document.querySelector('.shell')?.getAttribute('data-preset'),
      types: [...new Set(nodes.map(node => node.NodeType))].sort(),
      tableSize: table?.Size,
      retry: window.app.graphs.current.edges().some(edge => edge.Label?.text === 'retry if rejected'),
    };
  });
  expect(report).toEqual({
    preset: 'autonomous',
    types: ['agent', 'approval-gate', 'artifact', 'data-table', 'timeline-step', 'toggle'],
    tableSize: { w: 300, h: 190 },
    retry: true,
  });
});

test('mobile keeps node catalog out of the graph drawer', async ({ page }) => {
  await setup.mobile(page);

  const stage = page.locator('[data-place="stage"]');
  await expect(page.locator('.tool-panel[data-panel-id="palette"]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open node palette', exact: true })).toBeHidden();
  const stageBox = await stage.boundingBox();
  expect(stageBox.width).toBe(390);
  expect(stageBox.height).toBe(844);
});

test('mobile graph navigator is a focus-contained modal sheet', async ({ page }) => {
  await setup.mobile(page);
  const open = page.getByRole('button', { name: 'Expand graph navigator', exact: true });
  await open.click();
  const navigator = page.getByRole('dialog', { name: 'Graph navigator', exact: true });
  await expect(navigator).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close graph navigator', exact: true })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Collapse graph navigator', exact: true });
  await expect(toggle).toBeFocused();
  await toggle.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Current graph name', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.graph-navigator')).toHaveAttribute('data-outline-folded', 'true');
  await expect(page.getByRole('button', { name: 'Expand graph navigator', exact: true })).toBeFocused();

  const hamburger = await page.locator('.graph-navigator[data-outline-folded="true"]').boundingBox();
  const fit = await page.locator('.tool-panel[data-panel-id="zoom"]').boundingBox();
  expect({ width: hamburger?.width, height: hamburger?.height }).toEqual({ width: 48, height: 48 });
  expect({ width: fit?.width, height: fit?.height }).toEqual({ width: 48, height: 48 });
});

test('draw mode swaps node styling for stroke controls', async ({ page }) => {
  await setup.app(page);
  const draw = page.getByRole('button', { name: 'Draw mode', exact: true }).first();
  await expect(draw).toHaveAttribute('aria-pressed', 'false');
  await draw.click();
  await expect.poll(() => page.locator('[data-place="stage"]').evaluate(el => getComputedStyle(el).cursor))
    .toContain('data:image/svg+xml');
  await expect(page.locator('.palette-draw')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stroke color: Blue', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stroke width: 6', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stroke opacity: 50%', exact: true })).toBeVisible();
});

test('custom palette types keep their form and colors after reload', async ({ page }) => {
  await setup.app(page);
  await openTypeCatalog(page);
  await page.evaluate(() => window.app.contexts.commands.run('palette.custom-type.create'));
  await page.locator('[data-form-field="label"]').fill('Critical service');
  await page.locator('[data-form-field="shape"]').selectOption('pill');
  await page.locator('[data-form-field="color"]').selectOption('purple');
  await page.locator('[data-form-field="fill"]').selectOption('solid');
  await page.locator('[data-form-field="border"]').selectOption('red');
  await page.getByRole('button', { name: 'Save and use', exact: true }).click();

  const custom = page.locator('[data-palette-custom-type]');
  await expect(custom).toContainText('Critical service');
  await expect(custom).toHaveAttribute('aria-pressed', 'true');
  await expect(custom.locator('.palette-tile-preview')).toHaveAttribute('data-node-color', 'purple');
  await expect(custom.locator('.palette-tile-preview')).toHaveAttribute('data-border-color', 'red');

  await page.reload();
  await openTypeCatalog(page);
  await expect(page.locator('[data-palette-custom-type]')).toContainText('Critical service');

  await page.locator('[data-command="palette.custom-type.rename"]').evaluate(element => element.click());
  await page.locator('[data-form-field="label"]').fill('Critical worker');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.locator('[data-palette-custom-type]')).toContainText('Critical worker');
  await page.reload();
  await openTypeCatalog(page);
  await expect(page.locator('[data-palette-custom-type]')).toContainText('Critical worker');

  await page.locator('[data-command="palette.custom-type.delete.request"]').evaluate(element => element.click());
  await expect(page.getByText('Existing nodes will not change.')).toBeVisible();
  await page.locator('[data-command="palette.custom-type.delete.confirm"]').click();
  await expect(page.locator('[data-palette-custom-type]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-palette-custom-type]')).toHaveCount(0);
});

test('connected-node placeholder creates exactly at its preview without moving the camera', async ({ page }) => {
  await setup.app(page);
  await page.evaluate(() => {
    window.app.bus.emit('graph.node.create', {
      Label: { text: 'Root' }, Position: { x: 300, y: 220 }, keepView: true,
    });
  });
  const ghost = page.locator('[data-ghost-node]');
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText('Add below');
  const before = await page.evaluate(() => ({ ...window.app.contexts.view.get() }));
  const preview = await ghost.evaluate(el => ({ x: Number(el.dataset.ghostX), y: Number(el.dataset.ghostY) }));
  await ghost.click();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(2);
  const result = await page.evaluate(() => ({
    position: window.app.graphs.current.nodes().at(-1).Position,
    camera: window.app.contexts.view.get(),
    edges: window.app.graphs.current.edges().length,
  }));
  expect(result.position).toEqual(preview);
  expect(result.camera).toEqual(before);
  expect(result.edges).toBe(1);
});

