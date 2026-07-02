import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

const RUN = process.env.PERF_BROWSER === '1';
const NODE_COUNT = Number(process.env.PERF_NODES ?? 10_000);
const EDGE_COUNT = Number(process.env.PERF_EDGES ?? 10_000);
const MASS_COUNT = Number(process.env.PERF_MASS ?? 1_000);
const MASS_CHUNK = Number(process.env.PERF_MASS_CHUNK ?? 25);
const REPORT = resolve(process.cwd(), process.env.PERF_REPORT ?? 'dx/bench/BROWSER-RESULTS.md');
const TARGET_INP_MS = Number(process.env.PERF_TARGET_INP_MS ?? 40);
const TARGET_INPUT_DELAY_MS = Number(process.env.PERF_TARGET_INPUT_DELAY_MS ?? 40);
const TARGET_MCP_MS = Number(process.env.PERF_TARGET_MCP_MS ?? 300);
const TARGET_STEP_MS = Number(process.env.PERF_TARGET_STEP_MS ?? 300);
const ENFORCE = process.env.PERF_ENFORCE !== '0';
const TITLE_EDIT = process.env.PERF_TITLE === '1';

type MetricMap = Record<string, number>;
type PerfSnapshot = {
  timings: { label: string; calls: number; totalMs: number; avgMs: number; maxMs: number }[];
  counts: { label: string; count: number }[];
  samples: { label: string; samples: number; min: number; max: number; avg: number; last: number }[];
};
type StepResult = {
  name: string;
  wallMs: number;
  dom: { nodes: number; edges: number; renderedNodes: number; renderedEdges: number; heapUsed?: number; heapTotal?: number };
  core: PerfSnapshot;
};
type TraceEvent = { name?: string; cat?: string; ph?: string; dur?: number; ts?: number; tid?: number };
type BrowserEventRow = {
  duration?: number;
  name?: string;
  interactionId?: number;
  target?: string;
  inputDelay?: number;
  processingDuration?: number;
  presentationDelay?: number;
};

test.skip(!RUN, 'Set PERF_BROWSER=1 to run real browser/CDP perf scenario.');
test.setTimeout(Number(process.env.PERF_TIMEOUT_MS ?? 180_000));

const ms = (value: number | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value < 1 ? value.toFixed(2) : value.toFixed(0);

const settle = async (page: Page, frames = 2) => {
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
  }
};

const installBrowserObservers = async (page: Page) => {
  await page.addInitScript(() => {
    const selectorFor = (target: unknown) => {
      if (!(target instanceof Element)) return '';
      const parts: string[] = [];
      let el: Element | null = target;
      while (el && parts.length < 4) {
        const id = el.id ? `#${el.id}` : '';
        const cls = [...el.classList].slice(0, 3).map(name => `.${name}`).join('');
        const item = el instanceof HTMLElement && el.dataset.itemKind && el.dataset.itemId
          ? `[${el.dataset.itemKind}:${el.dataset.itemId}]`
          : '';
        parts.unshift(`${el.localName}${id}${cls}${item}`);
        el = el.parentElement;
      }
      return parts.join(' > ');
    };
    const state = {
      longTasks: [] as unknown[],
      events: [] as BrowserEventRow[],
      firstInputs: [] as unknown[],
      lcp: [] as unknown[],
      cls: 0,
    };
    (window as unknown as { __browserPerf: typeof state }).__browserPerf = state;
    const supported = new Set(PerformanceObserver.supportedEntryTypes ?? []);
    const clone = (entry: PerformanceEntry) => entry.toJSON ? entry.toJSON() : {
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
    };
    const observe = (type: string, onEntries: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) => {
      if (!supported.has(type)) return;
      try {
        new PerformanceObserver(list => onEntries(list.getEntries())).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      } catch {
        // Browser does not support this observer shape.
      }
    };
    const cloneEvent = (entry: PerformanceEntry) => {
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
      return {
        name: e.name,
        duration: e.duration,
        interactionId: e.interactionId ?? 0,
        target: selectorFor(e.target),
        inputDelay,
        processingDuration,
        presentationDelay,
      };
    };
    observe('longtask', entries => { state.longTasks.push(...entries.map(clone)); });
    observe('first-input', entries => { state.firstInputs.push(...entries.map(clone)); });
    observe('largest-contentful-paint', entries => { state.lcp.push(...entries.map(clone)); });
    observe('layout-shift', entries => {
      entries.forEach(entry => {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) state.cls += shift.value ?? 0;
      });
    });
    observe('event', entries => { state.events.push(...entries.map(cloneEvent)); }, { durationThreshold: 0 });
  });
};

