import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, type Page } from '@playwright/test';

const RUN = process.env.PERF_INPUT === '1';
const LABEL = process.env.PERF_LABEL ?? 'after';
const PERF_URL = process.env.PERF_URL;
const REPORT = resolve(process.cwd(), `dx/bench/INPUT-DELAY-${LABEL}.md`);
const SCREENSHOT = resolve(process.cwd(), `dx/bench/input-delay-${LABEL}.png`);
const MODAL_SCREENSHOT = resolve(process.cwd(), `dx/bench/perf-modal-${LABEL}.png`);
const TARGET_INPUT_DELAY_MS = Number(process.env.PERF_TARGET_INPUT_DELAY_MS ?? 40);

type EventTimingRow = {
  name: string;
  target: string;
  startTime: number;
  duration: number;
  processingStart: number;
  processingEnd: number;
  inputDelay: number;
  processingDuration: number;
  presentationDelay: number;
  interactionId: number;
};

type PerfSnapshot = {
  timings: { label: string; calls: number; totalMs: number; avgMs: number; maxMs: number }[];
  samples: { label: string; samples: number; min: number; max: number; avg: number; last: number }[];
  inputs: {
    source: string;
    name: string;
    target: string;
    inputDelay: number;
    processingDuration: number;
    presentationDelay: number;
    duration: number;
    path?: string[];
    candidates?: string[];
    matched?: string[];
  }[];
  longTasks: { name: string; start: number; duration: number }[];
};

test.skip(!RUN, 'Set PERF_INPUT=1 to run input-delay scenario.');
test.setTimeout(90_000);

const ms = (value: number | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value < 1 ? value.toFixed(2) : value.toFixed(0);

const settle = async (page: Page, frames = 2) => {
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
  }
};

const installEventTimingObserver = async (page: Page) => {
  await page.addInitScript(() => {
    const selectorFor = (target: unknown) => {
      if (!(target instanceof Element)) return '';
      const bits: string[] = [];
      let el: Element | null = target;
      while (el && bits.length < 4) {
        const id = el.id ? `#${el.id}` : '';
        const cls = [...el.classList].slice(0, 3).map(name => `.${name}`).join('');
        const item = el instanceof HTMLElement && el.dataset.itemKind && el.dataset.itemId
          ? `[${el.dataset.itemKind}:${el.dataset.itemId}]`
          : '';
        bits.unshift(`${el.localName}${id}${cls}${item}`);
        el = el.parentElement;
      }
      return bits.join(' > ');
    };
    const rows: EventTimingRow[] = [];
    (window as unknown as { __eventTimings: EventTimingRow[] }).__eventTimings = rows;
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes('event')) return;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & {
          processingStart?: number;
          processingEnd?: number;
          interactionId?: number;
          target?: EventTarget | null;
        };
        const processingStart = e.processingStart ?? e.startTime;
        const processingEnd = e.processingEnd ?? processingStart;
        const inputDelay = Math.max(0, processingStart - e.startTime);
        const processingDuration = Math.max(0, processingEnd - processingStart);
        const presentationDelay = Math.max(0, e.duration - inputDelay - processingDuration);
        rows.push({
          name: e.name,
          target: selectorFor(e.target),
          startTime: e.startTime,
          duration: e.duration,
          processingStart,
          processingEnd,
          inputDelay,
          processingDuration,
          presentationDelay,
          interactionId: e.interactionId ?? 0,
        });
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 0 } as PerformanceObserverInit);
  });
};

const resetEventTimings = async (page: Page) =>
  page.evaluate(() => { ((window as unknown as { __eventTimings?: unknown[] }).__eventTimings ?? []).length = 0; });

const appPerf = async (page: Page): Promise<PerfSnapshot> =>
  page.evaluate(() => (window as unknown as { app: { perf: { snapshot(): PerfSnapshot } } }).app.perf.snapshot());

const resetAppPerf = async (page: Page) =>
  page.evaluate(() => (window as unknown as { app: { perf: { reset(): void } } }).app.perf.reset());

const seedSmallGraph = async (page: Page) => {
  await page.evaluate(() => {
    const snapshot = {
      nodes: [
        { id: 'e1', Label: { text: 'Alpha' }, Position: { x: 300, y: 220 }, Size: { w: 150, h: 64 } },
        { id: 'e2', Label: { text: 'Beta' }, Position: { x: 560, y: 220 }, Size: { w: 150, h: 64 } },
        { id: 'e3', Label: { text: 'Gamma' }, Position: { x: 430, y: 380 }, Size: { w: 150, h: 64 } },
      ],
      edges: [
        { id: 'r1', From: 'e1', To: 'e2' },
        { id: 'r2', From: 'e2', To: 'e3' },
      ],
    };
    const app = (window as unknown as {
      app: {
        bus: { emit(name: string, data?: unknown): void };
        perf: { setEnabled(on: boolean): void; reset(): void };
      };
    }).app;
    app.perf.setEnabled(true);
    app.perf.reset();
    app.bus.emit('graph.import.snapshot', snapshot);
  });
  await page.waitForSelector('.node[data-item-id="e1"]');
  await settle(page, 3);
};

const dragSelectedNode = async (page: Page, selector = '.node[data-item-id="e1"]') => {
  const node = page.locator(selector).first();
  await node.waitFor({ state: 'visible' });
  await node.click();
  await page.waitForSelector('.node-toolbar .node-drag-handle');
  await settle(page, 2);
  await resetAppPerf(page);
  await resetEventTimings(page);
  const handle = page.locator('.node-toolbar .node-drag-handle');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Missing drag handle box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 180, y + 70, { steps: 24 });
  await page.mouse.up();
  await settle(page, 8);
};

