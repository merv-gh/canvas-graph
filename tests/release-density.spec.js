const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const clickMore = async (page, name) => {
  const details = page.locator('.toolbar-overflow');
  if (!(await details.evaluate(element => element.open))) await page.getByLabel('More actions').click();
  await page.getByRole('button', { name, exact: true }).click();
};

test('release chrome stays borderless and the empty action does not move on hover', async ({ page }) => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'styles.css'), 'utf8');
  // Node *content* tints (ML block types + the `data-node-color` palette) are
  // user data, not chrome — the monochrome rule covers the product surface.
  const contentTints = new Set([
    '7c3aed', '2563eb', 'dc2626', 'd97706', '059669', 'ea580c', 'ca8a04', '16a34a', 'db2777',
    '5a9f35', '336791', 'd82c20', // guide-preview technology logos
  ]);
  for (const [, raw] of css.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    if (contentTints.has(raw.toLowerCase())) continue;
    const hex = raw.length === 3 || raw.length === 4
      ? raw.slice(0, 3).split('').map(channel => channel + channel)
      : raw.slice(0, 6).match(/.{2}/g);
    expect(new Set(hex).size, `#${raw} must be grayscale`).toBe(1);
  }
  for (const [, channels] of css.matchAll(/rgba?\(([^)]+)\)/gi)) {
    const [red, green, blue] = channels.split(',').slice(0, 3).map(value => Number(value.trim()));
    expect(red, `rgb(${channels}) must be grayscale`).toBe(green);
    expect(green, `rgb(${channels}) must be grayscale`).toBe(blue);
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'New graph', exact: true }).click();
  await expect(page.getByLabel('Current graph name')).toHaveValue('Graph 2');

  const empty = page.locator('.stage .empty-action');
  await expect(empty).toBeVisible();
  const before = await empty.boundingBox();
  await empty.hover();
  const after = await empty.boundingBox();
  expect(after).toEqual(before);

  const chrome = await page.locator('.tool-panel[data-anchor="top-center"], .graph-navigator').evaluateAll(elements =>
    elements.map(element => {
      const style = getComputedStyle(element);
      return { border: style.borderWidth, shadow: style.boxShadow };
    }));
  expect(chrome.every(item => item.border === '0px')).toBe(true);
  expect(chrome.some(item => item.shadow !== 'none')).toBe(true);
});

test('light and dark UI are grayscale and editable text uses one underline', async ({ page }) => {
  await page.goto('/');
  const colors = async () => page.evaluate(() => {
    const selectors = ['.stage', '.graph-navigator', '.tool-panel[data-anchor="top-center"]'];
    return selectors.flatMap(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [style.backgroundColor, style.color, style.borderColor];
    });
  });
  const expectGrayscale = values => values.forEach(value => {
    const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    if (channels.length === 3) expect(channels[0]).toBe(channels[1]), expect(channels[1]).toBe(channels[2]);
  });

  expectGrayscale(await colors());
  await clickMore(page, 'Toggle theme');
  expectGrayscale(await colors());

  await page.getByRole('button', { name: 'Expand graph navigator', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Current graph name' });
  const resting = await title.evaluate(element => {
    const style = getComputedStyle(element);
    return { top: style.borderTopWidth, right: style.borderRightWidth, bottom: style.borderBottomWidth };
  });
  expect(resting).toEqual({ top: '0px', right: '0px', bottom: '1px' });
  await title.hover();
  await expect.poll(() => title.evaluate(element => getComputedStyle(element).borderBottomColor))
    .not.toBe('rgba(0, 0, 0, 0)');
});

test('first node starts at centre and later pointer creation keeps the camera stable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New graph', exact: true }).click();
  const stageCentre = () => page.locator('.stage').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const emptyCentre = await page.locator('.stage .empty-action').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(emptyCentre).toEqual(await stageCentre());

  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect(page.locator('.node')).toHaveCount(1);
  await expect.poll(() => page.locator('.node').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })).toEqual(await stageCentre());

  const camera = await page.evaluate(() => window.app.contexts.view.get());
  await page.locator('.stage').click({ position: { x: 120, y: 120 } });
  await expect(page.locator('.node')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.app.contexts.view.get())).toEqual(camera);
  await expect(page.locator('.node').nth(1)).toBeVisible();

  await page.locator('.node').nth(1).click();
  const toolbar = await page.locator('.node-toolbar').boundingBox();
  expect(toolbar.height).toBeLessThanOrEqual(32);
  await clickMore(page, 'Export');
  await expect(page.getByRole('button', { name: 'Close dialog' })).toHaveText('×');
});

test('a title-only node centres its text inside the node', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New graph', exact: true }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();

  const offset = await page.locator('.node-title').evaluate(title => {
    const node = title.closest('.node').getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(title);
    const text = range.getBoundingClientRect();
    return {
      x: text.left + text.width / 2 - (node.left + node.width / 2),
      y: text.top + text.height / 2 - (node.top + node.height / 2),
    };
  });

  expect(Math.abs(offset.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(offset.y)).toBeLessThanOrEqual(1);
});

test('period opens one compact actions and properties inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New graph', exact: true }).click();
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.keyboard.press('.');

  await expect(page.locator('.context-actions')).toBeVisible();
  await expect(page.locator('.properties [data-field="width"]')).toHaveCount(0);
  await expect(page.locator('.properties [data-field="height"]')).toHaveCount(0);
  await expect(page.locator('.properties [data-field="title"]')).toHaveCount(0);

  const title = page.getByLabel('Item title');
  await expect(title).toHaveValue('Text');
  await title.fill('Compact title');
  await expect(page.locator('.node-title')).toHaveText('Compact title');
});