const resetBrowserObservers = async (page: Page) => {
  await page.evaluate(() => {
    const perf = (window as unknown as { __browserPerf?: {
      longTasks: unknown[];
      events: unknown[];
      firstInputs: unknown[];
      lcp: unknown[];
      cls: number;
    } }).__browserPerf;
    if (!perf) return;
    perf.longTasks.length = 0;
    perf.events.length = 0;
    perf.firstInputs.length = 0;
    perf.lcp.length = 0;
    perf.cls = 0;
  });
};

const appPerf = async (page: Page): Promise<PerfSnapshot> =>
  page.evaluate(() => (window as unknown as { app: { perf: { snapshot(): PerfSnapshot } } }).app.perf.snapshot());

const resetAppPerf = async (page: Page) =>
  page.evaluate(() => (window as unknown as { app: { perf: { reset(): void } } }).app.perf.reset());

const domMetrics = async (page: Page) => page.evaluate(() => {
  const app = (window as unknown as { app: { graphs: { current: { nodes(): unknown[]; edges(): unknown[] } } } }).app;
  const stage = document.querySelector('[data-place="stage"]');
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return {
    nodes: app.graphs.current.nodes().length,
    edges: app.graphs.current.edges().length,
    renderedNodes: stage?.querySelectorAll('.node[data-item-kind="node"]').length ?? 0,
    renderedEdges: stage?.querySelectorAll('[data-item-kind="edge"]').length ?? 0,
    heapUsed: memory?.usedJSHeapSize,
    heapTotal: memory?.totalJSHeapSize,
  };
});

const measureStep = async (page: Page, name: string, fn: () => Promise<void>): Promise<StepResult> => {
  await resetAppPerf(page);
  const start = await page.evaluate(() => performance.now());
  await fn();
  await settle(page, 3);
  const end = await page.evaluate(() => performance.now());
  return { name, wallMs: end - start, dom: await domMetrics(page), core: await appPerf(page) };
};

const seedGraph = async (page: Page, nodes: number, edges: number) => {
  await page.evaluate(({ nodes, edges }) => {
    const cols = Math.ceil(Math.sqrt(nodes));
    const snapshot = {
      nodes: Array.from({ length: nodes }, (_, i) => ({
        id: `e${i + 1}`,
        Label: { text: `n${i}` },
        Position: { x: (i % cols) * 220, y: Math.floor(i / cols) * 120 },
        Size: { w: 150, h: 64 },
      })),
      edges: Array.from({ length: edges }, (_, i) => {
        const from = (i % nodes) + 1;
        let to = ((i * 7 + 1) % nodes) + 1;
        if (to === from) to = (to % nodes) + 1;
        return { id: `r${i + 1}`, From: `e${from}`, To: `e${to}` };
      }),
    };
    (window as unknown as { app: { bus: { emit(name: string, data: unknown): void } } }).app.bus.emit('graph.import.snapshot', snapshot);
  }, { nodes, edges });
  await page.waitForFunction(({ nodes, edges }) => {
    const app = (window as unknown as { app?: { graphs: { current: { nodes(): unknown[]; edges(): unknown[] } } } }).app;
    return !!app && app.graphs.current.nodes().length === nodes && app.graphs.current.edges().length === edges;
  }, { nodes, edges }, { timeout: 30_000 });
};

const massAdd = async (page: Page, count: number) => {
  await page.evaluate(async ({ count, chunk }) => {
    const app = (window as unknown as {
      app: {
        graphs: { current: { nodes(): { id: string; Position?: { x: number; y: number } }[] } };
        bus: { emit(name: string, data: unknown): void };
      };
    }).app;
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const base = app.graphs.current.nodes().length;
    const cols = Math.ceil(Math.sqrt(base + count));
    for (let i = 0; i < count; i++) {
      app.bus.emit('graph.node.create', {
        Label: { text: `add${i}` },
        Position: { x: ((base + i) % cols) * 220, y: Math.floor((base + i) / cols) * 120 },
        keepFocus: true,
      });
      if ((i + 1) % chunk === 0) await nextFrame();
    }
  }, { count, chunk: MASS_CHUNK });
};

