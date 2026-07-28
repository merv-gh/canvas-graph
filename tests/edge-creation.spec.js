const { test, expect } = require('@playwright/test');
const { boot } = require('./browser-testkit.cjs');

const createNodes = async (page, labels) => page.evaluate((labels) => {
  const v = window.app;
  labels.forEach(text => v.bus.emit('editing.node.create', { Label: { text } }));
  return v.graphs.current.nodes().map(node => ({ id: node.id, label: node.Label.text }));
}, labels);

test('@smoke frontend boots current TypeScript entrypoint with edge creation UI enabled', async ({ page }) => {
  await boot(page);

  await expect(page.locator('.toolbar [data-command="editing.edge.create"] .ui-icon')).toBeVisible();
  const state = await page.evaluate(() => ({
    commandFormOn: window.app.flags.isOn('commandForm'),
    commandFormRegistered: !!window.app.contexts.commands.get('commandForm.submit'),
    edgeCommandEvent: window.app.contexts.commands.get('editing.edge.create')?.event,
  }));

  expect(state).toEqual({
    commandFormOn: true,
    commandFormRegistered: true,
    edgeCommandEvent: 'editing.edge.create',
  });
});

test('edge command explains why it cannot run before two nodes exist', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__notices = [];
    window.app.bus.on('app.notice', notice => window.__notices.push(notice.message));
  });

  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await expect(page.locator('.modal-layer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__notices.at(-1))).toContain('Nothing to pick for Pick source node');

  await createNodes(page, ['A']);
  await expect(page.locator('.node')).toHaveCount(1);
  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await expect.poll(() => page.evaluate(() => window.__notices.at(-1))).toContain('Nothing to pick for Pick target node');
});

test('@smoke edge command seeds source and picks target by letter when only two nodes exist', async ({ page }) => {
  await boot(page);
  const nodes = await createNodes(page, ['A', 'B']);

  await page.evaluate((sourceId) => {
    const v = window.app;
    v.bus.emit('selection.node.select', { id: sourceId });
  }, nodes[0].id);

  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await expect(page.locator('.picker-letter')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.edges().length)).toBe(0);

  await page.keyboard.press('a');

  await expect.poll(() => page.evaluate(() =>
    window.app.graphs.current.edges().map(edge => ({ From: edge.From, To: edge.To })),
  )).toEqual([{ From: nodes[0].id, To: nodes[1].id }]);
  await expect(page.locator('.edges .edge-line')).toHaveCount(1);
  const box = await page.locator('.edges .edge-line').evaluate(line => {
    const rect = line.getBoundingClientRect();
    return { width: rect.width, height: rect.height, stroke: getComputedStyle(line).stroke };
  });
  expect(box.width + box.height).toBeGreaterThan(20);
  expect(box.stroke).not.toBe('none');
});

test('edge command lets the user choose among several target letters', async ({ page }) => {
  await boot(page);
  const nodes = await createNodes(page, ['A', 'B', 'C']);

  await page.evaluate((sourceId) => {
    const v = window.app;
    v.bus.emit('selection.node.select', { id: sourceId });
  }, nodes[0].id);

  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await expect(page.locator('.picker-letter')).toHaveCount(2);

  await page.keyboard.press('s');

  await expect(page.locator('.modal-layer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    window.app.graphs.current.edges().map(edge => ({ From: edge.From, To: edge.To })),
  )).toEqual([{ From: nodes[0].id, To: nodes[2].id }]);
  await expect(page.locator('.edges .edge-line')).toHaveCount(1);
});

test('focused edge uses graph styling without a browser focus rectangle', async ({ page }) => {
  await boot(page);
  const nodes = await createNodes(page, ['A', 'B']);
  const edgeId = await page.evaluate(([from, to]) => {
    const v = window.app;
    v.bus.emit('graph.edge.create', { From: from.id, To: to.id });
    return v.graphs.current.edges()[0].id;
  }, nodes);

  const hit = page.locator(`.edge-hit[data-item-kind="edge"][data-item-id="${edgeId}"]`);
  await expect(hit).toHaveCount(1);
  await hit.dispatchEvent('pointerdown', { bubbles: true, cancelable: true });
  await expect(page.locator(`.edge-line.focused[data-item-kind="edge"][data-item-id="${edgeId}"]`)).toHaveCount(1);
  await expect(hit).toHaveCSS('outline-style', 'none');
});

test('edge label has a forgiving target, hover grace, and owns rename mode', async ({ page }) => {
  await boot(page);
  const nodes = await createNodes(page, ['A', 'B']);
  const edgeId = await page.evaluate(([from, to]) => {
    const v = window.app;
    v.bus.emit('graph.edge.create', { From: from.id, To: to.id });
    return v.graphs.current.edges()[0].id;
  }, nodes);

  const target = page.locator(`.edge-label-target[data-item-id="${edgeId}"]`);
  const label = page.locator(`.edge-label-host[data-item-id="${edgeId}"] [data-editable-title]`);
  const targetBox = await target.boundingBox();
  const labelBox = await label.boundingBox();
  expect(targetBox.width).toBeGreaterThanOrEqual(labelBox.width + 20);
  expect(targetBox.height).toBeGreaterThanOrEqual(labelBox.height + 20);

  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await expect(label).toHaveCSS('opacity', '1');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(250);
  await expect(label).toHaveCSS('opacity', '1');
  await expect(label).toHaveCSS('opacity', '0', { timeout: 1_000 });

  await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await expect(page.locator(`.edge-line[data-item-id="${edgeId}"]`)).toHaveClass(/selected/);
  await expect(label).toHaveCSS('border-top-style', 'solid');
  const toolbar = page.locator(`.item-toolbar[data-item-kind="edge"][data-item-id="${edgeId}"]`);
  await expect(toolbar).toBeVisible();
  const toolbarBox = await toolbar.boundingBox();
  const selectedLabelBox = await label.boundingBox();
  const overlaps = toolbarBox.x < selectedLabelBox.x + selectedLabelBox.width
    && toolbarBox.x + toolbarBox.width > selectedLabelBox.x
    && toolbarBox.y < selectedLabelBox.y + selectedLabelBox.height
    && toolbarBox.y + toolbarBox.height > selectedLabelBox.y;
  expect(overlaps).toBe(false);

  await page.waitForTimeout(550);
  const renameBox = await target.boundingBox();
  await page.mouse.dblclick(renameBox.x + renameBox.width / 2, renameBox.y + renameBox.height / 2);
  await expect(label).toHaveClass(/editing/);
  await expect(toolbar).toBeHidden();
  await label.fill('publishes to');
  await label.press('Enter');
  await expect.poll(() => page.evaluate(id => window.app.graphs.current.getEdge(id).Label?.text, edgeId)).toBe('publishes to');
});

test('@smoke graph storage rejects self-loop and missing-endpoint edge creates', async ({ page }) => {
  await boot(page);
  const nodes = await createNodes(page, ['A']);

  const count = await page.evaluate((id) => {
    const v = window.app;
    v.bus.emit('graph.edge.create', { From: id, To: id });
    v.bus.emit('graph.edge.create', { From: id, To: 'missing' });
    return v.graphs.current.edges().length;
  }, nodes[0].id);

  expect(count).toBe(0);
});