const renderReport = (events: EventTimingRow[], perf: PerfSnapshot) => {
  const interactions = events.filter(event => event.interactionId > 0);
  const maxInputDelay = Math.max(0, ...events.map(event => event.inputDelay));
  const maxInteractionInputDelay = Math.max(0, ...interactions.map(event => event.inputDelay));
  const maxDuration = Math.max(0, ...events.map(event => event.duration));
  const topEvents = [...events].sort((a, b) => b.inputDelay - a.inputDelay).slice(0, 20);
  const topAppInputs = [...(perf.inputs ?? [])].sort((a, b) => b.inputDelay - a.inputDelay).slice(0, 20);
  const topLongTasks = [...(perf.longTasks ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 20);
  const topTimings = perf.timings.slice(0, 20);
  const samples = perf.samples.slice(0, 20);
  const scenario = PERF_URL ? `real URL: \`${PERF_URL.slice(0, 180)}${PERF_URL.length > 180 ? '...' : ''}\`` : 'small graph, select one node, drag via toolbar handle.';
  return `# Input delay ${LABEL}

Scenario: ${scenario}

## Gates

Metric | Target | Actual | Status
---|---:|---:|---
Max input delay | ${TARGET_INPUT_DELAY_MS} ms | ${ms(maxInputDelay)} ms | ${maxInputDelay <= TARGET_INPUT_DELAY_MS ? 'PASS' : 'FAIL'}
Max interaction input delay | ${TARGET_INPUT_DELAY_MS} ms | ${ms(maxInteractionInputDelay)} ms | ${maxInteractionInputDelay <= TARGET_INPUT_DELAY_MS ? 'PASS' : 'FAIL'}
Max EventTiming duration | 100 ms | ${ms(maxDuration)} ms | ${maxDuration <= 100 ? 'PASS' : 'WARN'}

## EventTiming phases

Event | Target | Duration | Input delay | Processing | Presentation | Interaction
---|---|---:|---:|---:|---:|---:
${topEvents.map(event => `${event.name} | ${event.target || '-'} | ${ms(event.duration)} | ${ms(event.inputDelay)} | ${ms(event.processingDuration)} | ${ms(event.presentationDelay)} | ${event.interactionId || '-'}`).join('\n')}

## App input listener paths

Event | Source | Duration | Input delay | Processing | Presentation | Matched | Candidates | Path
---|---|---:|---:|---:|---:|---|---|---
${topAppInputs.map(row => `${row.name} | ${row.source} | ${ms(row.duration)} | ${ms(row.inputDelay)} | ${ms(row.processingDuration)} | ${ms(row.presentationDelay)} | ${(row.matched ?? []).join(', ') || '-'} | ${(row.candidates ?? []).join(', ') || '-'} | ${(row.path ?? [row.target || '-']).join(' -> ')}`).join('\n')}

## Long tasks

Name | When | Duration
---|---:|---:
${topLongTasks.length ? topLongTasks.map(row => `${row.name || 'longtask'} | ${ms(row.start)} | ${ms(row.duration)}`).join('\n') : 'none | - | -'}

## App timeline aggregates

Label | Calls | Total | Max
---|---:|---:|---:
${topTimings.map(row => `\`${row.label}\` | ${row.calls} | ${ms(row.totalMs)} | ${ms(row.maxMs)}`).join('\n')}

## Samples

Label | Samples | Min | Max | Avg | Last
---|---:|---:|---:|---:|---:
${samples.map(row => `\`${row.label}\` | ${row.samples} | ${ms(row.min)} | ${ms(row.max)} | ${ms(row.avg)} | ${ms(row.last)}`).join('\n')}

Screenshot: \`${SCREENSHOT}\`
Perf modal screenshot: \`${MODAL_SCREENSHOT}\`

_Updated: ${new Date().toISOString()}_
`;
};

test('small node drag input delay', async ({ page }) => {
  await installEventTimingObserver(page);
  await page.goto(PERF_URL ?? '/?io=memory&perf=1');
  await page.waitForFunction(() => !!(window as unknown as { app?: unknown }).app);
  let selector = '.node';
  if (!PERF_URL) {
    await seedSmallGraph(page);
    selector = '.node[data-item-id="e1"]';
  } else {
    await page.evaluate(() => {
      const app = (window as unknown as {
        app: {
          bus: { emit(name: string): void };
          perf: { setEnabled(on: boolean): void; reset(): void };
        };
      }).app;
      app.perf.setEnabled(true);
      app.perf.reset();
      app.bus.emit('view.fit.all');
    });
    await page.waitForSelector('.node');
    await settle(page, 8);
  }
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  await dragSelectedNode(page, selector);
  await page.screenshot({ path: SCREENSHOT, fullPage: true });

  const events = await page.evaluate(() => (window as unknown as { __eventTimings: EventTimingRow[] }).__eventTimings);
  const perf = await appPerf(page);
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, renderReport(events, perf));
  await page.evaluate(() => (window as unknown as { app: { bus: { emit(name: string): void } } }).app.bus.emit('perf.show'));
  await settle(page, 3);
  await page.screenshot({ path: MODAL_SCREENSHOT, fullPage: true });
});