const chooseForMassEdit = async (page: Page, count: number) => {
  await page.evaluate(({ count }) => {
    const app = (window as unknown as {
      app: {
        graphs: { current: { nodes(): { id: string }[] } };
        selection: { choose(refs: { kind: 'node'; id: string }[]): void };
      };
    }).app;
    app.selection.choose(app.graphs.current.nodes().slice(0, count).map(node => ({ kind: 'node', id: node.id })));
  }, { count });
  await settle(page, 2);
};

const resetCameraToOrigin = async (page: Page) => {
  await page.evaluate(() => {
    const app = (window as unknown as {
      app: {
        contexts: { view: { set(next: { x: number; y: number; scale: number }): unknown; get(): unknown } };
        bus: { emit(name: string, data: unknown): void };
      };
    }).app;
    app.contexts.view.set({ x: 0, y: 0, scale: 1 });
    app.bus.emit('view.changed', app.contexts.view.get());
    app.bus.emit('render.stage.draw', { full: true, refs: [] });
  });
  await settle(page, 3);
};

const metricsFromCdp = async (client: CDPSession): Promise<MetricMap> => {
  const { metrics } = await client.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
};

const diffMetrics = (before: MetricMap, after: MetricMap): MetricMap => {
  const out: MetricMap = {};
  for (const [name, value] of Object.entries(after)) out[name] = value - (before[name] ?? 0);
  return out;
};

const startTrace = async (client: CDPSession) => {
  await client.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    categories: [
      'devtools.timeline',
      'blink.user_timing',
      'loading',
      'disabled-by-default-devtools.timeline',
    ].join(','),
  });
};

const stopTrace = async (client: CDPSession): Promise<{ traceEvents: TraceEvent[] }> => {
  const done = new Promise<{ stream?: string }>(resolve => client.on('Tracing.tracingComplete', resolve));
  await client.send('Tracing.end');
  const { stream } = await done;
  if (!stream) return { traceEvents: [] };
  let json = '';
  for (;;) {
    const chunk = await client.send('IO.read', { handle: stream });
    json += chunk.data ?? '';
    if (chunk.eof) break;
  }
  await client.send('IO.close', { handle: stream });
  return JSON.parse(json) as { traceEvents: TraceEvent[] };
};

const summarizeTrace = (events: TraceEvent[]) => {
  const complete = events.filter(e => e.ph === 'X' && e.dur && e.dur > 0);
  const main = complete
    .filter(e => (e.cat ?? '').includes('devtools.timeline') || (e.cat ?? '').includes('blink.user_timing'))
    .map(e => ({ name: e.name ?? 'unknown', ms: (e.dur ?? 0) / 1000, ts: e.ts ?? 0 }))
    .sort((a, b) => b.ms - a.ms);
  const mainThread = main.filter(task => task.name !== 'RasterTask');
  const raster = main.filter(task => task.name === 'RasterTask');
  return {
    maxMainTaskMs: mainThread[0]?.ms ?? 0,
    maxRasterTaskMs: raster[0]?.ms ?? 0,
    top: main.slice(0, 20),
  };
};

const topTimings = (step: StepResult) =>
  step.core.timings.slice(0, 8).map(row => `\`${row.label}\` ${ms(row.totalMs)}ms/${row.calls}c max ${ms(row.maxMs)}ms`).join('<br>');

const metricRows = (metrics: MetricMap) =>
  Object.entries(metrics)
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 0.0001)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

