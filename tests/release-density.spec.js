const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('release chrome stays flat and the empty action does not move on hover', async ({ page }) => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'styles.css'), 'utf8');
  expect(css).not.toMatch(/box-shadow|--shadow/);
  expect(css).not.toMatch(/gradient\(/);
  for (const [, raw] of css.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
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

  const elevated = await page.locator('*').evaluateAll(elements =>
    elements.filter(element => getComputedStyle(element).boxShadow !== 'none').length);
  expect(elevated).toBe(0);
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
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  expectGrayscale(await colors());

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

test('first node and every creation fit share the exact stage centre', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await expect(page.locator('.node')).toHaveCount(2);
  await expect.poll(() => page.locator('.node').evaluateAll(nodes => {
    const rects = nodes.map(node => node.getBoundingClientRect());
    return {
      x: (Math.min(...rects.map(rect => rect.left)) + Math.max(...rects.map(rect => rect.right))) / 2,
      y: (Math.min(...rects.map(rect => rect.top)) + Math.max(...rects.map(rect => rect.bottom))) / 2,
    };
  })).toEqual(await stageCentre());

  const toolbar = await page.locator('.node-toolbar').boundingBox();
  expect(toolbar.height).toBeLessThanOrEqual(32);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close dialog' })).toHaveText('×');
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
  await expect(title).toHaveValue('Node 1');
  await title.fill('Compact title');
  await expect(page.locator('.node-title')).toHaveText('Compact title');
});
