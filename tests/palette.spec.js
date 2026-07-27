const { test, expect } = require('@playwright/test');

const openPaletteDrawer = async page => {
  const drawer = page.locator('.graph-navigator');
  if (await drawer.getAttribute('data-outline-folded') === 'true') {
    await page.getByRole('button', { name: 'Expand graph navigator', exact: true }).click();
  }
};

test('catalog search and categories keep saved types in a separate lower section', async ({ page }) => {
  await page.goto('/');
  await openPaletteDrawer(page);
  await expect(page.locator('.graph-navigator input[type="search"], .palette-panel input[type="search"]')).toHaveCount(1);
  await expect(page.getByText('Node catalog', { exact: false })).toHaveCount(1);
  await expect(page.locator('[data-palette-preset-choice]')).toHaveCount(0);
  await expect(page.getByText('Current collection', { exact: false })).toHaveCount(0);
  const search = page.locator('[data-graph-nav-search]');
  await search.fill('approval');
  await expect(page.locator('[data-palette-catalog]')).toHaveCount(1);
  await expect(page.locator('[data-palette-catalog][data-palette-type="approval-gate"]')).toBeVisible();

  await search.fill('');
  await page.locator('[data-palette-category="Autonomous systems"]').click();
  await expect(page.locator('[data-palette-catalog]')).toHaveCount(6);
  const order = await page.locator('.palette-sheet').evaluate(sheet => {
    const catalog = sheet.querySelector('.palette-catalog-block');
    const saved = sheet.querySelector('.palette-saved-block');
    return !!(catalog.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);

  const camera = await page.evaluate(() => ({ ...window.app.contexts.view.get() }));
  const catalog = page.locator('.palette-catalog-region');
  await catalog.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => catalog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => ({ ...window.app.contexts.view.get() }))).toEqual(camera);
});

test('drawer disclosure keeps toolbar fixed and catalog controls bounded', async ({ page }) => {
  await page.goto('/');
  const toolbar = page.locator('.tool-panel[data-anchor="top-center"]');
  const before = await toolbar.boundingBox();
  await openPaletteDrawer(page);
  const after = await toolbar.boundingBox();
  expect(Math.abs((after.x + after.width / 2) - (before.x + before.width / 2))).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);

  const catalog = page.locator('.palette-workspace-section');
  await expect(catalog.locator('[data-palette-category="All"]')).toBeVisible();
  await expect(page.locator('.palette-sheet > [data-palette-category="All"]')).toHaveCount(0);
  await expect(page.locator('.outline-panel-body')).toBeVisible();
  await expect(page.locator('.palette-saved-pinned')).toBeVisible();
  const tabs = await page.locator('.palette-category-tabs').boundingBox();
  const region = page.locator('.palette-catalog-region');
  const regionBox = await region.boundingBox();
  const savedBox = await page.locator('.palette-saved-pinned').boundingBox();
  expect(tabs.height).toBeLessThanOrEqual(30);
  expect(await region.evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(96);
  expect(savedBox.y).toBeGreaterThanOrEqual(regionBox.y + regionBox.height);
});

