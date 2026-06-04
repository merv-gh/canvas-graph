const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');

const OVERLAP_RGB = { r: 64, g: 64, b: 64 };
const OVERLAP_TOLERANCE = 8;
const MIN_COMPONENT_PIXELS = 12;
const CASES_DIR = path.join(__dirname, '..', 'cases');

function loadCaseFiles() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => {
      const filePath = path.join(CASES_DIR, file);
      return { file, filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    });
}

function caseCheckpoints(caseData) {
  if (Array.isArray(caseData.checkpoints) && caseData.checkpoints.length) return caseData.checkpoints;
  if (caseData.snapshot) return [{ label: caseData.name || 'snapshot', snapshot: caseData.snapshot }];
  return [{ label: caseData.name || 'snapshot', snapshot: caseData }];
}

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

async function openScreenshotSeed(page) {
  await page.goto('/?screenshot=1');
  await page.waitForFunction(() => document.querySelectorAll('.node').length === 12);
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function openScreenshotScript(page, script, checkpoint) {
  await page.goto(`/?screenshot=1&script=${script}&checkpoint=${checkpoint}`);
  await page.waitForFunction(
    ([expectedScript, expectedCheckpoint]) =>
      document.body.dataset.fixtureReady === '1' &&
      document.body.dataset.script === expectedScript &&
      document.body.dataset.checkpoint === expectedCheckpoint &&
      Number(document.body.dataset.visibleNodeCount || 0) > 0,
    [script, checkpoint],
  );
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function openScreenshotCase(page, caseData, checkpointIndex) {
  const viewport = caseData.viewport || { width: 800, height: 600 };
  await page.setViewportSize({ width: viewport.width || 800, height: viewport.height || 600 });
  await page.goto('/?screenshot=1');
  await page.waitForFunction(() => !!window.__ecsGraphTest);
  await page.evaluate(
    ({ data, index }) => window.__ecsGraphTest.loadCaseCheckpoint(data, index),
    { data: caseData, index: checkpointIndex },
  );
  await page.waitForFunction(() => document.body.dataset.fixtureReady === '1');
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

function isOverlapPixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  const [r, g, b, a] = png.data.slice(i, i + 4);
  if (a < 250) return false;
  const isGray = Math.max(r, g, b) - Math.min(r, g, b) <= OVERLAP_TOLERANCE;
  const isDarkerThanOneNode = r <= OVERLAP_RGB.r + OVERLAP_TOLERANCE &&
    g <= OVERLAP_RGB.g + OVERLAP_TOLERANCE &&
    b <= OVERLAP_RGB.b + OVERLAP_TOLERANCE;
  return isGray && isDarkerThanOneNode;
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
  if (!result.boxes.length) return;

  const summary = result.boxes
    .map((box, index) => {
      const width = box.maxX - box.minX + 1;
      const height = box.maxY - box.minY + 1;
      return `#${index + 1} (${box.minX},${box.minY}) ${width}x${height}`;
    })
    .join(', ');

  throw new Error(
    `${label}: PIXEL_INTERSECTIONS count=${result.boxes.length} ` +
      `color=rgb(${OVERLAP_RGB.r},${OVERLAP_RGB.g},${OVERLAP_RGB.b}) ` +
      `annotated=${result.annotationPath || '(not written)'} boxes=${summary}`,
  );
}

function boxesIntersect(a, b) {
  return Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
    Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
}

function boxGap(a, b) {
  const dx = Math.max(a.left - b.right, b.left - a.right, 0);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.hypot(dx, dy);
}

async function visibleNodeBoxes(page) {
  return page.evaluate(() => [...document.querySelectorAll('.node')]
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => {
      const r = el.getBoundingClientRect();
      return {
        eid: el.dataset.eid,
        title: el.querySelector('.title')?.textContent || '',
        classes: el.className,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    })
    .filter(box => box.width > 0 && box.height > 0));
}

async function expectDomNodeClearance(page, minGap, label) {
  const boxes = await visibleNodeBoxes(page);
  const failures = [];

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const gap = boxGap(a, b);
      if (boxesIntersect(a, b) || gap < minGap) {
        failures.push({
          a: `${a.title || a.eid} (${Math.round(a.left)},${Math.round(a.top)})`,
          b: `${b.title || b.eid} (${Math.round(b.left)},${Math.round(b.top)})`,
          gap: Math.round(gap * 10) / 10,
        });
      }
    }
  }

  if (failures.length) {
    const pairs = failures
      .map((failure, index) => `#${index + 1} ${failure.a} vs ${failure.b} gap=${failure.gap}`)
      .join('; ');
    throw new Error(`${label}: DOM_CLEARANCE count=${failures.length} minGap=${minGap}px pairs=${pairs}`);
  }
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

  test('default seeded graph has no node intersections', async ({ page }, testInfo) => {
    await openScreenshotSeed(page);
    await expectNoNodeIntersections(page, testInfo, 'default-seed');
  });
});

const DEMO_MEMORY_CHECKPOINTS = [
  'root-added',
  'top-level-expanded',
  'heap-children-just-added',
  'stack-children-just-added',
  'deep-object-just-added',
  'deep-ref-just-added',
  'heap-collapsed',
  'heap-expanded-again',
];

test.describe('scripted demo states', () => {
  for (const checkpoint of DEMO_MEMORY_CHECKPOINTS) {
    test(`demoMemory ${checkpoint} has no node intersections`, async ({ page }, testInfo) => {
      await openScreenshotScript(page, 'demoMemory', checkpoint);
      await expectNoNodeIntersections(page, testInfo, `demoMemory-${checkpoint}`);
    });
  }
});

const CASE_FILES = loadCaseFiles();

test.describe('saved regression cases', () => {
  for (const caseFile of CASE_FILES) {
    const checkpoints = caseCheckpoints(caseFile.data);
    checkpoints.forEach((checkpoint, index) => {
      const caseName = caseFile.data.name || caseFile.file;
      const label = checkpoint.label || `checkpoint-${index}`;
      test(`${caseName} ${label}`, async ({ page }, testInfo) => {
        await openScreenshotCase(page, caseFile.data, index);
        const assertions = {
          noPixelIntersections: true,
          noDomIntersections: true,
          ...(caseFile.data.assertions || {}),
          ...(checkpoint.assertions || {}),
        };

        if (assertions.noPixelIntersections) {
          await expectNoNodeIntersections(page, testInfo, `${caseName}-${label}`);
        }
        if (assertions.noDomIntersections) {
          await expectDomNodeClearance(page, assertions.minDomGap || 0, `${caseName}-${label}`);
        }
      });
    });
  }
});
