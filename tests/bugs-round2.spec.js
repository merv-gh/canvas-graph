const { test, expect } = require('@playwright/test');

/**
 * Round-2 bug catchers. Run RED first to prove they fail on the live regression,
 * then turn green as each fix lands. Keep these in the suite — they're the receipts
 * for "we considered this case".
 */

const boot = async (page) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.app);
};

test('model exposes an edge collection for navigation surfaces', async ({ page }) => {
  await boot(page);
  const collections = await page.evaluate(() => window.app.model.collections().map(collection => collection.id));
  expect(collections).toContain('edges');
});

test('editing.edge.create is a registered command, while graph.edge.create stays storage', async ({ page }) => {
  await boot(page);
  const registered = await page.evaluate(() => {
    const c = window.app.contexts.commands.all();
    return {
      create: !!c.find(x => x.id === 'editing.edge.create'),
      del:    !!c.find(x => x.id === 'graph.edge.delete'),
    };
  });
  expect(registered.create).toBe(true);
  expect(registered.del).toBe(true);
});

test('palette can find edge actions by name', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.app.contexts.commands.run('palette.open'));
  const search = page.locator('.palette-search');
  await search.fill('edge');
  const rows = await page.locator('.command-row b').allTextContents();
  // RED until edge CRUD commands exist with the word "edge" in the label.
  expect(rows.some(r => /edge/i.test(r))).toBe(true);
});

test('after view.fit.all, no node DOM extends into the left panel', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  // Build a wide horizontal graph: 1 root, 8 leaves connected
  await page.evaluate(() => {
    const v = window.app;
    v.bus.emit('editing.node.create', { Label: { text: 'Root' } });
    const root = v.selection.selected();
    for (let i = 0; i < 8; i++) {
      v.bus.emit('editing.node.create', { Label: { text: 'C' + i }, connectFrom: root, keepFocus: true });
    }
    v.bus.emit('layout.apply.tidy');
    v.bus.emit('view.fit.all');
  });
  await page.waitForTimeout(200);
  const panelRect = await page.locator('.left').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  });
  const intrusions = await page.locator('.stage .node').evaluateAll((nodes, panel) =>
    nodes
      .map(n => ({ rect: n.getBoundingClientRect(), id: n.dataset.itemId }))
      .filter(o => o.rect.left < panel.right - 0.5
        && o.rect.right > panel.left + 0.5
        && o.rect.top < panel.bottom - 0.5
        && o.rect.bottom > panel.top + 0.5)
      .map(o => ({ id: o.id, left: o.rect.left, panel })), panelRect);
  // RED until fit accounts for stage-local pixel padding around bbox.
  expect(intrusions).toEqual([]);
});

test('resize re-fits a simple graph inside the live frame beside the open navigator', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await boot(page);
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.keyboard.press('z');

  const expectedSafeCenter = () => page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const panel = document.querySelector('.graph-navigator').getBoundingClientRect();
    const left = panel.right - stage.left + 20;
    const right = stage.width - 72;
    return stage.left + left + (right - left) / 2;
  });
  const nodeCenter = () => page.locator('.node').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.left + rect.width / 2;
  });
  await expect.poll(nodeCenter).toBeCloseTo(await expectedSafeCenter(), 0);

  await page.setViewportSize({ width: 860, height: 680 });
  await expect.poll(nodeCenter).toBeCloseTo(await expectedSafeCenter(), 0);
});

test('Escape collapses the open navigator and redundant per-node/status panels stay absent', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  await expect(page.locator('.node-type-panel')).toHaveCount(0);
  await expect(page.locator('.save-state')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.locator('.graph-navigator')).toHaveAttribute('data-outline-folded', 'true');
});

