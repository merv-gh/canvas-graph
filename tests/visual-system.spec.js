const { test, expect } = require('@playwright/test');

const rgb = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const luminance = value => {
  const channels = rgb(value).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (foreground, background) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};
const attachScreenshot = async (page, testInfo, name) => testInfo.attach(name, {
  body: await page.screenshot({ animations: 'disabled' }),
  contentType: 'image/png',
});

test('light and dark canvases preserve contrast and hierarchy', async ({ page }, testInfo) => {
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length === 11);

  const hierarchy = () => page.locator('.node').first().evaluate(node => {
    const surface = getComputedStyle(node).backgroundColor;
    return {
      body: getComputedStyle(node.querySelector('.node-body')).color,
      surface,
      title: getComputedStyle(node.querySelector('.node-title')).color,
    };
  });
  const assertHierarchy = async () => {
    const colors = await hierarchy();
    expect(contrast(colors.body, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.title, colors.surface)).toBeGreaterThan(contrast(colors.body, colors.surface));
  };

  await assertHierarchy();
  await page.evaluate(() => window.app.bus.emit('theme.toggle'));
  await assertHierarchy();
  await attachScreenshot(page, testInfo, 'visual-system-dark');
});

test('onboarding and inspector keep readable measure and de-emphasized labels', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length === 11);
  await page.evaluate(() => window.app.bus.emit('onboarding.open'));

  const measure = await page.locator('.onboarding-intro > p:not(.onboarding-storage)').evaluate(element => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().width / parseFloat(style.fontSize);
  });
  expect(measure).toBeLessThanOrEqual(65);
  await page.evaluate(() => window.app.bus.emit('onboarding.dismiss'));

  await page.evaluate(() => {
    const id = window.app.graphs.current.nodes()[0].id;
    window.app.bus.emit('item.properties.open', { kind: 'node', id });
  });
  await expect(page.locator('.properties-inspector')).toBeVisible();
  const hierarchy = await page.evaluate(() => {
    const label = getComputedStyle(document.querySelector('.properties-context-header > span'));
    const value = getComputedStyle(document.querySelector('.item-modal-title'));
    return {
      labelColor: label.color,
      labelSize: parseFloat(label.fontSize),
      valueColor: value.color,
      valueSize: parseFloat(value.fontSize),
    };
  });
  expect(hierarchy.labelSize).toBeLessThan(hierarchy.valueSize);
  expect(hierarchy.labelColor).not.toBe(hierarchy.valueColor);
  await attachScreenshot(page, testInfo, 'visual-system-inspector');
});

test('mobile drawer fits the viewport and keeps 44px primary touch targets', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo=agent-observability');
  await page.waitForFunction(() => window.app.graphs.current.nodes().length === 11);
  await page.getByRole('button', { name: 'Expand graph navigator', exact: true }).click();

  const layout = await page.evaluate(() => {
    const drawer = document.querySelector('.graph-navigator').getBoundingClientRect();
    const targets = [...document.querySelectorAll('.top button, .graph-navigator-toggle')]
      .filter(button => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      })
      .map(button => {
        const rect = button.getBoundingClientRect();
        return { height: rect.height, name: button.getAttribute('aria-label') ?? button.textContent.trim(), width: rect.width };
      });
    return {
      drawer: { bottom: drawer.bottom, left: drawer.left, right: drawer.right, top: drawer.top },
      overflow: document.documentElement.scrollWidth - innerWidth,
      targets,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.drawer.left).toBeGreaterThanOrEqual(0);
  expect(layout.drawer.right).toBeLessThanOrEqual(390);
  expect(layout.drawer.top).toBeGreaterThanOrEqual(0);
  expect(layout.drawer.bottom).toBeLessThanOrEqual(844);
  expect(layout.targets.length).toBeGreaterThan(0);
  layout.targets.forEach(target => {
    expect(target.height, target.name).toBeGreaterThanOrEqual(44);
    expect(target.width, target.name).toBeGreaterThanOrEqual(44);
  });
  await attachScreenshot(page, testInfo, 'visual-system-mobile-drawer');
});
