const boot = async (page, url = '/') => {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.app));
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

module.exports = {
  boot,
  clickMore,
  openExamples,
  openGraphItem,
  openMore,
  openPaletteDrawer,
  openTypeCatalog,
  paletteRun,
};
