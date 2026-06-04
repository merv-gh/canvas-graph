const { test, expect } = require('@playwright/test');

test('case recorder exports replayable case JSON to clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?theme=default');
  await page.evaluate(() => {
    window.__ecsGraphTest.resetGraphState();
    window.__ecsGraphTest.renderNow();
  });

  await page.locator('#btn-case-record').click();
  await expect(page.locator('#btn-case-record')).toHaveText('Rec: 1');

  await page.keyboard.press('a');
  await page.waitForTimeout(80);
  await page.keyboard.press('a');
  await page.waitForTimeout(80);
  await expect(page.locator('#btn-case-record')).toHaveText(/Rec: [3-9]\d*/);

  await page.locator('#btn-case-record').click();
  await page.locator('#btn-case-export').click();
  await expect(page.locator('#btn-case-export')).toHaveText('Copied');

  const exported = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  expect(exported.schemaVersion).toBe(1);
  expect(exported.assertions.noPixelIntersections).toBe(true);
  expect(exported.checkpoints.length).toBeGreaterThan(1);

  await page.goto('/?screenshot=1');
  await page.waitForFunction(() => !!window.__ecsGraphTest);
  await page.evaluate(
    data => window.__ecsGraphTest.loadCaseCheckpoint(data, data.checkpoints.length - 1),
    exported,
  );
  await page.waitForFunction(() => document.querySelectorAll('.node').length === 2);
});