const renderReport = (data: {
  steps: StepResult[];
  cdpDelta: MetricMap;
  trace: ReturnType<typeof summarizeTrace>;
  browser: { longTasks: { duration?: number; name?: string }[]; events: BrowserEventRow[]; firstInputs: unknown[]; lcp: { startTime?: number; renderTime?: number; loadTime?: number }[]; cls: number };
  failures: string[];
}) => {
  const interactionEvents = data.browser.events.filter(e => (e.interactionId ?? 0) > 0);
  const inp = Math.max(0, ...(interactionEvents.length ? interactionEvents : data.browser.events).map(e => e.duration ?? 0));
  const inputDelay = Math.max(0, ...data.browser.events.map(e => e.inputDelay ?? 0));
  const interactionInputDelay = Math.max(0, ...interactionEvents.map(e => e.inputDelay ?? 0));
  const longTask = Math.max(0, ...data.browser.longTasks.map(e => e.duration ?? 0));
  const topEvents = [...data.browser.events]
    .sort((a, b) => (b.inputDelay ?? 0) - (a.inputDelay ?? 0) || (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, 12);
  const topInteractions = [...interactionEvents]
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0) || (b.inputDelay ?? 0) - (a.inputDelay ?? 0))
    .slice(0, 12);
  return `# Browser performance results

Generated by \`npm run perf:browser\`.

Graph: ${NODE_COUNT.toLocaleString()} nodes / ${EDGE_COUNT.toLocaleString()} edges. Mass ops: ${MASS_COUNT.toLocaleString()} items. Title edit: ${TITLE_EDIT ? 'on' : 'off'}.

## Gates

Metric | Target | Actual | Status
---|---:|---:|---
INP proxy (max interaction EventTiming duration) | ${TARGET_INP_MS} ms | ${ms(inp)} ms | ${inp <= TARGET_INP_MS ? 'PASS' : 'WARN'}
Input delay max (all EventTiming entries) | ${TARGET_INPUT_DELAY_MS} ms | ${ms(inputDelay)} ms | ${inputDelay <= TARGET_INPUT_DELAY_MS ? 'PASS' : 'FAIL'}
Input delay max (interactions) | ${TARGET_INPUT_DELAY_MS} ms | ${ms(interactionInputDelay)} ms | ${interactionInputDelay <= TARGET_INPUT_DELAY_MS ? 'PASS' : 'FAIL'}
MCP (max CDP main-thread task) | ${TARGET_MCP_MS} ms | ${ms(data.trace.maxMainTaskMs)} ms | ${data.trace.maxMainTaskMs <= TARGET_MCP_MS ? 'PASS' : 'FAIL'}
Raster task max | - | ${ms(data.trace.maxRasterTaskMs)} ms | INFO
Long task max | 50 ms | ${ms(longTask)} ms | ${longTask <= 50 ? 'PASS' : 'WARN'}
Interactive workflow wall max | ${TARGET_STEP_MS} ms | ${ms(Math.max(...data.steps.filter(s => !s.name.startsWith('seed')).map(s => s.wallMs)))} ms | INFO

${data.failures.length ? `## Failures\n\n${data.failures.map(f => `- ${f}`).join('\n')}\n` : '## Failures\n\nNone.\n'}
## Steps

Step | Wall ms | Model | Rendered | Heap | Top core timings
---|---:|---:|---:|---:|---
${data.steps.map(step => `${step.name} | ${ms(step.wallMs)} | ${step.dom.nodes.toLocaleString()}n/${step.dom.edges.toLocaleString()}e | ${step.dom.renderedNodes}n/${step.dom.renderedEdges}e | ${step.dom.heapUsed ? `${(step.dom.heapUsed / 1024 / 1024).toFixed(1)} MB` : '-'} | ${topTimings(step)}`).join('\n')}

## CDP Performance.getMetrics delta

Metric | Delta
---|---:
${metricRows(data.cdpDelta).map(([name, value]) => `${name} | ${Math.abs(value) > 10 ? value.toFixed(0) : value.toFixed(3)}`).join('\n')}

## CDP Trace top tasks

Task | ms
---|---:
${data.trace.top.map(task => `${task.name} | ${ms(task.ms)}`).join('\n')}

## Browser observers

- EventTiming entries: ${data.browser.events.length}; max duration ${ms(inp)} ms; max input delay ${ms(inputDelay)} ms.
- LongTask entries: ${data.browser.longTasks.length}; max duration ${ms(longTask)} ms.
- FirstInput entries: ${data.browser.firstInputs.length}.
- LCP entries: ${data.browser.lcp.length}; latest ${ms(data.browser.lcp.at(-1)?.renderTime ?? data.browser.lcp.at(-1)?.loadTime ?? data.browser.lcp.at(-1)?.startTime)} ms.
- CLS: ${data.browser.cls.toFixed(4)}.

### Top EventTiming entries

Event | Target | Duration | Input delay | Processing | Presentation | Interaction
---|---|---:|---:|---:|---:|---:
${topEvents.map(e => `${e.name ?? '-'} | ${e.target || '-'} | ${ms(e.duration)} | ${ms(e.inputDelay)} | ${ms(e.processingDuration)} | ${ms(e.presentationDelay)} | ${e.interactionId || '-'}`).join('\n')}

### Top Interaction Entries

