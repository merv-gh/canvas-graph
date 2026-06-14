const { test, expect } = require('@playwright/test');

const boot = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.app);
};

const createSmallGraph = async (page) => page.evaluate(() => {
  const v = window.app;
  v.bus.emit('editing.node.create', { Label: { text: 'Alpha' } });
  v.bus.emit('editing.node.create', { Label: { text: 'Beta' } });
  const [a, b] = v.graphs.current.nodes();
  v.bus.emit('graph.edge.create', { From: a.id, To: b.id, Label: { text: 'Alpha to Beta' } });
  return { a: a.id, b: b.id };
});

const section = (page, name) =>
  page.locator(`.outline-section:has(.outline-title-search[placeholder="${name}"])`);

const childTops = async (row) => row.evaluate(el =>
  [...el.children].map(child => Math.round(child.getBoundingClientRect().top)));

test('outline title is the collection search input and filters rows', async ({ page }) => {
  await boot(page);
  await createSmallGraph(page);

  await expect(page.locator('.outline-search')).toHaveCount(0);
  const nodes = section(page, 'Nodes');
  const search = nodes.locator('.outline-title-search');

  await expect(search).toHaveAttribute('aria-label', 'Search nodes');
  await search.fill('beta');
  await expect(nodes.locator('.outline-row')).toHaveCount(1);
  await expect(nodes.locator('.outline-main')).toHaveText('Beta');
});

test('outline row actions stay on the same visual row', async ({ page }) => {
  await boot(page);
  await createSmallGraph(page);

  for (const name of ['Nodes', 'Edges']) {
    const row = section(page, name).locator('.outline-row').first();
    const tops = await childTops(row);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  }
});

test('node drag handle is explicit and moves the node', async ({ page }) => {
  await boot(page);
  const ids = await createSmallGraph(page);

  const node = page.locator(`.node[data-item-kind="node"][data-item-id="${ids.b}"]`);
  const header = node.locator('.node-header');
  const toolbar = page.locator('.node-toolbar');
  const handle = toolbar.locator('.node-drag-handle');

  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('data-drag-handle', '');
  await expect(header).toHaveCount(0);

  const before = await node.boundingBox();
  const box = await handle.boundingBox();
  expect(before && box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20);
  await page.mouse.up();

  await expect.poll(async () => {
    const after = await node.boundingBox();
    return after ? Math.round(after.x - before.x) : 0;
  }).toBeGreaterThan(20);
});
