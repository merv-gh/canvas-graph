const { test, expect, setup, paletteRun } = require('./browser-testkit.cjs');

const createNode = async (page, label) => page.evaluate((text) => {
  const v = window.app;
  v.bus.emit('editing.node.create', { Label: { text } });
  const node = v.graphs.current.nodes().find(candidate => candidate.Label.text === text);
  v.bus.emit('selection.node.select', { id: node.id });
  return node.id;
}, label);

test('command palette restyles the selected node without a right toolbar', async ({ page }) => {
  await setup.app(page);
  await expect(page.locator('[data-panel-id="node-style"]')).toHaveCount(0);
  const id = await createNode(page, 'MLP block');
  await expect(page.locator('[data-panel-id="node-style"]')).toHaveCount(0);
  await paletteRun(page, 'Arm node type: ML · Attention');
  await expect(page.locator(`.node[data-item-id="${id}"].node-type-attention`)).toHaveCount(1);

  await paletteRun(page, 'Arm node color: Blue');
  await expect(page.locator(`.node[data-item-id="${id}"][data-node-color="blue"]`)).toHaveCount(1);

  const state = await page.evaluate((nodeId) => {
    const node = window.app.graphs.current.getNode(nodeId);
    return { NodeType: node.NodeType, Color: node.Color };
  }, id);
  expect(state).toEqual({ NodeType: 'attention', Color: 'blue' });
});

test('item inspector exposes visual property choices instead of select menus', async ({ page }) => {
  await setup.demo(page, 'agent-observability', 9);
  const id = await page.evaluate(() => {
    const node = window.app.graphs.current.nodes().find(candidate => candidate.NodeType === 'timeline-step');
    window.app.selection.select({ kind: 'node', id: node.id });
    window.app.contexts.commands.run('item.properties.open');
    return node.id;
  });

  await expect(page.locator('.properties select[data-field]')).toHaveCount(0);
  await expect(page.locator('.properties .property-choice-swatches')).toHaveCount(0);
  await expect(page.locator('[data-panel-id="palette"] .palette-swatches')).toHaveCount(2);
  await expect(page.locator('.property-choice-placement button')).toHaveCount(6);
  await expect(page.locator('.property-advanced-group').filter({ hasText: 'Content' })).toHaveCount(0);
  await expect(page.locator('[data-field="description"]')).toHaveAttribute('placeholder', 'Description');
  await expect(page.locator('[data-field="description"]')).toHaveAttribute('aria-label', 'Description');
  await expect(page.locator('[data-field="descPlacement"][data-value="top"] .ui-icon path').first()).toHaveAttribute('d', 'M5 11h14v10H5z');
  await expect(page.locator('[data-field="descPlacement"][data-value="left"] .ui-icon path').first()).toHaveAttribute('d', 'M11 5h10v14H11z');
  const red = page.locator('[data-panel-id="palette"] [aria-label="Color: Red"]');
  const swatchBox = await red.boundingBox();
  expect(swatchBox.width).toBeLessThanOrEqual(24);
  expect(swatchBox.height).toBeLessThanOrEqual(24);
  await red.click();
  expect(await red.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(220, 38, 38)');
  await page.locator('[data-panel-id="palette"] [aria-label="Fill: Solid"]').click();
  const below = page.locator('[data-field="descPlacement"][data-value="below"]');
  await below.click();
  expect(await below.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(22, 22, 22)');
  const rendered = page.locator(`.node[data-item-id="${id}"]`);
  await expect(rendered).toHaveAttribute('data-node-color', 'red');
  await expect(rendered).toHaveAttribute('data-fill', 'solid');
  await expect(rendered).toHaveAttribute('data-desc-placement', 'below');
});

test('palette commands change type and color without the mouse', async ({ page }) => {
  await setup.app(page);
  const id = await createNode(page, 'Mixer');

  await page.keyboard.press('p');
  await page.locator('.palette-search').fill('Set node type: ML · MoE');
  await page.keyboard.press('Enter');
  await expect(page.locator(`.node[data-item-id="${id}"].node-type-moe`)).toHaveCount(1);

  await page.keyboard.press('p');
  await page.locator('.palette-search').fill('Set node color: purple');
  await page.keyboard.press('Enter');
  await expect(page.locator(`.node[data-item-id="${id}"][data-node-color="purple"]`)).toHaveCount(1);
});

// fit-all keeps a readable scale (MIN_FIT_SCALE = 0.8) and crops far nodes,
// so DOM counts cover only the visible head of the diagram — assert the full
// architecture on the model and the type/color rendering on the visible part.
test('Kimi K2 example loads a typed, colored MoE architecture under the architecture preset', async ({ page }) => {
  await setup.demo(page, 'kimi-k2', 11);
  await expect(page.locator('.shell[data-preset="architecture"]')).toHaveCount(1);
  await expect(page.locator('.node[data-node-type="input"][data-node-color="gray"]')).toHaveCount(1);

  const summary = await page.evaluate(() => {
    const nodes = window.app.graphs.current.nodes();
    return {
      types: nodes.map(node => node.NodeType),
      colored: nodes.filter(node => !!node.Color).length,
      edges: window.app.graphs.current.edges().length,
      edgeKinds: [...new Set(window.app.graphs.current.edges().map(edge => edge.EdgeKind))].sort(),
      containers: window.app.graphs.current.itemsOfKind('container')
        .map(container => ({ legend: container.Legend?.length ?? 0, multiplier: container.Multiplier })),
    };
  });
  expect(summary.types).toEqual(expect.arrayContaining(
    ['input', 'embedding', 'dense', 'attention', 'moe', 'norm', 'output', 'operator', 'caption']));
  expect(summary.types).toHaveLength(11);
  expect(summary.colored).toBe(9);
  expect(summary.edges).toBe(11);
  expect(summary.edgeKinds).toEqual(['dashed', 'plain', 'residual']);
  expect(summary.containers).toEqual([{ legend: 2, multiplier: '60×' }]);
});

test('Transformer example loads typed ML blocks', async ({ page }) => {
  await setup.demo(page, 'transformer', 9);
  // Culling renders only the visible head; the model carries the full diagram.
  await expect(page.locator('.node[data-node-type]').first()).toBeVisible();

  const types = await page.evaluate(() =>
    window.app.graphs.current.nodes().map(node => node.NodeType));
  expect(types).toEqual(expect.arrayContaining(['input', 'embedding', 'attention', 'dense', 'norm', 'output']));
  expect(types.filter(type => type === 'attention')).toHaveLength(3);
});

test('guide grid offers one canonical example for every collection', async ({ page }) => {
  await setup.app(page);
  await page.evaluate(() => window.app.contexts.commands.run('onboarding.open', { origin: 'test' }));
  await expect(page.locator('[data-command="demo.render-kimi-k2"]')).toHaveCount(1);
  await expect(page.locator('[data-command="demo.render-flowchart"]')).toHaveCount(1);
  await expect(page.locator('[data-command="demo.render-mindmap"]')).toHaveCount(1);
  await expect(page.locator('[data-command="demo.render-workflow"]')).toHaveCount(1);
});
