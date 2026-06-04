const { test, expect } = require('@playwright/test');

async function expectTheme(page, id, label) {
  await expect(page.locator('#btn-theme')).toHaveText(`Theme: ${label}`);
  const actual = await page.evaluate(() => document.documentElement.dataset.theme || 'default');
  expect(actual).toBe(id);
}

test('runtime theme switcher cycles default, grayscale, and blueprint', async ({ page }) => {
  await page.goto('/?theme=default');

  await expectTheme(page, 'default', 'Default');
  await page.locator('#btn-theme').click();
  await expectTheme(page, 'grayscale', 'Grayscale');

  await page.locator('#btn-theme').click();
  await expectTheme(page, 'blueprint', 'Blueprint');

  await page.locator('#btn-theme').click();
  await expectTheme(page, 'default', 'Default');

  await page.goto('/?theme=blueprint');
  await expectTheme(page, 'blueprint', 'Blueprint');
});
