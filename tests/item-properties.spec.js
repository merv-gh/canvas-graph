const { test, expect, setup, openPaletteDrawer, openTypeCatalog } = require('./browser-testkit.cjs');

test('node converts to container from properties and radial menu', async ({ page }) => {
  await setup.app(page);
  await openPaletteDrawer(page);
  await page.keyboard.press('a');
  await page.evaluate(() => {
    const app = window.app;
    const source = app.graphs.current.nodes()[0];
    app.bus.emit('graph.node.create', { Label: { text: 'Peer' }, Position: { x: 700, y: 420 }, keepView: true });
    const peer = app.graphs.current.nodes().find(node => node.id !== source.id);
    app.bus.emit('graph.edge.create', { From: source.id, To: peer.id, Label: { text: 'calls' } });
  });
  const edgeId = await page.evaluate(() => window.app.graphs.current.edges()[0].id);
  const node = page.locator('.node').first();
  await node.click();
  await expect(page.locator('.properties-inspector [data-command="node.convert.container"]')).toBeVisible();
  await node.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'To container' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'To container' }).click();
  await expect(page.locator('.node')).toHaveCount(1);
  await expect(page.locator('.container')).toHaveCount(1);
  await expect(page.locator('.edge')).toHaveCount(1);
  expect(await page.evaluate(id => {
    const edge = window.app.graphs.current.getEdge(id);
    return { id: edge.id, endpointKinds: [window.app.graphs.current.refById(edge.From)?.kind, window.app.graphs.current.refById(edge.To)?.kind] };
  }, edgeId)).toEqual({ id: edgeId, endpointKinds: ['container', 'node'] });
  await expect(page.locator('.properties-inspector [data-command="container.convert.node"]')).toBeVisible();
  const container = page.locator('.container').first();
  await container.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'To node' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'To node' }).click();
  await expect(page.locator('.container')).toHaveCount(0);
  await expect(page.locator('.node')).toHaveCount(2);
  await expect(page.locator('.edge')).toHaveCount(1);
  expect(await page.evaluate(id => {
    const edge = window.app.graphs.current.getEdge(id);
    return { id: edge.id, endpointKinds: [window.app.graphs.current.refById(edge.From)?.kind, window.app.graphs.current.refById(edge.To)?.kind] };
  }, edgeId)).toEqual({ id: edgeId, endpointKinds: ['node', 'node'] });
});

test('desktop item context switches between radial and list menus in place', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  const node = page.locator('.node').first();
  await node.click({ button: 'right' });
  await expect(page.locator('.item-action-wheel')).toBeVisible();
  await page.getByRole('button', { name: 'Use list context menu', exact: true }).click();
  const list = page.locator('.item-action-menu');
  await expect(list).toBeVisible();
  await expect(list.getByRole('menuitem', { name: 'Details', exact: true })).toBeVisible();
  await expect(page.locator('.item-toolbar')).toBeHidden();
  await page.getByRole('button', { name: 'Use radial context menu', exact: true }).click();
  await expect(page.locator('.item-action-wheel')).toBeVisible();
  await page.mouse.click(1100, 650);
  await expect(page.locator('.item-action-wheel')).toHaveCount(0);
});

test('desktop item context owns keyboard focus and activates the focused action', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  await page.locator('.node').first().click({ button: 'right' });
  const rename = page.getByRole('menuitem', { name: 'Rename', exact: true });
  const description = page.getByRole('menuitem', { name: 'Edit description', exact: true });
  await expect(rename).toBeFocused();
  await rename.press('ArrowRight');
  await expect(description).toBeFocused();
  await description.press('Enter');
  await expect(page.locator('.item-action-wheel')).toHaveCount(0);
  await expect(page.locator('[data-editable-description].editing')).toHaveCount(1);
});

test('collapsed navigator and fit controls use the same measured shell', async ({ page }) => {
  await setup.app(page, '/?demo=agent-observability');
  await expect(page.locator('.graph-navigator')).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse graph navigator', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  const hamburger = await page.locator('.graph-navigator[data-outline-folded="true"]').boundingBox();
  const fit = await page.locator('.tool-panel[data-panel-id="zoom"]').boundingBox();
  expect({ width: hamburger?.width, height: hamburger?.height }).toEqual({ width: 42, height: 42 });
  expect({ width: fit?.width, height: fit?.height }).toEqual({ width: 42, height: 42 });
});

test('empty canvas context mirrors primary toolbar commands near the pointer', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  const stage = page.locator('[data-place="stage"]');
  await stage.dispatchEvent('contextmenu', { button: 2, clientX: 900, clientY: 700 });
  const menu = page.locator('.canvas-action-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Add node', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Draw mode', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Select mode', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Erase canvas items', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Fit canvas', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Draw mode', exact: true }).click();
  await expect(stage).toHaveClass(/ink-drawing/);
  await expect(menu).toHaveCount(0);

  await stage.dispatchEvent('contextmenu', { button: 2, clientX: 900, clientY: 700 });
  await page.locator('.canvas-action-menu').getByRole('menuitem', { name: 'Select mode', exact: true }).click();
  await expect(stage).not.toHaveClass(/ink-drawing/);

  await stage.dispatchEvent('contextmenu', { button: 2, clientX: 900, clientY: 700 });
  await expect(page.locator('.canvas-action-menu')).toBeVisible();
  await page.mouse.click(80, 680);
  await expect(page.locator('.canvas-action-menu')).toHaveCount(0);
});

