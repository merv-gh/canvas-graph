const { test, expect } = require('@playwright/test');

/**
 * Round-2 bug catchers. Run RED first to prove they fail on the live regression,
 * then turn green as each fix lands. Keep these in the suite — they're the receipts
 * for "we considered this case".
 */

const boot = async (page) => {
  await page.goto('/v2/');
  await page.waitForFunction(() => !!window.v2);
};

test('outline lists an "edges" section (edge collection in model)', async ({ page }) => {
  await boot(page);
  const headings = await page.locator('.outline-section .panel-title').allTextContents();
  // Currently RED: only Graphs and Nodes.
  expect(headings.map(h => h.toLowerCase())).toContain('edges');
});

test('graph.edge.create is a registered command, not only an event', async ({ page }) => {
  await boot(page);
  const registered = await page.evaluate(() => {
    const c = window.v2.contexts.commands.all();
    return {
      create: !!c.find(x => x.id === 'graph.edge.create'),
      del:    !!c.find(x => x.id === 'graph.edge.delete'),
    };
  });
  expect(registered.create).toBe(true);
  expect(registered.del).toBe(true);
});

test('palette can find edge actions by name', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.v2.contexts.commands.run('palette.open'));
  const search = page.locator('.palette-search');
  await search.fill('edge');
  const rows = await page.locator('.command-row b').allTextContents();
  // RED until edge CRUD commands exist with the word "edge" in the label.
  expect(rows.some(r => /edge/i.test(r))).toBe(true);
});

test('after view.fit.all, no node DOM extends into the left panel', async ({ page }) => {
  await boot(page);
  // Build a wide horizontal graph: 1 root, 8 leaves connected
  await page.evaluate(() => {
    const v = window.v2;
    v.bus.emit('editing.node.create', { Label: { text: 'Root' } });
    const root = v.selection.selected();
    for (let i = 0; i < 8; i++) {
      v.bus.emit('editing.node.create', { Label: { text: 'C' + i }, connectFrom: root, keepFocus: true });
    }
    v.bus.emit('layout.apply.tidy');
    v.bus.emit('view.fit.all');
  });
  await page.waitForTimeout(200);
  const panelRight = await page.locator('.left').evaluate(el => el.getBoundingClientRect().right);
  const intrusions = await page.locator('.stage .node').evaluateAll((nodes, panelRight) =>
    nodes
      .map(n => ({ rect: n.getBoundingClientRect(), id: n.dataset.nodeId }))
      .filter(o => o.rect.left < panelRight - 0.5)
      .map(o => ({ id: o.id, left: o.rect.left, panelRight })), panelRight);
  // RED until fit accounts for stage-local pixel padding around bbox.
  expect(intrusions).toEqual([]);
});

test('DX warns when bus emits graph.<kind>.* events but no entity/collection covers that kind', async ({ page }) => {
  await boot(page);
  const issues = await page.evaluate(() => window.v2.dx.run());
  // Edge kind has bus events but currently no entity declaration AND no collection.
  // RED until either a DX rule fires here OR the model gains edges + collection (which
  // satisfies the contract — this test passes when the model is fixed).
  const hasCoverage = issues.some(i => i.rule === 'entity.kind-no-collection' && i.message.includes('edge'));
  const modelHasEdgeCollection = await page.evaluate(() =>
    !!window.v2.model.collections().find(c => c.id === 'edges'));
  expect(hasCoverage || modelHasEdgeCollection).toBe(true);
});
