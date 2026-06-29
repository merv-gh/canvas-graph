/** burn — lightweight "flame"/hot-path profiler for the bench.
 *
 *  No sampling profiler in jsdom worker land; instead we wrap the model's hot
 *  methods (+ entity renderer draw) with call-count + cumulative self-time
 *  counters. After a run, `burnReport()` ranks them by total time so the
 *  optimization plan targets the right places. Self-time is approximate
 *  (wrapper overhead included) but the *ranking* is what matters. */
import { Graph } from '../../frontend/model/graph';

type Counter = { calls: number; total: number };
const counters = new Map<string, Counter>();
let installed = false;

const bump = (label: string, dt: number) => {
  const c = counters.get(label) ?? counters.set(label, { calls: 0, total: 0 }).get(label)!;
  c.calls++;
  c.total += dt;
};

/** Wrap one method on a prototype with a timing counter. */
function wrap<T extends object>(proto: T, name: keyof T, label: string) {
  const original = proto[name] as unknown as (...args: unknown[]) => unknown;
  if (typeof original !== 'function') return;
  (proto as Record<string, unknown>)[name as string] = function (this: unknown, ...args: unknown[]) {
    const t = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      bump(label, performance.now() - t);
    }
  };
}

/** Install once. Idempotent. Targets the model methods the architecture review
 *  flagged as O(n) / per-call-allocating, plus the few that are O(E). */
export function burnInstall() {
  if (installed) return;
  installed = true;
  const p = Graph.prototype as unknown as Record<string, unknown>;
  for (const name of ['itemsOfKind', 'getItem', 'nodes', 'edges', 'edgesOf', 'deleteNode', 'createNode', 'createEdge', 'getNode']) {
    if (typeof p[name] === 'function') wrap(Graph.prototype as object, name as never, `Graph.${name}`);
  }
}

export function burnReset() {
  counters.clear();
}

export type BurnRow = { label: string; calls: number; totalMs: number; usPerCall: number };

export function burnRows(): BurnRow[] {
  return [...counters.entries()]
    .map(([label, c]) => ({ label, calls: c.calls, totalMs: c.total, usPerCall: (c.total / Math.max(1, c.calls)) * 1000 }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function burnMarkdown(): string {
  const rows = burnRows();
  if (!rows.length) return '_burn disabled (set BURN=1)_';
  const head = '| Hot path | Calls | Total ms | µs/call |\n|---|--:|--:|--:|';
  const body = rows
    .map(r => `| \`${r.label}\` | ${r.calls.toLocaleString()} | ${r.totalMs.toFixed(1)} | ${r.usPerCall.toFixed(2)} |`)
    .join('\n');
  return `${head}\n${body}`;
}