test('guide shortcut lanes do not overlap on desktop or phone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  const overlapCount = () => page.locator('.onboarding-keys li').evaluateAll(rows => rows.filter(row => {
    const key = row.querySelector('kbd').getBoundingClientRect();
    const label = row.querySelector('span').getBoundingClientRect();
    return key.left < label.right && key.right > label.left && key.top < label.bottom && key.bottom > label.top;
  }).length);
  expect(await overlapCount()).toBe(0);
  expect((await page.locator('.modal-layer[data-visual="onboarding"] .modal').boundingBox()).width).toBeGreaterThan(1000);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overlapCount()).toBe(0);
  const overflow = await page.locator('.onboarding').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
});

test('dark Preview import button keeps high-contrast primary styling', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  const preview = page.getByRole('button', { name: 'Preview import' });
  await expect(preview).toHaveCSS('background-color', 'rgb(215, 215, 215)');
  await expect(preview).toHaveCSS('color', 'rgb(22, 22, 22)');
});

test('workflow edge-label rectangles clear nodes, each other, and their own arrow axes', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /Delivery workflow/ }).click();
  const collisions = await page.locator('g.edge').evaluateAll(groups => {
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const segmentHitsRect = (x1, y1, x2, y2, rect) => {
      if ((x1 >= rect.left && x1 <= rect.right && y1 >= rect.top && y1 <= rect.bottom)
        || (x2 >= rect.left && x2 <= rect.right && y2 >= rect.top && y2 <= rect.bottom)) return true;
      const edges = [
        [rect.left, rect.top, rect.right, rect.top],
        [rect.right, rect.top, rect.right, rect.bottom],
        [rect.right, rect.bottom, rect.left, rect.bottom],
        [rect.left, rect.bottom, rect.left, rect.top],
      ];
      const crosses = (ax, ay, bx, by, cx, cy, dx, dy) => {
        const det = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(det) < 0.0001) return false;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / det;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / det;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
      };
      return edges.some(edge => crosses(x1, y1, x2, y2, ...edge));
    };
    const nodes = [...document.querySelectorAll('.node')].map(node => node.getBoundingClientRect());
    const labels = groups.map(group => group.querySelector('.edge-label-bg')?.getBoundingClientRect()).filter(Boolean);
    const problems = [];
    labels.forEach((label, index) => {
      nodes.forEach((node, nodeIndex) => {
        if (intersects(label, node)) problems.push({
          problem: `label ${index}/node ${nodeIndex}`,
          label: groups[index].textContent,
          node: document.querySelectorAll('.node')[nodeIndex].textContent,
          labelRect: { left: label.left, top: label.top, right: label.right, bottom: label.bottom },
          nodeRect: { left: node.left, top: node.top, right: node.right, bottom: node.bottom },
        });
      });
      labels.slice(index + 1).forEach((other, offset) => { if (intersects(label, other)) problems.push(`label ${index}/label ${index + offset + 1}`); });
      const line = groups[index].querySelector('.edge-line');
      const matrix = line.getScreenCTM();
      const point = (x, y) => new DOMPoint(x, y).matrixTransform(matrix);
      const start = point(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
      const end = point(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
      if (segmentHitsRect(start.x, start.y, end.x, end.y, label)) problems.push(`label ${index}/own edge`);
    });
    return problems;
  });
  expect(collisions).toEqual([]);
});

test('DX warns when bus emits graph.<kind>.* events but no entity/collection covers that kind', async ({ page }) => {
  await boot(page);
  const issues = await page.evaluate(() => window.app.dx.run());
  // Edge kind has bus events but currently no entity declaration AND no collection.
  // RED until either a DX rule fires here OR the model gains edges + collection (which
  // satisfies the contract — this test passes when the model is fixed).
  const hasCoverage = issues.some(i => i.rule === 'entity.kind-no-collection' && i.message.includes('edge'));
  const modelHasEdgeCollection = await page.evaluate(() =>
    !!window.app.model.collections().find(c => c.id === 'edges'));
  expect(hasCoverage || modelHasEdgeCollection).toBe(true);
});
