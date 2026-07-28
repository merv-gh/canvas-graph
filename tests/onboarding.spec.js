const { test, expect, setup, steps, checks } = require('./browser-testkit.cjs');
const clickGuide = page => steps.clickMore(page, 'Open getting-started guide');

test('guide opens from the toolbar and exposes all canonical starters', async ({ page }) => {
  await setup.app(page);
  await clickGuide(page);
  await expect(page.locator('.onboarding')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start creating/ })).toBeVisible();
  await expect(page.locator('.onboarding-storage')).toContainText('Saved in this browser');
  await expect(page.locator('.onboarding-examples')).not.toHaveAttribute('open', '');
  await expect(page.locator('.onboarding-example')).toHaveCount(9);
  const commands = await page.locator('.onboarding-example').evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('data-command')));
  expect(commands).toEqual([
    'demo.render-c4', 'demo.render-flowchart', 'demo.render-uml', 'demo.render-kimi-k2',
    'demo.render-agent-observability', 'demo.render-workflow', 'demo.render-mindmap',
    'demo.render-outline', 'demo.render-math',
  ]);
  await expect(page.getByLabel('Mermaid flowchart source')).toHaveValue(/flowchart LR/);
});

test('first-run guide and every architecture starter fit a laptop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setup.app(page);
  await clickGuide(page);
  await page.getByText('Browse all examples', { exact: false }).click();
  const modal = await page.locator('.modal-layer[data-visual="onboarding"] .modal').boundingBox();
  const last = page.locator('.onboarding-example').last();
  await last.scrollIntoViewIfNeeded();
  const lastExample = await last.boundingBox();
  expect(modal.y).toBeGreaterThanOrEqual(0);
  expect(modal.y + modal.height).toBeLessThanOrEqual(720);
  expect(lastExample.y).toBeGreaterThanOrEqual(modal.y);
  expect(lastExample.y + lastExample.height).toBeLessThanOrEqual(modal.y + modal.height);
  await expect(page.locator('.onboarding-architecture [data-brand="spring"]')).toHaveCount(5);
  await expect(page.locator('.onboarding-architecture [data-brand="kafka"]')).toHaveCount(1);
  await expect(page.locator('.onboarding-architecture [data-brand="postgres"]')).toHaveCount(4);
  await expect(page.locator('.onboarding-architecture [data-brand="redis"]')).toHaveCount(2);
});

test('hosted demo route opens the radial math map without onboarding', async ({ page }) => {
  await setup.app(page, '/?demo=math');
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('.node-title', { hasText: 'Expected value' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.app.contexts.view.get().scale)).toBeGreaterThanOrEqual(0.8);
});

test('a chosen demo keeps its readable fitted camera after refresh', async ({ page }) => {
  await setup.app(page);
  await clickGuide(page);
  await page.getByText('Browse all examples', { exact: false }).click();
  await page.getByRole('button', { name: /Expected-value model/ }).click();
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
