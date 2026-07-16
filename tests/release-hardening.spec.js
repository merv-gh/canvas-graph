const { test, expect } = require('@playwright/test');

const streamText = async download => {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

test('JSON export and import round-trip the complete graph', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  const before = await page.evaluate(() => window.app.graphs.current.snapshot());

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Canvas Graph JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const exported = JSON.parse(await streamText(download));
  expect(exported).toEqual(before);

  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length))
    .toBe(before.nodes.length + 1);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('textbox', { name: 'Graph JSON or Mermaid source' }).fill(JSON.stringify(exported));
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('dialog', { name: 'Review JSON import' })).toContainText(`${before.nodes.length} nodes`);
  await page.getByRole('button', { name: 'Replace graph' }).click();

  await expect.poll(() => page.evaluate(() => window.app.graphs.current.snapshot())).toEqual(before);
});

test('edge picker owns keyboard focus, preserves graph name, and restores focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Current graph name' });
  const originalName = await name.inputValue();
  await name.focus();

  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await connect.click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset.keyboardMode)).toBe('commandPicker');
  await page.keyboard.press('a');

  await expect(name).toHaveValue(originalName);
  await expect(page.locator('.edge-line')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Connect');
});

test('canvas nodes expose names and retain DOM focus during keyboard navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  const nodes = page.locator('.node');
  await expect(nodes).toHaveCount(2);
  await expect(nodes.nth(0)).toHaveAttribute('role', 'button');
  await expect(nodes.nth(0)).toHaveAttribute('aria-label', /Node 1; Text node\. Press Enter to edit\./);

  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-item-id')))
    .toBe(await nodes.nth(0).getAttribute('data-item-id'));
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-item-id')))
    .toBe(await nodes.nth(1).getAttribute('data-item-id'));
});

test('light theme is default even when OS prefers dark', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.shell')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.shell')).toHaveAttribute('data-colorscheme', 'light');
  await expect(page.locator('.tool-panel[data-anchor="top-center"]')).toHaveCSS('background-color', 'rgb(248, 248, 248)');
  await context.close();
});

test('expanded navigator never covers the desktop command bar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();
  const navigator = page.locator('.graph-navigator');
  const toolbar = page.locator('.tool-panel[data-anchor="top-center"]');
  await expect(navigator).toHaveAttribute('data-outline-folded', 'false');
  await expect(page.getByRole('button', { name: 'Collapse graph navigator' })).toBeVisible();
  await expect(toolbar).toBeVisible();
  const navigatorBox = await navigator.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  expect(navigatorBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox.x).toBeGreaterThanOrEqual(navigatorBox.x + navigatorBox.width + 8);
  expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(800);
  expect(toolbarBox.width).toBeLessThan(800 - navigatorBox.x - navigatorBox.width - 20);
  const shellBox = await page.locator('.left').boundingBox();
  expect(shellBox).not.toBeNull();
  expect(navigatorBox.x).toBe(shellBox.x);
  expect(navigatorBox.x + navigatorBox.width).toBe(shellBox.x + shellBox.width);
  await expect(page.getByRole('button', { name: 'Show editing actions' })).toBeVisible();
});

test('light onboarding keeps its dialog label visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await expect(page.locator('.modal-layer[data-visual="onboarding"] .modal-head'))
    .toHaveCSS('color', 'rgb(110, 110, 110)');
  await expect(page.getByText('Start here', { exact: true })).toBeVisible();
});

test('far mobile overview favors readable titles over clipped descriptions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  // Fit deliberately stops at the 80% reading floor. Exercise semantic zoom
  // through the explicit zoom command instead of requiring Fit to violate it.
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(page.locator('.stage')).toHaveAttribute('data-zoom-band', 'far');
  await expect(page.locator('.item-toolbar')).toHaveCount(0);
  await expect(page.locator('.node-title').first()).toHaveCSS('font-size', '22px');
  await expect(page.locator('.node-body').first()).toHaveCSS('display', 'none');
  const overflow = await page.locator('.node').evaluateAll(nodes => nodes.some(node => node.scrollHeight > node.clientHeight + 1));
  expect(overflow).toBe(false);
});

test('node, container, and edge selections remain unmistakable in grayscale', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await page.getByRole('button', { name: /C4 architecture/ }).click();
  await page.getByRole('button', { name: 'Expand graph navigator' }).click();

  await page.locator('.graph-nav-item[data-item-kind="node"]').first().click();
  await expect(page.locator('.node.selected')).toHaveCSS('outline-width', '3px');
  await expect(page.locator('.node.selected')).toHaveCSS('outline-style', 'solid');

  await page.locator('.graph-nav-item[data-item-kind="container"]').first().click();
  await expect(page.locator('.container.selected')).toHaveCSS('outline-width', '3px');
  await expect(page.locator('.container.selected')).toHaveCSS('outline-style', 'solid');

  await page.locator('.graph-nav-item[data-item-kind="edge"]').first().click();
  await expect(page.locator('.edge-line.selected')).toHaveCSS('stroke-width', '4px');
});
