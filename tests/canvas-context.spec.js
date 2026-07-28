const { test, expect, setup, openPaletteDrawer, openTypeCatalog } = require('./browser-testkit.cjs');

test('Context searches, renames inline, selects drawings, and Erase removes them', async ({ page }) => {
  await setup.app(page);
  await openPaletteDrawer(page);
  await page.evaluate(() => window.app.bus.emit('graph.node.create', { Label: { text: 'Node' } }));
  const properties = page.locator('.properties-inspector');

  await page.keyboard.press('p');
  await expect(page.locator('.palette-search')).toBeVisible();
  await page.keyboard.press('Escape');

  const title = properties.getByRole('textbox', { name: 'Item title', exact: true });
  await title.fill('Gateway');
  await title.press('Tab');
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes()[0].Label.text)).toBe('Gateway');
  await properties.getByRole('button', { name: 'Save as type', exact: true }).click();
  await expect(page.locator('[data-form-field="label"]')).toHaveValue('Gateway');
  await page.keyboard.press('Escape');

  const draw = page.getByRole('button', { name: 'Draw mode', exact: true }).first();
  await draw.click();
  const stage = page.locator('[data-place="stage"]');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + 420, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 260, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select mode', exact: true }).first().click();
  await expect(properties.getByRole('button', { name: 'Select drawings', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse graph navigator', exact: true }).click();

  const erase = page.getByRole('button', { name: 'Erase canvas items', exact: true }).first();
  await erase.click();
  await expect(erase).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => stage.evaluate(el => getComputedStyle(el).cursor)).toContain('data:image/svg+xml');
  await page.locator('.ink-hit').dispatchEvent('pointerdown', {
    button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType: 'mouse',
  });
  await expect(page.locator('.ink-path')).toHaveCount(0);

  const refs = await page.evaluate(() => {
    const app = window.app;
    app.bus.emit('graph.node.create', { Label: { text: 'Worker' }, Position: { x: 650, y: 300 } });
    const nodes = app.graphs.current.nodes();
    app.bus.emit('graph.edge.create', { From: nodes[0].id, To: nodes[1].id });
    app.bus.emit('editing.container.create', { Label: { text: 'Boundary' }, at: { x: 760, y: 480 } });
    return {
      node: nodes[0].id,
      edge: app.graphs.current.edges()[0].id,
      container: app.graphs.current.itemsOfKind('container')[0].id,
    };
  });
  const erasePointer = { button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType: 'mouse' };
  await page.locator(`.edge-hit[data-item-id="${refs.edge}"]`).dispatchEvent('pointerdown', erasePointer);
  await page.locator(`.node[data-item-id="${refs.node}"]`).dispatchEvent('pointerdown', erasePointer);
  await page.locator(`.container[data-item-id="${refs.container}"]`).dispatchEvent('pointerdown', erasePointer);
  await expect.poll(() => page.evaluate(() => ({
    nodes: window.app.graphs.current.nodes().length,
    edges: window.app.graphs.current.edges().length,
    containers: window.app.graphs.current.itemsOfKind('container').length,
  }))).toEqual({ nodes: 1, edges: 0, containers: 0 });
});

test('type palette becomes a canvas placement tool and edits selection', async ({ page }) => {
  await setup.app(page);
  await openTypeCatalog(page);
  const before = await page.evaluate(() => window.app.graphs.current.nodes().length);
  await page.locator('[data-command="palette.arm.entry"][data-palette-type="diamond"]').evaluate(element => element.click());
  const stage = page.locator('[data-place="stage"]');
  await expect(stage).toHaveClass(/node-placing/);
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width - 100, box.y + box.height - 100);
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(before + 1);
  const created = await page.evaluate(() => {
    const node = window.app.graphs.current.nodes().at(-1);
    return { id: node.id, type: node.NodeType };
  });
  expect(created.type).toBe('diamond');

  const node = page.locator(`.node[data-item-id="${created.id}"]`);
  const defaults = page.locator('[data-panel-id="palette"]');
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(before + 1);
  await defaults.getByRole('button', { name: 'Color: Blue', exact: true }).click();
  await expect(node).toHaveAttribute('data-node-color', 'blue');
});