test('node description supports inline Markdown editing', async ({ page }) => {
  await setup.app(page, '/?demo=agent-observability');
  const node = page.getByRole('button', { name: /Trace boundaries .*Timeline step node/ });
  const description = node.locator('[data-editable-description]');
  await node.click();
  await description.dblclick();
  await expect(description).toHaveClass(/editing/);
  expect(await description.evaluate(element => element.isContentEditable)).toBe(true);
  await expect(description).toHaveAttribute('aria-label', 'Markdown description');
  await description.fill('**Reviewed** · direct edit');
  await description.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await expect(description.locator('strong')).toHaveText('Reviewed');
  await expect(description).not.toHaveClass(/editing/);
});

test('Edit reveals the collapsed inspector and focuses its title', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  await openPaletteDrawer(page);
  await page.locator('.node').first().click();
  await page.getByRole('button', { name: 'Collapse graph navigator', exact: true }).click();
  const edit = page.locator('.item-toolbar [data-command="item.properties.open"]');
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator('.graph-navigator')).toHaveAttribute('data-outline-folded', 'false');
  await expect(page.locator('.properties-inspector')).toBeVisible();
  await expect(page.locator('.properties-inspector [data-item-modal-title]')).toBeFocused();
});

test('selection opens compact left properties without leaking canvas context actions', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  await openPaletteDrawer(page);
  const node = page.locator('.node').first();
  await node.click();
  const properties = page.locator('.tool-panel[data-panel-id="properties"]');
  await expect(properties).toBeVisible();
  await expect(page.locator('.modal-layer')).toHaveCount(0);
  const panelBox = await properties.boundingBox();
  const drawerBox = await page.locator('.left').boundingBox();
  expect(panelBox.x).toBeGreaterThanOrEqual(drawerBox.x);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width + 1);
  expect(panelBox.width).toBeLessThanOrEqual(305);
  expect(await properties.locator('.properties-inspector-scroll').evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(100);
  await expect(page.locator('.palette-style-controls')).toBeVisible();
  await expect(properties.locator('.context-action-icon .ui-icon').first()).toBeVisible();
  await expect(page.locator('[data-fold-id="palette.catalog"]')).toContainText('Change type ·');
  await expect(properties.locator('.context-action-group.danger [data-command="selection.item.delete"]')).toBeVisible();
  await expect(properties.locator('.properties-autosave-note')).toBeVisible();

  await properties.locator('[data-item-modal-title]').click({ button: 'right' });
  await expect(page.locator('.item-action-wheel')).toHaveCount(0);
  await expect(page.locator('.item-toolbar [data-command="graph.node.delete"] .ui-icon')).toBeVisible();

  await page.evaluate(() => window.app.contexts.commands.run('editing.container.create', { origin: 'test' }));
  await expect(page.locator('.container').first()).toBeVisible();
  await expect(page.locator('.item-toolbar [data-command="graph.container.delete"] .ui-icon')).toBeVisible();
});

test('graph list and properties share the rail without clipping or nested panel caps', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await setup.app(page);
  await page.evaluate(() => window.app.contexts.commands.run('editing.node.create'));
  await page.getByRole('button', { name: 'Expand graph navigator', exact: true }).click();

  const rail = page.locator('.left');
  const graphPanel = page.locator('.graph-navigator');
  const graphCard = page.locator('.graph-nav-list .graph-nav-card.active');
  const properties = page.locator('[data-panel-id="properties"]');
  const scroll = properties.locator('.properties-inspector-scroll');
  await expect(graphCard).toBeVisible();
  await expect(properties).toBeVisible();

  const boxes = await page.evaluate(() => {
    const rect = selector => {
      const { top, right, bottom, left, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { top, right, bottom, left, width, height };
    };
    const rail = rect('.left');
    const graph = rect('.graph-navigator');
    const card = rect('.graph-nav-list .graph-nav-card.active');
  const defaults = rect('[data-panel-id="palette"]');
  const properties = rect('[data-panel-id="properties"]');
    const scroll = rect('.properties-inspector-scroll');
    return { rail, graph, card, defaults, properties, scroll };
  });
  expect(boxes.card.bottom).toBeLessThanOrEqual(boxes.graph.bottom + 1);
  expect(boxes.graph.bottom).toBeLessThanOrEqual(boxes.defaults.top + 1);
  expect(boxes.defaults.bottom).toBeLessThanOrEqual(boxes.properties.top + 1);
  expect(boxes.properties.bottom).toBeLessThanOrEqual(boxes.rail.bottom + 1);
  expect(boxes.scroll.height).toBeGreaterThanOrEqual(100);
  expect(await scroll.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
});

test('creation defaults stay while contextual properties clear with selection', async ({ page }) => {
  await setup.app(page);
  const id = await page.evaluate(() => {
    window.app.contexts.commands.run('editing.node.create');
    return window.app.graphs.current.nodes()[0].id;
  });
  await page.locator(`.node[data-item-id="${id}"]`).click();
  await openPaletteDrawer(page);
  const inspector = page.locator('.properties-inspector');
  await expect(inspector).toBeVisible();
  const defaults = page.locator('[data-panel-id="palette"]');
  await expect(defaults).toBeVisible();

  await page.evaluate(() => window.app.selection.select(null));

  await expect(inspector).toBeHidden();
  await expect(defaults).toBeVisible();
  await expect(defaults.locator('[data-fold-id="palette.catalog"]')).toContainText('Change type · Text');
});
