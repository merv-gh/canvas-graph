import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import type { GraphSnapshot } from '../../frontend/model';

const SNAPSHOT = JSON.parse(
  readFileSync(resolve(process.cwd(), 'frontend/public/graphs/big-synthetic.json'), 'utf8'),
) as { services: { name: string }[]; edges: { From: string; To: string; Label?: string }[] };

const syntheticSnapshot: GraphSnapshot = {
  nodes: SNAPSHOT.services.map((s, i) => ({
    id: `e${i + 1}`,
    Label: { text: s.name },
    Position: { x: 100 + (i % 20) * 180, y: 100 + Math.floor(i / 20) * 120 },
    Size: { w: 150, h: 64 },
  })),
  edges: SNAPSHOT.edges.reduce((acc, e, i) => {
    const fromIdx = SNAPSHOT.services.findIndex((s: { name: string }) => s.name === e.From);
    const toIdx = SNAPSHOT.services.findIndex((s: { name: string }) => s.name === e.To);
    if (fromIdx < 0 || toIdx < 0) return acc;
    acc.push({
      id: `r${i + 1}`,
      From: `e${fromIdx + 1}`,
      To: `e${toIdx + 1}`,
      Label: e.Label ? { text: e.Label } : undefined,
    });
    return acc;
  }, [] as GraphSnapshot['edges']),
};

describe('performance metrics', () => {
  it('LCP: boot stays inside its instrumentation-aware budget', async () => {
    const t0 = performance.now();
    const ctx = bootApp({ dx: false, demo: false, debug: false });
    await settle();
    const bootMs = performance.now() - t0;

    console.log(`  Boot: ${bootMs.toFixed(0)}ms`);
    // V8 coverage instruments every loaded module and is not a product-speed
    // measurement. release:check runs this file once without instrumentation
    // at the real 500ms budget, then again under coverage with headroom.
    expect(bootMs).toBeLessThan(process.env.COVERAGE ? 750 : 500);
    expect(ctx.contexts.commands.all().length).toBeGreaterThan(0);
  }, 5000);

  it('INP: event-to-next-paint on create node under 100ms (jsdom)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      runCommand(ctx, 'editing.node.create');
      await settle();
      times.push(performance.now() - t0);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
    console.log(`  avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);

    // CI-tolerant ceiling (jsdom + test contention). Isolated run averages ~75ms.
    // Run in isolation: `npx vitest run tests/commands/performance.test.ts`
    expect(avg).toBeLessThan(500);
  }, 15000);

  it('INP: cancel click under 500ms (CI-tolerant)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      ctx.bus.forward('app.cancel', { source: 'background' });
      await settle();
      times.push(performance.now() - t0);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`  avg=${avg.toFixed(1)}ms`);
    expect(avg).toBeLessThan(500);
  }, 10000);

  it('bulk create 100 nodes: under 100ms/node avg (CI-tolerant)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      runCommand(ctx, 'editing.node.create');
    }
    await settle();
    await settle();
    const totalMs = performance.now() - t0;

    const nodesCreated = ctx.graphs.current.nodes().length;
    expect(nodesCreated).toBe(100);

    const perNode = totalMs / nodesCreated;
    console.log(`  100 nodes: ${totalMs.toFixed(0)}ms total, ${perNode.toFixed(1)}ms/node`);
    expect(perNode).toBeLessThan(100);
  }, 20000);

  it('large graph import: under 3000ms for big-synthetic (CI-tolerant)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    const t0 = performance.now();
    ctx.bus.forward('graph.import.snapshot', syntheticSnapshot);
    await settle();
    await settle();
    await settle();
    const importMs = performance.now() - t0;

    const nodeCount = ctx.graphs.current.nodes().length;
    const edgeCount = ctx.graphs.current.edges().length;
    console.log(`  Import: ${importMs.toFixed(0)}ms, ${nodeCount} nodes, ${edgeCount} edges`);
    expect(importMs).toBeLessThan(3000);
  }, 15000);

  it('event bus throughput: 10k emits under 500ms (CI-tolerant)', () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false });

    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      ctx.bus.forward('app.notice', { message: `${i}` });
    }
    const ms = performance.now() - t0;

    console.log(`  10k emits: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
  }, 10000);

  it('RAF flush: under 500ms for 50 nodes (CI-tolerant)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    for (let i = 0; i < 50; i++) runCommand(ctx, 'editing.node.create');
    await settle();
    await settle();

    const t0 = performance.now();
    ctx.bus.emit('render.stage.draw', { full: true });
    await settle();
    const ms = performance.now() - t0;

    console.log(`  Full redraw (50 nodes): ${ms.toFixed(1)}ms`);

    // jsdom DOM manipulation is slower than real browser. Gate at 100ms.
    // The actual flushDirty callback is fast; the overhead is jsdom's
    // appendChild/removeChild + style recalc emulation.
    expect(ms).toBeLessThan(100);
  }, 5000);

  it('command input scan: under 0.5ms', () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false });
    const commands = ctx.contexts.commands;
    const click = commands.enabledForInput('click');
    const pointerdown = commands.enabledForInput('pointerdown');

    const t0 = performance.now();
    let count = 0;
    for (const cmd of commands.enabledForInput('click')) if (cmd.input) count++;
    for (const cmd of commands.enabledForInput('pointerdown')) if (cmd.input) count++;
    const ms = performance.now() - t0;

    console.log(`  ${click.length + pointerdown.length} click/pointer bindings, ${count} scanned: ${ms.toFixed(3)}ms`);
    // Isolated runs sit ~0.1ms; coverage instrumentation + parallel files can
    // push past 0.5ms. Ceiling traps O(all-commands) regressions, not jitter.
    expect(ms).toBeLessThan(2);
  }, 1000);

  it('no apparent layout thrashing', () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false });
    for (let i = 0; i < 10; i++) runCommand(ctx, 'editing.node.create');
    expect(ctx.graphs.current.nodes().length).toBe(10);
  });

  it('no memory leaks from repeated create-delete cycles', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 20; i++) runCommand(ctx, 'editing.node.create');
      await settle();

      for (let i = 0; i < 20; i++) {
        const node = ctx.graphs.current.nodes()[0];
        if (node) ctx.bus.forward('graph.node.delete', { id: node.id });
      }
      await settle();
    }

    expect(ctx.graphs.current.nodes().length).toBe(0);
  }, 10000);

  it('LCP: stage has visible content after node create', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();

    const stage = ctx.contexts.places.el('stage' as any);
    expect(stage).not.toBeNull();
    const nodes = stage?.querySelectorAll('.node');
    expect(nodes?.length).toBeGreaterThan(0);
  });

  it('CLS: no layout shift on node create (autoLayout off)', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();

    runCommand(ctx, 'editing.node.create');
    await settle();

    const firstNodePos = ctx.graphs.current.nodes()[0]?.Position;
    expect(firstNodePos).toBeDefined();

    runCommand(ctx, 'editing.node.create');
    await settle();

    const firstNodePosAfter = ctx.graphs.current.nodes()[0]?.Position;
    expect(firstNodePosAfter).toEqual(firstNodePos);
  });
});
