const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');

const OVERLAP_RGB = { r: 64, g: 64, b: 64 };
const OVERLAP_TOLERANCE = 8;
const MIN_COMPONENT_PIXELS = 12;

async function openScreenshotFixture(page, name, nodeCount) {
  await page.goto(`/?screenshot=1&fixture=${name}`);
  await page.waitForFunction(
    ([expectedFixture, expectedNodeCount]) =>
      document.body.dataset.fixtureReady === '1' &&
      document.body.dataset.fixture === expectedFixture &&
      document.querySelectorAll('.node').length === expectedNodeCount,
    [name, nodeCount],
  );
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

function isOverlapPixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  const [r, g, b, a] = png.data.slice(i, i + 4);
  if (a < 250) return false;
  return Math.abs(r - OVERLAP_RGB.r) <= OVERLAP_TOLERANCE &&
    Math.abs(g - OVERLAP_RGB.g) <= OVERLAP_TOLERANCE &&
    Math.abs(b - OVERLAP_RGB.b) <= OVERLAP_TOLERANCE;
}

function findOverlapBoxes(png) {
  const { width, height } = png;
  const visited = new Uint8Array(width * height);
  const boxes = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start]) continue;
      visited[start] = 1;
      if (!isOverlapPixel(png, x, y)) continue;

      const stack = [[x, y]];
      const box = { minX: x, minY: y, maxX: x, maxY: y, pixels: 0 };

      while (stack.length) {
        const [cx, cy] = stack.pop();
        box.pixels++;
        box.minX = Math.min(box.minX, cx);
        box.minY = Math.min(box.minY, cy);
        box.maxX = Math.max(box.maxX, cx);
        box.maxY = Math.max(box.maxY, cy);

        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (visited[next]) continue;
          visited[next] = 1;
          if (isOverlapPixel(png, nx, ny)) stack.push([nx, ny]);
        }
      }

      if (box.pixels >= MIN_COMPONENT_PIXELS) boxes.push(box);
    }
  }

  return boxes;
}

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = a;
}

function drawRedSquare(png, cx, cy, size = 24, thickness = 3) {
  const half = Math.floor(size / 2);
  const left = Math.round(cx - half);
  const right = Math.round(cx + half);
  const top = Math.round(cy - half);
  const bottom = Math.round(cy + half);

  for (let t = 0; t < thickness; t++) {
    for (let x = left; x <= right; x++) {
      setPixel(png, x, top + t, 255, 0, 0);
      setPixel(png, x, bottom - t, 255, 0, 0);
    }
    for (let y = top; y <= bottom; y++) {
      setPixel(png, left + t, y, 255, 0, 0);
      setPixel(png, right - t, y, 255, 0, 0);
    }
  }
}

async function scanNodeIntersections(page, testInfo, label) {
  const screenshot = await page.screenshot({ animations: 'disabled' });
  const png = PNG.sync.read(screenshot);
  const boxes = findOverlapBoxes(png);
  let annotationPath = null;

  if (boxes.length) {
    const annotated = PNG.sync.read(screenshot);
    for (const box of boxes) {
      drawRedSquare(
        annotated,
        (box.minX + box.maxX) / 2,
        (box.minY + box.maxY) / 2,
      );
    }

    annotationPath = testInfo.outputPath(`${label}-intersections.png`);
    fs.mkdirSync(path.dirname(annotationPath), { recursive: true });
    fs.writeFileSync(annotationPath, PNG.sync.write(annotated));
    await testInfo.attach(`${label} intersections`, {
      path: annotationPath,
      contentType: 'image/png',
    });
  }

  return { boxes, annotationPath };
}

async function expectNoNodeIntersections(page, testInfo, label) {
  const result = await scanNodeIntersections(page, testInfo, label);
  const summary = result.boxes
    .map((box, index) => {
      const width = box.maxX - box.minX + 1;
      const height = box.maxY - box.minY + 1;
      return `#${index + 1} (${box.minX},${box.minY}) ${width}x${height}`;
    })
    .join(', ');

  expect(
    result.boxes,
    `Detected node intersections by overlap color rgb(${OVERLAP_RGB.r}, ${OVERLAP_RGB.g}, ${OVERLAP_RGB.b}). ` +
      `Annotated screenshot: ${result.annotationPath || '(not written)'}. ${summary}`,
  ).toEqual([]);
}

test.describe('screenshot node intersection guard', () => {
  test('separated hardcoded baseline has no node intersections', async ({ page }, testInfo) => {
    await openScreenshotFixture(page, 'separated', 2);
    await expectNoNodeIntersections(page, testInfo, 'separated');
  });

  test('overlapping hardcoded baseline produces red-square annotation', async ({ page }, testInfo) => {
    await openScreenshotFixture(page, 'overlapping', 2);
    const result = await scanNodeIntersections(page, testInfo, 'overlapping');

    expect(result.boxes.length).toBeGreaterThan(0);
    expect(result.annotationPath).toBeTruthy();
    expect(fs.existsSync(result.annotationPath)).toBe(true);
  });
});