Event | Target | Duration | Input delay | Processing | Presentation | Interaction
---|---|---:|---:|---:|---:|---:
${topInteractions.length ? topInteractions.map(e => `${e.name ?? '-'} | ${e.target || '-'} | ${ms(e.duration)} | ${ms(e.inputDelay)} | ${ms(e.processingDuration)} | ${ms(e.presentationDelay)} | ${e.interactionId || '-'}`).join('\n') : 'none | - | - | - | - | - | -'}

_Updated: ${new Date().toISOString()}_
`;
};

test('10k real browser/CDP performance scenario', async ({ page, context }) => {
  await installBrowserObservers(page);
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');

  await page.goto('/?io=memory&perf=1');
  await page.waitForFunction(() => !!(window as unknown as { app?: unknown }).app, undefined, { timeout: 8000 });
  await page.evaluate(() => (window as unknown as { app: { perf: { setEnabled(on: boolean): void } } }).app.perf.setEnabled(true));
  await settle(page, 3);

  const before = await metricsFromCdp(client);
  await startTrace(client);

  const steps: StepResult[] = [];
  steps.push(await measureStep(page, `seed-${NODE_COUNT}`, () => seedGraph(page, NODE_COUNT, EDGE_COUNT)));
  await resetBrowserObservers(page);
  steps.push(await measureStep(page, 'zoom-wheel', async () => {
    await page.mouse.move(420, 320);
    await page.mouse.wheel(0, -500);
  }));
  steps.push(await measureStep(page, 'pan-drag', async () => {
    await page.mouse.move(620, 360);
    await page.mouse.down();
    await settle(page, 1);
    await page.mouse.move(420, 240, { steps: 10 });
    await page.mouse.up();
  }));
  steps.push(await measureStep(page, `mass-add-${MASS_COUNT}`, () => massAdd(page, MASS_COUNT)));
  await chooseForMassEdit(page, Math.min(MASS_COUNT, NODE_COUNT));
  steps.push(await measureStep(page, `mass-edit-${Math.min(MASS_COUNT, NODE_COUNT)}`, async () => {
    await page.keyboard.press('ArrowRight');
  }));
  if (TITLE_EDIT) {
    await resetCameraToOrigin(page);
    steps.push(await measureStep(page, 'title-edit', async () => {
      await page.waitForSelector('.node [data-editable-title]', { timeout: 10_000 });
      const index = await page.locator('.node [data-editable-title]').evaluateAll(els =>
        els.findIndex(el => {
          const rect = el.getBoundingClientRect();
          return rect.left > 220 && rect.top > 90 && rect.right < innerWidth - 20 && rect.bottom < innerHeight - 20;
        }),
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const title = page.locator('.node [data-editable-title]').nth(index);
      await title.click();
      await page.keyboard.press('Enter');
      await expect(title).toHaveClass(/editing/);
      await page.keyboard.type(' perf');
      await page.keyboard.press('Enter');
    }));
  }

  const traceJson = await stopTrace(client);
  const after = await metricsFromCdp(client);
  const cdpDelta = diffMetrics(before, after);
  const trace = summarizeTrace(traceJson.traceEvents);
  const browser = await page.evaluate(() => (window as unknown as { __browserPerf: {
    longTasks: { duration?: number; name?: string }[];
    events: BrowserEventRow[];
    firstInputs: unknown[];
    lcp: { startTime?: number; renderTime?: number; loadTime?: number }[];
    cls: number;
  } }).__browserPerf);

  const interactionEvents = browser.events.filter(e => (e.interactionId ?? 0) > 0);
  const inp = Math.max(0, ...(interactionEvents.length ? interactionEvents : browser.events).map(e => e.duration ?? 0));
  const inputDelay = Math.max(0, ...browser.events.map(e => e.inputDelay ?? 0));
  const interactionInputDelay = Math.max(0, ...interactionEvents.map(e => e.inputDelay ?? 0));
  const failures = [
    inputDelay > TARGET_INPUT_DELAY_MS ? `Input delay ${ms(inputDelay)}ms > ${TARGET_INPUT_DELAY_MS}ms` : '',
    interactionInputDelay > TARGET_INPUT_DELAY_MS ? `Interaction input delay ${ms(interactionInputDelay)}ms > ${TARGET_INPUT_DELAY_MS}ms` : '',
    trace.maxMainTaskMs > TARGET_MCP_MS ? `MCP ${ms(trace.maxMainTaskMs)}ms > ${TARGET_MCP_MS}ms` : '',
  ].filter(Boolean);

  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, renderReport({ steps, cdpDelta, trace, browser, failures }));

  if (ENFORCE) expect(failures).toEqual([]);
});