test('Context exposes actions and C4 palette creates real containers', async ({ page }) => {
  await setup.app(page);
  await openPaletteDrawer(page);
  const properties = page.locator('.properties-inspector');
  await expect(properties).toHaveCount(0);
  await page.evaluate(() => window.app.bus.emit('graph.node.create', { Label: { text: 'Node' } }));
  await expect(properties).toBeVisible();
  await expect(properties.getByRole('button', { name: 'Group', exact: true })).toBeVisible();
  await expect(properties.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  await page.evaluate(() => window.app.bus.emit('preset.set', { preset: 'c4' }));
  await page.evaluate(() => window.app.selection.select(null));
  await openTypeCatalog(page);
  await page.locator('[data-command="palette.arm.entry"]').filter({ hasText: 'System' }).evaluate(element => element.click());
  const stage = page.locator('[data-place="stage"]');
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + 500, box.y + box.height - 80);
  await expect(page.locator('.container[data-container-type="c4-system"][data-container-color="blue"]')).toHaveCount(1);
  const system = await page.evaluate(() => window.app.graphs.current.itemsOfKind('container')
    .find(item => item.ContainerType === 'c4-system'));
  expect(system.Size).toEqual({ w: 560, h: 360 });
  expect(system.Children).toEqual([]);
});

test('Add, Draw, Select, and Erase form one exclusive mode group', async ({ page }) => {
  await setup.app(page);
  const group = page.locator('.top-tool-panel .tool-group[data-group="mode"]');
  await expect(group.locator('button')).toHaveCount(4);
  await expect.poll(() => group.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.command)))
    .toEqual(['palette.place.activate', 'ink.toggle', 'canvas.select', 'ink.erase.toggle']);
  const pressed = () => group.locator('button[aria-pressed="true"]');
  await expect(pressed()).toHaveAttribute('data-command', 'canvas.select');
  await group.getByRole('button', { name: 'Draw mode', exact: true }).click();
  await expect(pressed()).toHaveAttribute('data-command', 'ink.toggle');
  await group.getByRole('button', { name: 'Erase canvas items', exact: true }).click();
  await expect(pressed()).toHaveAttribute('data-command', 'ink.erase.toggle');
  await group.getByRole('button', { name: 'Select mode', exact: true }).click();
  await expect(pressed()).toHaveAttribute('data-command', 'canvas.select');
});

test('hidden catalog state survives redraw and reload', async ({ page }) => {
  await setup.app(page);
  await openTypeCatalog(page);
  const diamond = page.locator('.palette-catalog-block [data-palette-type="diamond"]').first();
  await diamond.locator('xpath=..').locator('[data-command="palette.favorite.toggle"]').evaluate(element => element.click());
  await page.locator('[data-palette-category="Favorites"]').evaluate(element => element.click());
  await expect(page.locator('.palette-favorites-block [data-palette-type="diamond"]')).toHaveCount(1);
  await page.locator('[data-palette-category="All"]').evaluate(element => element.click());
  await page.locator('.palette-catalog-block [data-palette-type="diamond"]').first().evaluate(element => element.click());
  await expect(page.locator('.palette-recent-block [data-palette-type="diamond"]')).toHaveCount(1);
  await page.reload();
  await openTypeCatalog(page);
  await page.locator('[data-palette-category="Favorites"]').evaluate(element => element.click());
  await expect(page.locator('.palette-favorites-block [data-palette-type="diamond"]')).toHaveCount(1);
  await page.locator('[data-palette-category="All"]').evaluate(element => element.click());
  await expect(page.locator('.palette-recent-block [data-palette-type="diamond"]')).toHaveCount(1);
});

test('shared SVG controls dismiss overflow on canvas without moving the camera', async ({ page }) => {
  await setup.app(page);
  await page.evaluate(() => {
    window.app.bus.emit('graph.node.create', { Label: { text: 'Stable' }, Position: { x: 400, y: 300 }, keepView: true });
    window.app.contexts.view.set({ x: 40, y: 30, scale: 1.1 });
    window.app.bus.emit('view.changed', window.app.contexts.view.get());
  });
  const before = await page.evaluate(() => ({ ...window.app.contexts.view.get() }));
  await page.getByLabel('More actions').click();
  await expect(page.locator('.toolbar-overflow')).toHaveAttribute('open', '');
  await page.locator('[data-place="stage"]').click({ position: { x: 600, y: 400 } });
  await expect(page.locator('.toolbar-overflow')).not.toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Draw mode', exact: true }).first().click();
  await expect(page.locator('.graph-navigator')).toHaveAttribute('data-outline-folded', 'false');
  await expect.poll(() => page.evaluate(() => ({ ...window.app.contexts.view.get() }))).toEqual(before);
  await expect(page.locator('.graph-navigator-toggle .ui-icon')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit canvas to content' }).locator('.ui-icon')).toBeVisible();
});
