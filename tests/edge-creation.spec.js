const { test, expect } = require('@playwright/test');

const boot = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.app);
};

const createNodes = async (page, labels) => page.evaluate((labels) => {
  const v = window.app;
  labels.forEach(text => v.bus.emit('editing.node.create', { Label: { text } }));
  return v.graphs.current.nodes().map(node => ({ id: node.id, label: node.Label.text }));
}, labels);

test('frontend boots current TypeScript entrypoint with edge creation UI enabled', async ({ page }) => {
  await boot(page);

  await expect(page.locator('.toolbar [data-command="editing.edge.create"]')).toHaveText('+ Edge');
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

  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await expect(page.locator('.modal-layer')).toHaveCount(0);
  await expect(page.locator('.log-row').first()).toContainText('Nothing to pick for Pick source node');

  await createNodes(page, ['A']);
  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await expect(page.locator('.log-row').first()).toContainText('Nothing to pick for Pick target node');
});

test('edge command seeds source and picks target by letter when only two nodes exist', async ({ page }) => {
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

test('graph storage rejects self-loop and missing-endpoint edge creates', async ({ page }) => {
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
