const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('frontend centralizes DOM input listeners and keeps explicit lifecycle exceptions', async () => {
  const frontendDir = path.join(__dirname, '..', 'frontend');
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else if (entry.name.endsWith('.ts')) files.push(abs);
  });
  walk(frontendDir);
  const listeners = files.flatMap(file => fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.includes('addEventListener') && !line.trim().startsWith('*'))
    .map(line => `${path.relative(frontendDir, file)}: ${line.trim()}`));

  const allowed = listeners.filter(line =>
    line.startsWith('app.ts:')
    || line.startsWith('core/commands.ts:')
    || line.startsWith('core/keyboard.ts:')
    || line.startsWith('systems/io.ts:')
    || line.startsWith('systems/view-zoom.ts:')
    || line.startsWith('systems/view-pan.ts:')
    || line.startsWith('systems/render-stage-gpu.ts:'));

  expect(listeners).toEqual(allowed);
  expect(listeners).toContain("app.ts: window.addEventListener('DOMContentLoaded', () => {");
  expect(listeners.some(line => line.includes('core/commands.ts:') && line.includes('root.addEventListener(type, handleEvent'))).toBe(true);
  expect(listeners.some(line => line.includes('core/keyboard.ts:') && line.includes("input.addEventListener('keydown'"))).toBe(true);
  expect(listeners.some(line => line.includes('core/keyboard.ts:') && line.includes("input.addEventListener('input'"))).toBe(true);
});

test('frontend help rejects duplicate shortcuts without saving', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-command="help.open"]').click();

  const helpShortcut = page.locator('.shortcut-edit[data-shortcut-command="help.open"]');
  const helpRow = page.locator('.help-row:has(.shortcut-edit[data-shortcut-command="help.open"])');
  await expect(page.locator('.shortcut-edit[data-shortcut-command="palette.open"]')).toHaveValue('P');
  await expect(helpShortcut).toHaveValue('?');

  await helpShortcut.fill('P');
  await expect(helpShortcut).toHaveClass(/is-conflict/);
  await expect(helpRow).toHaveClass(/has-conflict/);
  await helpShortcut.evaluate(input => input.blur());

  await expect.poll(() => page.evaluate(() => window.app.contexts.commands.get('help.open').shortcut)).toBe('?');

  await helpShortcut.fill('Control+H');
  await expect(helpShortcut).not.toHaveClass(/is-conflict/);
  await helpShortcut.evaluate(input => input.blur());

  await expect.poll(() => page.evaluate(() => window.app.contexts.commands.get('help.open').shortcut)).toBe('Control+H');
});

test('frontend configurable ability opens node properties', async ({ page }) => {
  await page.goto('/');
  const nodeTemplate = await page.locator('#tpl-node').evaluate(template => template.innerHTML);
  expect(nodeTemplate).not.toContain('node.collapse.toggle');
  expect(nodeTemplate).not.toContain('item.properties.open');

  await page.getByRole('button', { name: 'Add node', exact: true }).click();

  const node = page.locator('.node').first();
  const toolbar = page.locator('.node-toolbar');
  await expect(node).toBeVisible();
  const compactHeight = (await node.boundingBox()).height;
  await expect(toolbar.locator('[data-command="item.collapse.toggle"]')).toHaveCount(0);
  await toolbar.locator('[data-command="item.properties.open"]').click();

  await expect(page.locator('.modal-layer[data-visual="properties"]')).toBeVisible();
  await expect(page.locator('.context-actions')).toBeVisible();

  await page.getByLabel('Item title').fill('Configured');
  await expect(node.locator('.node-title')).toHaveText('Configured');
  await page.locator('.properties [data-field="description"]').fill([
    '### Details',
    'A *rendered* paragraph.',
    '1. First',
    '2. Second',
    '> Visible context',
    '```js',
    'const ready = true;',
    '```',
  ].join('\n'));
  await expect(node.locator('.node-description h3')).toHaveText('Details');
  await expect(node.locator('.node-description em')).toHaveText('rendered');
  await expect(node.locator('.node-description ol li')).toHaveCount(2);
  await expect(node.locator('.node-description blockquote')).toHaveText('Visible context');
  await expect(node.locator('.node-description pre code')).toHaveText('const ready = true;');
  await expect.poll(async () => (await node.boundingBox()).height).toBeGreaterThan(compactHeight);

  await expect(page.locator('.properties [data-field="width"]')).toHaveCount(0);
  await expect(page.locator('.properties [data-field="height"]')).toHaveCount(0);

  await expect(page.locator('.properties [data-field="collapsed"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(toolbar.locator('[data-command="item.collapse.toggle"]')).toHaveText('⊟');
  await toolbar.locator('[data-command="item.collapse.toggle"]').click();
  await expect(node).toHaveClass(/collapsed/);
  await expect(toolbar.locator('[data-command="item.collapse.toggle"]')).toHaveText('⊞');
  const nodeBox = await node.boundingBox();
  const titleBox = await node.locator('.node-title').boundingBox();
  expect(nodeBox.height).toBeLessThan(compactHeight + 1);
  expect(Math.abs((nodeBox.y + nodeBox.height / 2) - (titleBox.y + titleBox.height / 2))).toBeLessThan(1);
});
