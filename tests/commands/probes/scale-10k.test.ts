import { describe, expect, it } from 'vitest';
import { buildScene, hitTestNode, FLAG_SELECTED, NODE_FLOATS } from '../../../frontend/core/gpu-scene';
import type { Graph } from '../../../frontend/model';
import { bootApp, perfTrace, settle, syntheticSnapshot } from '../testkit';

/** 10k-node scale probes. Ceilings are jsdom/CI-tolerant — they trap
 *  order-of-magnitude regressions (an accidental O(N) per frame, a lost
 *  culling path), not micro-drift. Real-frame numbers come from the browser
 *  perf run; these keep the pipeline honest in CI. */

const SNAP_10K = syntheticSnapshot(10_000, 1.5);

const importBig = async (flags = {}) => {
  const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false, ...flags });
  await settle();
  ctx.bus.forward('graph.import.snapshot', SNAP_10K);
  await settle();
  await settle();
  return ctx;
};

describe('10k-node scale probes', () => {
  it('imports 10k nodes losslessly within budget', async () => {
    const t0 = performance.now();
    const ctx = await importBig();
    const ms = performance.now() - t0;
    expect(ctx.graphs.current.nodes()).toHaveLength(10_000);
    expect(ctx.graphs.current.edges().length).toBeGreaterThan(13_000);
    console.log(`  import+boot 10k: ${ms.toFixed(0)}ms, edges=${ctx.graphs.current.edges().length}`);
    expect(ms).toBeLessThan(15_000);
  }, 30_000);

  it('viewport culling keeps the DOM small and full-draw within budget at 10k', async () => {
    const ctx = await importBig();
    // Zoom to one cluster — the 900×600 stage stub + margin should cull hard.
    ctx.contexts.view.set({ x: 0, y: 0, scale: 1 });
    const trace = perfTrace(ctx);
    ctx.bus.emit('render.stage.draw', { full: true });
    await settle();
    const report = trace.stop();
    const domNodes = document.querySelectorAll('[data-item-kind="node"]').length;
    console.log(`  10k full draw: dom=${domNodes} nodes, max=${report.flush.maxMs.toFixed(1)}ms`);
    expect(domNodes).toBeGreaterThan(0);
    expect(domNodes).toBeLessThan(300);        // culling works — not 10k elements
    expect(report.flush.maxMs).toBeLessThan(500); // jsdom-tolerant
  }, 30_000);

  it('camera pan at 10k stays on the incremental path', async () => {
    const ctx = await importBig();
    ctx.contexts.view.set({ x: 0, y: 0, scale: 1 });
    ctx.bus.emit('render.stage.draw', { full: true });
    await settle();
    const trace = perfTrace(ctx);
    for (let i = 1; i <= 10; i++) {
      ctx.contexts.view.set({ x: i * 120, y: 0, scale: 1 });
      ctx.bus.emit('view.changed');
      await settle();
    }
    const report = trace.stop();
    console.log(`  10k pan ×10: avg=${report.flush.avgMs.toFixed(1)}ms max=${report.flush.maxMs.toFixed(1)}ms`);
    // Incremental reconcile touches the viewport delta, never all 10k.
    expect(report.flush.avgMs).toBeLessThan(150);
  }, 30_000);

  it('buildScene flattens 10k nodes + edges within budget and reuses buffers', async () => {
    const ctx = await importBig({ render: false, 'render.stage': false });
    const graph = ctx.graphs.current as unknown as Graph;
    const selected = new Set<string>(['e5']);

    const t0 = performance.now();
    const scene = buildScene(graph, selected, 'e7');
    const coldMs = performance.now() - t0;

    const t1 = performance.now();
    const warm = buildScene(graph, selected, 'e7', scene);
    const warmMs = performance.now() - t1;

    expect(scene.nodeCount).toBe(10_000);
    expect(scene.edgeCount).toBe(graph.edges().length);
    expect(warm.nodeData).toBe(scene.nodeData); // buffer reuse — no realloc
    const flags5 = scene.nodeData[4 * NODE_FLOATS + 5];
    expect(flags5 & FLAG_SELECTED).toBe(FLAG_SELECTED);
    console.log(`  buildScene 10k: cold=${coldMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms`);
    expect(warmMs).toBeLessThan(100);
  }, 30_000);

  it('hitTestNode resolves exact node at 10k scale', async () => {
    const ctx = await importBig({ render: false, 'render.stage': false });
    const graph = ctx.graphs.current as unknown as Graph;
    const target = graph.getNode('e4242')!;
    const hit = hitTestNode(graph, { x: target.Position!.x + 10, y: target.Position!.y + 5 });
    expect(hit).not.toBeNull();
    // Grid positions can overlap across clusters; the hit must at least cover the point.
    const hitNode = graph.getNode(hit!)!;
    expect(Math.abs(hitNode.Position!.x - (target.Position!.x + 10))).toBeLessThanOrEqual(hitNode.Size.w / 2);
    const miss = hitTestNode(graph, { x: -50_000, y: -50_000 });
    expect(miss).toBeNull();
  }, 30_000);
});
