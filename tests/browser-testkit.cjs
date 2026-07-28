const { expect, test } = require('@playwright/test');

const boot = async (page, url = '/') => {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.app));
};

const bootDemo = async (page, demo, minimumNodes = 1) => {
  await boot(page, `/?demo=${demo}`);
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.nodes().length))
    .toBeGreaterThanOrEqual(minimumNodes);
};

const bootMobile = async (page, url = '/') => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, url);
};

const bootWithFlags = async (page, overrides = {}) => {
  await page.addInitScript(({ flags }) => {
    try { localStorage.setItem('frontend.flags', JSON.stringify(flags)); } catch (_) { /* storage unavailable */ }
  }, { flags: overrides });
  await boot(page);
};

const openMore = async page => {
  const overflow = page.locator('.toolbar-overflow');
  if (!(await overflow.evaluate(element => element.open))) {
    await page.getByLabel('More actions').click();
  }
};

const clickMore = async (page, name) => {
  await openMore(page);
  await page.getByRole('button', { name, exact: true }).click();
};

const openExamples = page => page.getByText('Browse all examples', { exact: false }).click();

const openGraphItem = (page, kind, label) => page.evaluate(({ kind, label }) => {
  const graph = window.app.graphs.current;
  const items = kind === 'node'
    ? graph.nodes()
    : kind === 'edge'
      ? graph.edges()
      : graph.itemsOfKind('container');
  const item = label
    ? items.find(candidate => candidate.Label?.text?.includes(label))
    : items[0];
  window.app.bus.emit('outline.item.open', {
    graphId: graph.id,
    ref: { kind, id: item.id },
  });
}, { kind, label });

const paletteRun = async (page, label) => {
  await page.keyboard.press('p');
  await page.locator('.palette-search').fill(label);
  await page.keyboard.press('Enter');
};

const openPaletteDrawer = async page => {
  const drawer = page.locator('.graph-navigator');
  if (await drawer.getAttribute('data-outline-folded') === 'true') {
    await page.getByRole('button', { name: 'Expand graph navigator', exact: true }).click();
  }
};

const openTypeCatalog = async page => {
  await openPaletteDrawer(page);
  const toggle = page.locator('[data-fold-id="palette.catalog"]');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
};

const graphItemCount = (page, kind) => page.evaluate(itemKind => {
  const graph = window.app.graphs.current;
  if (itemKind === 'nodes') return graph.nodes().length;
  if (itemKind === 'edges') return graph.edges().length;
  return graph.itemsOfKind('container').length;
}, kind);

const expectGraphItems = async (page, kind, count) => {
  await expect.poll(() => graphItemCount(page, kind)).toBe(count);
};

const expectGraphItemsAtLeast = async (page, kind, count) => {
  await expect.poll(() => graphItemCount(page, kind)).toBeGreaterThanOrEqual(count);
};

const expectInsideViewport = async (locator, viewport) => {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
};

const setup = Object.freeze({ app: boot, demo: bootDemo, flags: bootWithFlags, mobile: bootMobile });
const steps = Object.freeze({
  clickMore,
  openExamples,
  openGraphItem,
  openMore,
  openPaletteDrawer,
  openTypeCatalog,
  paletteRun,
});
const checks = Object.freeze({
  graphItems: expectGraphItems,
  graphItemsAtLeast: expectGraphItemsAtLeast,
  insideViewport: expectInsideViewport,
});

module.exports = {
  checks,
  boot,
  clickMore,
  openExamples,
  openGraphItem,
  openMore,
  openPaletteDrawer,
  openTypeCatalog,
  paletteRun,
  setup,
  steps,
  expect,
  test,
};
