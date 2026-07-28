import { describe, expect, it, vi } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import { memoryIo, STORAGE_KEYS } from '../../frontend/core';
import type { TelemetrySpan } from '../../frontend/systems/telemetry';

/** Telemetry is observability for the bus itself: spans, causality, an
 *  offline-first local ring, and an OTLP exporter that must stay off until a
 *  human asks for it (the deployed build is a static frontend). */

const spanNames = (spans: TelemetrySpan[]) => spans.map(span => span.name);
const bootTelemetry = (
  flags: Parameters<typeof bootApp>[0] = {},
  io?: Parameters<typeof bootApp>[1],
) => bootApp({ telemetry: true, 'telemetry.portal': true, ...flags }, io);

describe('telemetry', () => {
  it('records a span per bus event with parent/child from dispatch depth', async () => {
    const ctx = bootTelemetry();
    await settle();
    ctx.telemetry!.clear();

    runCommand(ctx, 'editing.node.create');
    await settle();

    const spans = ctx.telemetry!.spans();
    expect(spanNames(spans)).toContain('graph.node.created');
    const created = spans.find(span => span.name === 'graph.node.created')!;
    // `graph.node.created` is emitted by a handler of `graph.node.create` —
    // that nesting is the whole point of reading depth off the bus.
    expect(created.parentSpanId).toBeTruthy();
    const parent = spans.find(span => span.spanId === created.parentSpanId)!;
    expect(parent.traceId).toBe(created.traceId);
    expect(created.attributes['app.event.kind']).toBe('fact');
    expect(parent.attributes['app.event.kind']).toBe('request');
  });

  it('never records its own events', async () => {
    const ctx = bootTelemetry();
    await settle();
    runCommand(ctx, 'telemetry.clear');
    runCommand(ctx, 'telemetry.copy');
    await settle();
    expect(spanNames(ctx.telemetry!.spans()).filter(name => name.startsWith('telemetry.'))).toHaveLength(0);
  });

  it('keeps the newest 100 spans in io across a reload', async () => {
    const io = memoryIo();
    const first = bootTelemetry({}, io);
    await settle();
    for (let i = 0; i < 250; i++) first.bus.forward('app.notice', { message: `${i}` });
    await settle();
    // Stopping the system flushes the ring — the same disposer a page unload
    // runs, so this is the durability path, not a test-only shortcut.
    first.bus.emit('flag.toggle', { name: 'telemetry', on: false });
    await settle();

    const stored = io.get<string>(STORAGE_KEYS.telemetry, '');
    const payload = JSON.parse(stored) as { v: number; n: string[]; s: unknown[][] };
    expect(payload.v).toBe(1);
    expect(payload.s).toHaveLength(100);
    // Columns, not span objects: names are interned once and each span is a
    // number tuple. That is what keeps 100 spans small enough to write often.
    expect(payload.n).toContain('app.notice');
    const subjects = payload.s.map(row => row[7]);
    expect(subjects).toContain('249');
    expect(subjects).not.toContain('0');

    // Reload: a fresh browser with only what was on disk.
    const reloaded = memoryIo();
    reloaded.set(STORAGE_KEYS.telemetry, stored);
    const second = bootTelemetry({}, reloaded);
    await settle();
    expect(second.telemetry!.spans().map(span => span.attributes['app.subject'])).toContain('249');
  });

  it('exports nothing until a human turns OTLP on', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const ctx = bootTelemetry();
      await settle();
      expect(ctx.telemetry!.config().export).toBe(false);
      for (let i = 0; i < 100; i++) ctx.bus.forward('app.notice', { message: `${i}` });
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();

      runCommand(ctx, 'telemetry.export.toggle');
      for (let i = 0; i < 100; i++) ctx.bus.forward('app.notice', { message: `on-${i}` });
      await settle();
      expect(fetchMock).toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('http://localhost:4318/v1/traces');
      const body = JSON.parse(String(init.body));
      expect(body.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({ kind: 1 });
      expect(body.resourceSpans[0].resource.attributes[0]).toEqual({ key: 'service.name', value: { stringValue: 'ecs-canvas-graph' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('emits ids in OTLP hex widths', async () => {
    const ctx = bootTelemetry();
    await settle();
    const span = ctx.telemetry!.spans()[0];
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not build spans on the interaction path', async () => {
    const ctx = bootTelemetry();
    await settle();
    const before = ctx.telemetry!.spans().length;
    // Capture is columns-only; nothing is aggregated until the batch lands.
    for (let i = 0; i < 50; i++) ctx.bus.forward('app.notice', { message: `${i}` });
    expect(ctx.telemetry!.spans().length).toBe(before);
    await settle();
    expect(ctx.telemetry!.spans().length).toBeGreaterThan(before);
  });
});

describe('telemetry portal', () => {
  it('stays unmounted until toggled, then draws a node per event name', async () => {
    const ctx = bootTelemetry();
    await settle();
    expect(document.querySelector('.telemetry-portal')).toBeNull();

    expect(runCommand(ctx, 'telemetry.portal.toggle')).toBe(true);
    await settle();

    const portal = document.querySelector('.telemetry-portal');
    expect(portal).not.toBeNull();
    const nodes = portal!.querySelectorAll('.telemetry-node');
    expect(nodes.length).toBeGreaterThan(0);
    expect(portal!.querySelector('.telemetry-portal-resize')).not.toBeNull();
    // OTLP state is on the face of the panel, not buried in a menu.
    expect(portal!.querySelector('.telemetry-portal-export')!.textContent).toBe('OTLP off');
  });

  it('filters to one channel and back', async () => {
    const ctx = bootTelemetry();
    await settle();
    runCommand(ctx, 'telemetry.portal.toggle');
    await settle();
    const all = document.querySelectorAll('.telemetry-node').length;

    ctx.bus.emit('telemetry.portal.filter', { channel: 'render' });
    await settle();
    const names = [...document.querySelectorAll('.telemetry-node title')].map(el => el.textContent ?? '');
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(name => name.startsWith('render.'))).toBe(true);
    expect(names.length).toBeLessThanOrEqual(all);

    ctx.bus.emit('telemetry.portal.filter', { channel: 'all' });
    await settle();
    expect(document.querySelectorAll('.telemetry-node').length).toBe(all);
  });

  it('resizes from the grip and remembers the size', async () => {
    const io = memoryIo();
    const ctx = bootTelemetry({}, io);
    await settle();
    runCommand(ctx, 'telemetry.portal.toggle');
    await settle();
    const width = () => Number((document.querySelector('.telemetry-portal') as HTMLElement).style.width.replace('px', ''));
    const before = width();

    ctx.bus.emit('telemetry.portal.resize.start', { x: 0, y: 0 });
    ctx.bus.emit('telemetry.portal.resize.move', { x: 120, y: 90 });
    ctx.bus.emit('telemetry.portal.resize.end');
    await settle();

    expect(width()).toBe(before + 120);
    expect(io.get(`${STORAGE_KEYS.telemetryConfig}.portal`, null)).toMatchObject({ w: before + 120 });
  });

  it('goes away with its flag, and telemetry keeps recording without it', async () => {
    const ctx = bootTelemetry({ 'telemetry.portal': false });
    await settle();
    expect(document.querySelector('.telemetry-portal')).toBeNull();
    expect(ctx.contexts.commands.get('telemetry.portal.toggle')).toBeUndefined();
    expect(ctx.telemetry!.spans().length).toBeGreaterThan(0);
  });
});
