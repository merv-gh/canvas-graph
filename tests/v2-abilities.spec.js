const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('v2 routes DOM events through input adapter only', async () => {
  const v2Dir = path.join(__dirname, '..', 'v2');
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else if (entry.name.endsWith('.ts')) files.push(abs);
  });
  walk(v2Dir);
  const listeners = files.flatMap(file => fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.includes('addEventListener'))
    .map(line => `${path.relative(v2Dir, file)}: ${line.trim()}`));

  expect(listeners).toHaveLength(2);
  expect(listeners).toContain("app.ts: window.addEventListener('DOMContentLoaded', () => {");
  expect(listeners.some(line => line.includes('core/commands.ts:') && line.includes('root.addEventListener(type, route'))).toBe(true);
});

test('v2 help rejects duplicate shortcuts without saving', async ({ page }) => {
  await page.goto('/v2/');
  await page.locator('[data-command="help.open"]').click();

  const helpShortcut = page.locator('.shortcut-edit[data-shortcut-command="help.open"]');
  const helpRow = page.locator('.help-row:has(.shortcut-edit[data-shortcut-command="help.open"])');
  await expect(page.locator('.shortcut-edit[data-shortcut-command="palette.open"]')).toHaveValue('P');
  await expect(helpShortcut).toHaveValue('?');

  await helpShortcut.fill('P');
  await expect(helpShortcut).toHaveClass(/is-conflict/);
  await expect(helpRow).toHaveClass(/has-conflict/);
  await helpShortcut.evaluate(input => input.blur());

  await expect.poll(() => page.evaluate(() => window.v2.contexts.commands.get('help.open').shortcut)).toBe('?');

  await helpShortcut.fill('H');
  await expect(helpShortcut).not.toHaveClass(/is-conflict/);
  await helpShortcut.evaluate(input => input.blur());

  await expect.poll(() => page.evaluate(() => window.v2.contexts.commands.get('help.open').shortcut)).toBe('H');
});

test('v2 configurable ability opens node properties', async ({ page }) => {
  await page.goto('/v2/');
  const nodeTemplate = await page.locator('#tpl-node').evaluate(template => template.innerHTML);
  expect(nodeTemplate).not.toContain('node.collapse.toggle');
  expect(nodeTemplate).not.toContain('item.properties.open');

  await page.getByRole('button', { name: '+ Node' }).click();

  const node = page.locator('.node').first();
  await expect(node).toBeVisible();
  await expect(node.locator('[data-command="node.collapse.toggle"]')).toHaveText('-');
  await node.locator('[data-command="item.properties.open"]').click();

  await expect(page.locator('.modal-layer[data-visual="properties"]')).toBeVisible();
  await expect(page.locator('.modal-head')).toContainText('Node Properties');

  await page.locator('.properties [data-field="title"]').fill('Configured');
  await expect(node.locator('.node-title')).toHaveText('Configured');

  await page.locator('.properties [data-field="width"]').fill('220');
  await expect.poll(() => node.evaluate(el => getComputedStyle(el).width)).toBe('220px');

  await page.locator('.properties [data-field="collapsed"]').check();
  await expect(node).toHaveClass(/collapsed/);
});
