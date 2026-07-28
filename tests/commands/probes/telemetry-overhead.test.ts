import { describe, expect, it } from 'vitest';
import { bootApp, perfTrace, runCommand, settle, syntheticSnapshot } from '../testkit';
import type { AppCtx } from '../../../frontend/core';

/** Telemetry has to be cheap enough to leave on.
 *
 *  Capture is columns-only — a Map lookup and seven typed-array stores, no
 *  allocation and no string formatting — and aggregation happens past a batch
 *  boundary (a worker in the browser, a deferred macrotask here). These probes
 *  hold that line: recording must not move bus throughput or the render budget
 *  out of noise, even at 10k nodes with the event-flow panel open.
 *
 *  Ratios are generous because jsdom timing under a loaded box is noisy; they
 *  trap a regression back to per-event object building (which measured ~1.7×
 *  before the columnar rewrite), not micro-drift. */

const SNAP_10K = syntheticSnapshot(10_000, 1.5);
const OFF = { telemetry: false, 'telemetry.portal': false } as const;
const BASE = {
  dx: false,
  demo: false,
  debug: false,
  autoLayout: false,
  telemetry: true,
  'telemetry.portal': true,
} as const;

const burst = (ctx: AppCtx, n: number) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) ctx.bus.forward('app.notice', { message: `${i}` });
  return performance.now() - t0;
};

const importBig = async (flags: Record<string, boolean> = {}) => {
  const ctx = bootApp({ ...BASE, ...flags });
  await settle();
  ctx.bus.forward('graph.import.snapshot', SNAP_10K);
  await settle();
  await settle();
  return ctx;
};

/** Pan the camera and move a node — the two interactions that redraw most. */
const interact = async (ctx: AppCtx) => {
  const node = ctx.graphs.current.nodes()[0];
  for (let i = 1; i <= 12; i++) {
    ctx.contexts.view.set({ x: i * 140, y: 0, scale: 1 });
    ctx.bus.emit('view.changed');
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: node.id }, patch: { Position: { x: i * 8, y: i * 4 } } });
    await settle();
  }
};

describe('telemetry overhead', () => {
  it('bus throughput with recording on stays inside noise', () => {
    const off = bootApp({ ...BASE, ...OFF });
    const on = bootApp(BASE);
    burst(off, 2_000);
    burst(on, 2_000); // warm both JITs before measuring
    const msOff = burst(off, 20_000);
    const msOn = burst(on, 20_000);
    expect(on.telemetry).toBeDefined();
    expect(off.telemetry).toBeUndefined();
    expect(msOn).toBeLessThan(msOff * 1.35 + 15);
  }, 60_000);

  it('capture materialises no spans inline — the batch does that later', () => {
    const ctx = bootApp(BASE);
    const before = ctx.telemetry!.spans().length;
    burst(ctx, 5_000);
    // Still nothing built: the interaction path only wrote columns.
    expect(ctx.telemetry!.spans().length).toBe(before);
  });

  it('10k-node interaction keeps its render budget with telemetry + portal on', async () => {
    const off = await importBig(OFF);
    await interact(off);
    const offTrace = perfTrace(off);
    await interact(off);
    const offReport = offTrace.stop();

    const on = await importBig();
    runCommand(on, 'telemetry.portal.toggle');
    await settle();
    expect(document.querySelector('.telemetry-portal')).not.toBeNull();
    await interact(on);
    const onTrace = perfTrace(on);
    await interact(on);
    const onReport = onTrace.stop();

    // The panel is open and repainting, and the frame budget is unchanged.
    expect(onReport.flush.count).toBeGreaterThan(0);
    expect(onReport.flush.avgMs).toBeLessThan(offReport.flush.avgMs * 1.6 + 8);
    expect(onReport.flush.maxMs).toBeLessThan(500);
  }, 120_000);

  it('the open portal does not repaint itself into a loop', async () => {
    const ctx = bootApp(BASE);
    await settle();
    runCommand(ctx, 'telemetry.portal.toggle');
    await settle();
    await settle();
    const before = ctx.render!.flushes();
    // Idle: the heat pass mutates attributes in place and emits nothing, so the
    // render scheduler must stay asleep.
    await settle();
    await settle();
    await settle();
    expect(ctx.render!.flushes() - before).toBeLessThanOrEqual(1);
  }, 30_000);
});
