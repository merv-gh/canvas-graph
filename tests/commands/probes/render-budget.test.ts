import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootApp, perfTrace, runCommand, settle } from '../testkit';
import type { GraphSnapshot } from '../../../frontend/model';

/** Render-budget + heap probes on top of the perfTrace harness. Ceilings are
 *  jsdom/CI-tolerant (like performance.test.ts) — the point is a *trend* trap:
 *  a regression that doubles flush cost or leaks per-cycle heap trips these
 *  long before a user feels it. The CS map doubles as the large-graph fixture,
 *  which also keeps the shipped demo file import-valid. */

const csMap = JSON.parse(
  readFileSync(resolve(process.cwd(), 'frontend/public/graphs/cs-map.json'), 'utf8'),
) as GraphSnapshot & { meta: unknown };

describe('render budget probes (perfTrace)', () => {
  it('traces flush cost, idle gaps, and over-budget count on node churn', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    const trace = perfTrace(ctx);
    for (let i = 0; i < 30; i++) {
      runCommand(ctx, 'editing.node.create');
      await settle();
    }
    const report = trace.stop();

    expect(report.flush.count).toBeGreaterThan(0);
    expect(report.flush.maxMs).toBeGreaterThan(0);
    // 30 sequential creates settle one flush each — idle gaps must be visible.
    expect(report.idle).not.toBeNull();
    expect(report.idle!.avgGapMs).toBeGreaterThan(0);
    console.log(`  flushes=${report.flush.count} avg=${report.flush.avgMs.toFixed(2)}ms max=${report.flush.maxMs.toFixed(2)}ms overBudget=${report.flush.overBudget} idleAvg=${report.idle!.avgGapMs.toFixed(1)}ms`);
    // jsdom-tolerant ceiling: patch flushes average well under a frame even here.
    expect(report.flush.avgMs).toBeLessThan(50);
  }, 20000);

  it('create/delete cycles do not accrue heap (loose ceiling, no forced GC)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    // Warm up allocators/caches before measuring, so steady-state is what's traced.
    for (let i = 0; i < 10; i++) runCommand(ctx, 'editing.node.create');
    await settle();
    for (const node of [...ctx.graphs.current.nodes()]) ctx.bus.forward('graph.node.delete', { id: node.id });
    await settle();

    const trace = perfTrace(ctx);
    for (let cycle = 0; cycle < 10; cycle++) {
      for (let i = 0; i < 20; i++) runCommand(ctx, 'editing.node.create');
      await settle();
      for (const node of [...ctx.graphs.current.nodes()]) ctx.bus.forward('graph.node.delete', { id: node.id });
      await settle();
    }
    const report = trace.stop();

    expect(ctx.graphs.current.nodes()).toHaveLength(0);
    expect(report.heapDeltaBytes).not.toBeNull();
    console.log(`  heapDelta=${((report.heapDeltaBytes ?? 0) / 1024 / 1024).toFixed(1)}MB over 10 cycles of 20 nodes`);
    // 200 create+delete round trips; without a leak the un-GC'd residue stays
    // far below this. A per-node retention of even ~250KB would trip it.
    expect(report.heapDeltaBytes!).toBeLessThan(50 * 1024 * 1024);
  }, 30000);

  it('cs-map.json imports whole and full-redraws within budget', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    ctx.bus.forward('graph.import.snapshot', { nodes: csMap.nodes, edges: csMap.edges });
    await settle();
    await settle();

    // Import must be lossless: every node lands, every edge finds endpoints.
    expect(ctx.graphs.current.nodes()).toHaveLength(csMap.nodes.length);
    expect(ctx.graphs.current.edges()).toHaveLength(csMap.edges.length);

    const trace = perfTrace(ctx);
    ctx.bus.emit('render.stage.draw', { full: true });
    await settle();
    const report = trace.stop();
    console.log(`  cs-map: ${csMap.nodes.length} nodes/${csMap.edges.length} edges, fullDraw max=${report.flush.maxMs.toFixed(1)}ms overBudget=${report.flush.overBudget}`);
    // Full rebuild of the culled viewport slice — jsdom-tolerant ceiling.
    expect(report.flush.maxMs).toBeLessThan(200);
  }, 20000);
});