test('collapsed drawer sections use intrinsic height and keep the hamburger visible', async ({ page }) => {
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
  await openPaletteDrawer(page);
  const graphToggle = page.locator('[data-fold-id="outline.workspace.graphs"]');
  if (await graphToggle.getAttribute('aria-expanded') === 'true') await graphToggle.click();
  const catalogToggle = page.locator('[data-fold-id="palette.catalog"]');
  if (await catalogToggle.getAttribute('aria-expanded') === 'true') await catalogToggle.click();
  expect((await page.locator('.outline-panel').boundingBox()).height).toBeLessThan(150);
  expect((await page.locator('.palette-workspace-section').boundingBox()).height).toBeLessThan(50);

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

test('Add node is a persistent mode using the active catalog type', async ({ page }) => {
  await page.goto('/');
  await openPaletteDrawer(page);
  await page.locator('[data-command="palette.arm.entry"][data-palette-type="diamond"]').click();
  await page.getByRole('button', { name: 'Select mode', exact: true }).click();
  const before = await page.evaluate(() => window.app.graphs.current.nodes().length);
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect(page.locator('[data-place="stage"]')).toHaveClass(/node-placing/);
  expect(await page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(before + 1);
  await expect(page.getByRole('button', { name: 'Add node', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Select mode', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const stage = page.locator('[data-place="stage"]');
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width - 120, box.y + box.height - 120);
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(before + 2);
  expect(await page.evaluate(() => window.app.graphs.current.nodes().at(-1).NodeType)).toBe('diamond');
});

test('Add exits on a node and nests the next placement in the deepest container', async ({ page }) => {
  await page.goto('/');
  const stage = page.locator('[data-place="stage"]');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect(page.locator('.node')).toHaveCount(1);
  await page.locator('.node').click();
  await expect(stage).not.toHaveClass(/node-placing/);
  await expect(page.getByRole('button', { name: 'Select mode', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const ids = await page.evaluate(() => {
    const app = window.app;
    const center = app.contexts.view.spaceCenter('stage');
    app.bus.emit('editing.container.create', { Label: { text: 'Outer' }, at: center, Size: { w: 520, h: 400 }, AutoFit: false });
    app.bus.emit('editing.container.create', { Label: { text: 'Inner' }, at: center, Size: { w: 280, h: 220 }, AutoFit: false });
    const [outer, inner] = app.graphs.current.itemsOfKind('container');
    app.bus.emit('container.add-child', { containerId: outer.id, childRef: { kind: 'container', id: inner.id } });
    return { outer: outer.id, inner: inner.id };
  });
  await expect(page.locator('.container')).toHaveCount(2);

  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect(stage).toHaveClass(/node-placing/);
  const inner = page.locator(`.container[data-item-id="${ids.inner}"]`);
  const rect = await inner.boundingBox();
  await page.mouse.click(rect.x + rect.width - 24, rect.y + rect.height - 24);
  await expect(page.locator('.node')).toHaveCount(3);
  await expect.poll(() => page.evaluate(innerId => {
    const node = window.app.graphs.current.nodes().at(-1);
    return window.app.contexts.hierarchy.parentRefOf({ kind: 'node', id: node.id })?.id;
  }, ids.inner)).toBe(ids.inner);
});

test('Move item exposes Canvas and every nested container as direct destinations', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(() => {
    const app = window.app;
    app.bus.emit('editing.container.create', { Label: { text: 'Outer' }, at: { x: 560, y: 360 }, Size: { w: 520, h: 400 }, AutoFit: false });
    app.bus.emit('editing.container.create', { Label: { text: 'Inner' }, at: { x: 560, y: 360 }, Size: { w: 280, h: 220 }, AutoFit: false });
    const [outer, inner] = app.graphs.current.itemsOfKind('container');
    app.bus.emit('container.add-child', { containerId: outer.id, childRef: { kind: 'container', id: inner.id } });
    app.bus.emit('graph.node.create', { Label: { text: 'Move me' }, Position: { x: 980, y: 620 }, keepView: true });
    return { outer: outer.id, inner: inner.id, node: app.graphs.current.nodes().at(-1).id };
  });
  await page.evaluate(node => window.app.bus.emit('selection.item.select', { kind: 'node', id: node }), ids.node);
  await page.evaluate(() => window.app.contexts.commands.run('container.add-child', { origin: 'pointer' }));
  await expect(page.locator('.container.picker-candidate')).toHaveCount(2);
  await expect(page.locator('.item-overlay.picker-letter')).toHaveCount(2);
  await page.locator(`.item-overlay[data-item-kind="container"][data-item-id="${ids.inner}"]`).click();
  await expect.poll(() => page.evaluate(node => window.app.contexts.hierarchy.parentRefOf({ kind: 'node', id: node })?.id, ids.node)).toBe(ids.inner);

  await page.evaluate(() => window.app.contexts.commands.run('container.add-child', { origin: 'pointer' }));
  await expect(page.locator('.picker-canvas-option')).toContainText('Canvas');
  await expect(page.locator('.stage')).toHaveClass(/picker-canvas-target/);
  await page.locator('.picker-canvas-option').click();
  await expect.poll(() => page.evaluate(node => window.app.contexts.hierarchy.parentRefOf({ kind: 'node', id: node })?.id ?? null, ids.node)).toBeNull();
});

test('node converts to container from properties and radial menu', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
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
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
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
  await page.goto('/?demo=agent-observability');
  await expect(page.locator('.graph-navigator')).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse graph navigator', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  const hamburger = await page.locator('.graph-navigator[data-outline-folded="true"]').boundingBox();
  const fit = await page.locator('.tool-panel[data-panel-id="zoom"]').boundingBox();
  expect({ width: hamburger?.width, height: hamburger?.height }).toEqual({ width: 42, height: 42 });
  expect({ width: fit?.width, height: fit?.height }).toEqual({ width: 42, height: 42 });
});

test('empty canvas context mirrors primary toolbar commands near the pointer', async ({ page }) => {
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
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
  await page.goto('/?demo=agent-observability');
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
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
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
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
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
  await expect(page.locator('.palette-style-controls')).toHaveCount(0);
  await expect(properties.locator('.context-action-icon .ui-icon').first()).toBeVisible();
  await expect(properties.getByRole('button', { name: /^Change type · / })).toBeVisible();
  await expect(properties.locator('.context-action-group.danger [data-command="selection.item.delete"]')).toBeVisible();
  await expect(properties.locator('.properties-autosave-note')).toBeVisible();

  await properties.locator('[data-item-modal-title]').click({ button: 'right' });
  await expect(page.locator('.item-action-wheel')).toHaveCount(0);
  await expect(page.locator('.item-toolbar [data-command="graph.node.delete"] .ui-icon')).toBeVisible();

  await page.evaluate(() => window.app.contexts.commands.run('editing.container.create', { origin: 'test' }));
  await expect(page.locator('.container').first()).toBeVisible();
  await expect(page.locator('.item-toolbar [data-command="graph.container.delete"] .ui-icon')).toBeVisible();
});

test('draw mode preserves catalog but suspends select-mode affordances', async ({ page }) => {
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
  await openPaletteDrawer(page);
  const node = page.locator('.node').first();
  await node.click();
  await expect(page.locator('.properties-inspector')).toBeVisible();
  await expect(page.locator('.item-toolbar')).toBeVisible();
  await page.locator('[data-command="ink.toggle"]').first().click();
  await expect(page.locator('.palette-catalog-region')).toBeVisible();
  await expect(page.locator('.palette-draw')).toBeVisible();
  await expect(page.locator('.properties-inspector')).toBeHidden();
  await expect(page.locator('.item-toolbar')).toBeHidden();
  await expect(page.locator('.ghost-node')).toBeHidden();

  await node.click({ button: 'right' });
  await expect(page.locator('.item-action-wheel')).toBeVisible();
  await expect(page.locator('.item-toolbar')).toBeHidden();
});

test('toggle node switch keeps persisted state without toggling the whole card', async ({ page }) => {
  await page.goto('/?demo=agent-observability');
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
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length >= 9);
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

test('mobile palette stays collapsed until requested and closes on outside tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const stage = page.locator('[data-place="stage"]');
  const palette = page.locator('.palette-panel');
  const sheet = page.locator('.palette-sheet');
  const toggle = page.getByRole('button', { name: 'Open node palette', exact: true });

  await expect(palette).toHaveAttribute('data-mobile-open', 'false');
  await expect(sheet).toBeHidden();
  await expect(toggle).toBeVisible();
  const stageBox = await stage.boundingBox();
  expect(stageBox.width).toBe(390);
  expect(stageBox.height).toBe(844);

  await toggle.click();
  await expect(palette).toHaveAttribute('data-mobile-open', 'true');
  await expect(sheet).toBeVisible();
  await page.mouse.click(200, 150);
  await expect(palette).toHaveAttribute('data-mobile-open', 'false');
  await expect(sheet).toBeHidden();
});

test('mobile graph navigator is a focus-contained modal sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
  await openPaletteDrawer(page);
  await page.getByRole('button', { name: 'Create a reusable palette type', exact: true }).click();
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
  await openPaletteDrawer(page);
  await expect(page.locator('[data-palette-custom-type]')).toContainText('Critical service');

  await page.getByRole('button', { name: 'Rename Critical service', exact: true }).click();
  await page.locator('[data-form-field="label"]').fill('Critical worker');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.locator('[data-palette-custom-type]')).toContainText('Critical worker');
  await page.reload();
  await openPaletteDrawer(page);
  await expect(page.locator('[data-palette-custom-type]')).toContainText('Critical worker');

  await page.getByRole('button', { name: 'Delete Critical worker', exact: true }).click();
  await expect(page.getByText('Existing nodes will not change.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Critical worker', exact: true }).click();
  await expect(page.locator('[data-palette-custom-type]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-palette-custom-type]')).toHaveCount(0);
});

test('connected-node placeholder creates exactly at its preview without moving the camera', async ({ page }) => {
  await page.goto('/');
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

test('Context searches, renames inline, selects drawings, and Erase removes them', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
  await openPaletteDrawer(page);
  const before = await page.evaluate(() => window.app.graphs.current.nodes().length);
  await page.locator('[data-command="palette.arm.entry"][data-palette-type="diamond"]').click();
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
  const properties = page.locator('.properties-inspector');
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(before + 1);
  await properties.getByRole('button', { name: 'Color: Blue', exact: true }).click();
  await expect(node).toHaveAttribute('data-node-color', 'blue');
});

test('Context exposes actions and C4 palette creates real containers', async ({ page }) => {
  await page.goto('/');
  await openPaletteDrawer(page);
  const properties = page.locator('.properties-inspector');
  await expect(properties).toHaveCount(0);
  await page.evaluate(() => window.app.bus.emit('graph.node.create', { Label: { text: 'Node' } }));
  await expect(properties).toBeVisible();
  await expect(properties.getByRole('button', { name: 'Group', exact: true })).toBeVisible();
  await expect(properties.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  await page.evaluate(() => window.app.bus.emit('preset.set', { preset: 'c4' }));
  await page.evaluate(() => window.app.selection.select(null));
  await page.getByRole('button', { name: 'System', exact: true }).click();
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
  await page.goto('/');
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

test('catalog favorites and recent types survive redraw and reload', async ({ page }) => {
  await page.goto('/');
  await openPaletteDrawer(page);
  const diamond = page.locator('.palette-catalog-block [data-palette-type="diamond"]').first();
  await diamond.locator('xpath=..').getByRole('button', { name: 'Add Diamond to favorites', exact: true }).click();
  await page.locator('[data-palette-category="Favorites"]').click();
  await expect(page.locator('.palette-favorites-block [data-palette-type="diamond"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Diamond from favorites', exact: true }).locator('.ui-icon')).toBeVisible();
  await page.locator('[data-palette-category="All"]').click();
  await page.locator('.palette-catalog-block [data-palette-type="diamond"]').first().click();
  await expect(page.locator('.palette-recent-block [data-palette-type="diamond"]')).toBeVisible();
  await page.reload();
  await openPaletteDrawer(page);
  await page.locator('[data-palette-category="Favorites"]').click();
  await expect(page.locator('.palette-favorites-block [data-palette-type="diamond"]')).toBeVisible();
  await page.locator('[data-palette-category="All"]').click();
  await expect(page.locator('.palette-recent-block [data-palette-type="diamond"]')).toBeVisible();
});

test('shared SVG controls dismiss overflow on canvas without moving the camera', async ({ page }) => {
  await page.goto('/');
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
