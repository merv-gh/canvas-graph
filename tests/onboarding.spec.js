const { test, expect } = require('@playwright/test');

test('guide opens from the toolbar and exposes all canonical starters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open getting-started guide' }).click();
  await expect(page.locator('.onboarding')).toBeVisible();
  await expect(page.locator('.onboarding-example')).toHaveCount(3);
  await expect(page.getByLabel('Mermaid flowchart source')).toHaveValue(/flowchart LR/);
});

test('hosted demo route opens the radial math map without onboarding', async ({ page }) => {
  await page.goto('/?demo=math');
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await expect(page.locator('.node-title', { hasText: 'Expected value' })).toBeVisible();
  await expect(page.locator('.node')).toHaveCount(7);
});
