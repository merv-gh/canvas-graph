import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAbilitySystems } from '../../frontend/abilities';
import {
  createAppContext,
  memoryIo,
  registry,
  withKind,
  type AppCtx,
} from '../../frontend/core';
import { registerFeatures } from '../../frontend/features';
import { appModel, graphStore } from '../../frontend/model';
import { installRuntimeFeatureManager } from '../../frontend/runtime';
import { registerSystems } from '../../frontend/systems';
import { heapUsedBytes } from '../../frontend/core/perf';
import { Places, type CommandSource, type FeatureFlags } from '../../frontend/types';

const html = readFileSync(resolve(process.cwd(), 'frontend/index.html'), 'utf8')
  .replace(/<script\b[^>]*><\/script>/g, '');

/** Flag overrides only. Registry declares each system/ability/feature ON at boot,
 *  so an empty object boots everything. Pass `{ render: false }` to disable.
 *  Pass a shared `io` to simulate persistence across two boots. */
export function bootApp(flags: FeatureFlags = {}, io: ReturnType<typeof memoryIo> = memoryIo()) {
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
  }
  document.documentElement.innerHTML = html;
  localStorage.clear();
  const plugins = registry();
  registerSystems(withKind(plugins, 'system'));
  registerAbilitySystems(withKind(plugins, 'ability'));
  registerFeatures(withKind(plugins, 'feature'));
  const ctx = createAppContext(graphStore(), appModel, flags, io);
  installRuntimeFeatureManager(ctx, plugins);
  plugins.start(ctx);
  ctx.bus.emit('app.start');
  const booted = ctx;
  window.app = booted;
  const stage = ctx.contexts.places.el(Places.Stage);
  if (stage) {
    stage.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
      toJSON: () => ({}),
    } as DOMRect);
  }
  return booted;
}

export const settle = async () => {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await Promise.resolve();
};

export const runCommand = (ctx: AppCtx, id: string, source: CommandSource = {}) =>
  ctx.contexts.commands.run(id, source);

/** Deterministic synthetic CPG-style snapshot: `count` nodes in clustered
 *  grid layout (30-node clusters ≈ microservices), ~`edgesPerNode` edges wired
 *  mostly intra-cluster with some cross-cluster calls. Used by the 10k scale
 *  probes and browser perf runs — same shape everywhere. */
export const syntheticSnapshot = (count: number, edgesPerNode = 1.5) => {
  const CLUSTER = 30;
  const types = ['service', 'database', 'cache', 'kafka', 'gateway', 'text'] as const;
  const nodes = Array.from({ length: count }, (_, i) => {
    const cluster = Math.floor(i / CLUSTER);
    const inCluster = i % CLUSTER;
    const clusterCol = cluster % 20, clusterRow = Math.floor(cluster / 20);
    return {
      id: `e${i + 1}`,
      Label: { text: `svc-${cluster}-${inCluster}` },
      NodeType: types[i % types.length] as string,
      Position: {
        x: clusterCol * 1400 + (inCluster % 6) * 200,
        y: clusterRow * 1200 + Math.floor(inCluster / 6) * 160,
      },
      Size: { w: 150, h: 64 },
    };
  });
  const edgeCount = Math.floor(count * edgesPerNode);
  const edges = Array.from({ length: edgeCount }, (_, i) => {
    const from = (i * 7919) % count;              // spread deterministically
    const sameCluster = i % 4 !== 0;              // 75% intra-cluster
    const to = sameCluster
      ? Math.floor(from / CLUSTER) * CLUSTER + ((from + 1 + (i % (CLUSTER - 1))) % CLUSTER)
      : (from + CLUSTER + (i % (count - CLUSTER))) % count;
    return { id: `r${i + 1}`, From: `e${from + 1}`, To: `e${Math.min(to, count - 1) + 1}`, EdgeKind: 'sync' as const };
  }).filter(e => e.From !== e.To);
  return { nodes, edges };
};

export type PerfTraceReport = {
  /** JS heap delta start→stop in bytes. Node heap is noisy without a forced GC —
   *  assert loose ceilings only, never exact values. Null when unreadable. */
  heapDeltaBytes: number | null;
  /** Render scheduler flushes inside the traced section. `overBudget` counts
   *  flushes above one 60fps frame (16.7ms) — the render-budget signal. */
  flush: { count: number; avgMs: number; maxMs: number; overBudget: number };
  /** Scheduler idle: gap between consecutive flushes. Null with <2 flushes. */
  idle: { avgGapMs: number; maxGapMs: number } | null;
};

/** Trace JS heap + render budget + scheduler idle across a test section.
 *  Turns the perf API on (samples/counters flow), snapshots heap, and reduces
 *  the scheduler's `Render.flush.*` series into a budget report on stop().
 *
 *    const trace = perfTrace(ctx);
 *    …drive the app…
 *    const report = trace.stop();
 *    expect(report.flush.maxMs).toBeLessThan(50);   // jsdom-tolerant
 */
export const perfTrace = (ctx: AppCtx) => {
  const wasEnabled = ctx.perf.enabled();
  ctx.perf.setEnabled(true);
  ctx.perf.reset();
  const heapStart = heapUsedBytes();
  return {
    stop(): PerfTraceReport {
      const snap = ctx.perf.snapshot();
      if (!wasEnabled) ctx.perf.setEnabled(false);
      const sample = (label: string) => snap.samples.find(row => row.label === label);
      const count = (label: string) => snap.counts.find(row => row.label === label)?.count ?? 0;
      const flush = sample('Render.flush.ms');
      const gap = sample('Render.flush.gapMs');
      return {
        heapDeltaBytes: heapStart != null && snap.heapUsedBytes != null ? snap.heapUsedBytes - heapStart : null,
        flush: {
          count: count('Render.flush'),
          avgMs: flush?.avg ?? 0,
          maxMs: flush?.max ?? 0,
          overBudget: count('Render.flush.overBudget'),
        },
        idle: gap ? { avgGapMs: gap.avg, maxGapMs: gap.max } : null,
      };
    },
  };
};

export const commandButton = (id: string) =>
  document.querySelector(`[data-command="${id}"]`) as HTMLElement | null;

export const field = (name: string) =>
  document.querySelector(`[data-form-field="${name}"]`) as HTMLInputElement | null;

export const modalText = () => document.querySelector('.modal-slot')?.textContent ?? '';
