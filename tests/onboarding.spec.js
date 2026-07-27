const { test, expect } = require('@playwright/test');
const clickGuide = async page => {
  await page.getByLabel('More actions').click();
  await page.getByRole('button', { name: 'Open getting-started guide', exact: true }).click();
};

test('guide opens from the toolbar and exposes all canonical starters', async ({ page }) => {
  await page.goto('/');
  await clickGuide(page);
  await expect(page.locator('.onboarding')).toBeVisible();
  await expect(page.locator('.onboarding-example')).toHaveCount(9);
  const commands = await page.locator('.onboarding-example').evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('data-command')));
  expect(commands).toEqual([
    'demo.render-math', 'demo.render-kimi-k2', 'demo.render-workflow', 'demo.render-flowchart',
    'demo.render-mindmap', 'demo.render-c4', 'demo.render-uml', 'demo.render-outline',
    'demo.render-agent-observability',
  ]);
  await expect(page.getByLabel('Mermaid flowchart source')).toHaveValue(/flowchart LR/);
});

test('hosted demo route opens the radial math map without onboarding', async ({ page }) => {
  await page.goto('/?demo=math');
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('.node-title', { hasText: 'Expected value' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.app.contexts.view.get().scale)).toBeGreaterThanOrEqual(0.8);
});

test('a chosen demo keeps its readable fitted camera after refresh', async ({ page }) => {
  await page.goto('/');
  await clickGuide(page);
  await page.getByRole('button', { name: /Expected value/ }).click();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.app.contexts.view.get().scale)).toBeGreaterThanOrEqual(0.8);
  const fitted = await page.evaluate(() => window.app.contexts.view.get());

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(7);
  await expect.poll(() => page.evaluate(expected => {
    const view = window.app.contexts.view.get();
    return Math.max(
      Math.abs(view.x - expected.x),
      Math.abs(view.y - expected.y),
      Math.abs(view.scale - expected.scale),
      view.scale < 0.8 ? 999 : 0,
    );
  }, fitted)).toBeLessThan(0.01);
});
