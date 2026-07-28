const { test, expect, setup, openPaletteDrawer, openTypeCatalog } = require('./browser-testkit.cjs');

test('Add node is a persistent mode using the active catalog type', async ({ page }) => {
  await setup.app(page);
  await openTypeCatalog(page);
  await page.locator('[data-command="palette.arm.entry"][data-palette-type="diamond"]').evaluate(element => element.click());
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

test('Text tool changes the Add preview and creates transparent borderless text', async ({ page }) => {
  await setup.app(page);
  await page.evaluate(() => window.app.contexts.commands.run('palette.arm.type.diamond'));
  await expect(page.locator('.top-tool-panel [data-command="palette.place.activate"] path').first())
    .toHaveAttribute('d', 'M5 5h14v14H5z');

  await page.getByRole('button', { name: 'Text tool', exact: true }).click();
  await expect(page.locator('.top-tool-panel [data-command="palette.place.activate"] path').first())
    .toHaveAttribute('d', 'M5 5h14');
  const stage = page.locator('[data-place="stage"]');
  const box = await stage.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.node[data-node-type="text"][data-fill="none"][data-border-color="none"]')).toHaveCount(1);
});

test('Add exits on a node and nests the next placement in the deepest container', async ({ page }) => {
  await setup.app(page);
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
  await setup.app(page);
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

