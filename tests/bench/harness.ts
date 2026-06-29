/** harness — boots the real app and times the operations a user does on a big
 *  graph. Same boot path as the command testkit (jsdom + memory IO), so we
 *  measure the *actual* model + render + redraw stack, not a mock.
 *
 *  jsdom is single-threaded and synchronous — a single redraw cannot be
 *  interrupted mid-flight. So the driver predicts each op's cost at the next
 *  size from the measured growth ratio and tells us, per op, whether to run it.
 *  Ops projected over BUDGET_MS are recorded as projections instead of run, so
 *  an O(n²) op can never hang the process. `load` almost always still runs (it
 *  grows ~linearly), so "can it even display N nodes" is captured up to 100k. */
import { bootApp, settle } from '../commands/testkit';
import { nodeRef } from '../../frontend/core';
import type { AppCtx, ItemRef } from '../../frontend/types';
import { burnInstall } from './burn';

export const BUDGET_MS = 120_000; // hard per-op budget the user asked for
/** Run-gate for the interactive (super-linear) ops. Deliberately tight: their
 *  cost-curve *steepens* with n (zoom/pan rebuild-all is ≈O(n^1.5); select+delete
 *  is O(n·E) with array-spread GC), so a two-point power-law fit from the cheap
 *  regime badly *under*-projects them. 15 s headroom means once an op gets real
 *  at one size, the next size projects well past it and is skipped — a
 *  mis-projection can never hang single-threaded jsdom. `load`/`add` are linear
 *  and bounded, so they keep the full BUDGET_MS gate. */
export const GATE_MS = 15_000;

export type OpResult = { op: string; ms: number; over: boolean; projected?: number };
export type SizeResult = { nodes: number; edges: number; ops: OpResult[] };

const BURN = !!process.env.BURN;

/** Seed N nodes + M edges directly into the store (no per-item events — that is
 *  the "load a saved doc" path). Grid layout so culling has real geometry. */
function seed(ctx: AppCtx, nodes: number, edges: number) {
  const g = ctx.graphs.current;
  const cols = Math.ceil(Math.sqrt(nodes));
  const ids: string[] = [];
  for (let i = 0; i < nodes; i++) {
    const n = g.createNode({
      Label: { text: `n${i}` },
      Position: { x: (i % cols) * 220, y: Math.floor(i / cols) * 120 },
    });
    ids.push(n.id);
  }
  for (let i = 0; i < edges; i++) {
    const from = ids[i % ids.length];
    const to = ids[(i * 7 + 1) % ids.length];
    if (from && to && from !== to) g.createEdge({ From: from, To: to });
  }
  return ids;
}

/** `predict(op)` returns the projected ms for this op at this size, or null when
 *  unknown (first size with data). An op is run only when no projection exists
 *  or the projection is under budget. */
export type Predict = (op: string) => number | null;

export async function runSize(nodes: number, edges: number, predict: Predict): Promise<SizeResult> {
  if (BURN) burnInstall(); // accumulate across all sizes (no per-size reset —
  // the last size is mostly gated, so resetting there would blank the profile).
  const ctx = bootApp();
  const ops: OpResult[] = [];
  let ids: string[] = [];

  // `load`/`add` build DOM sequentially — they finish, they can't spin, so we
  // let them run up to the full hard budget (the 100k "can it display" number is
  // the headline). The O(n²)-prone interactive ops use the tighter GATE_MS.
  const SAFE = new Set(['load', 'add']);
  const run = async (op: string, fn: () => void | Promise<void>) => {
    const proj = predict(op);
    const gate = SAFE.has(op) ? BUDGET_MS : GATE_MS;
    if (proj != null && proj > gate) {
      ops.push({ op, ms: NaN, over: true, projected: proj }); // would hang — record projection
      return false;
    }
    const t = performance.now();
    await fn();
    await settle();
    const ms = performance.now() - t;
    ops.push({ op, ms, over: ms > BUDGET_MS });
    return true;
  };

  // load = seed model + first full stage render. Always attempt (≈linear).
  await run('load', async () => {
    ids = seed(ctx, nodes, edges);
    ctx.bus.emit('graph.node.updated', { graphId: ctx.graphs.current.id, id: ids[0] ?? 'e1' });
  });

  await run('add', () => { ctx.bus.emit('graph.node.create', {}); });

  // move multiple: select a slice, nudge once (drives item.nudge fan-out).
  if (predict('move-multiple') == null || predict("move-multiple")! <= GATE_MS) {
    const slice = ids.slice(0, Math.min(ids.length, 1000)).map(id => nodeRef(id) as ItemRef);
    ctx.selection.choose(slice);
    await settle();
  }
  await run('move-multiple', () => { ctx.bus.emit('item.nudge', { dx: 24, dy: 0 }); });

  // zoom: 5 wheel-equivalent steps.
  await run('zoom', async () => {
    for (let i = 0; i < 5; i++) { ctx.bus.emit('view.zoom.in'); await settle(); }
  });

  // pan: shift camera 5 times (camera fact → 'nodes' redraw scope).
  await run('pan', async () => {
    for (let i = 0; i < 5; i++) {
      const v = ctx.contexts.view.get();
      const next = ctx.contexts.view.set({ x: v.x + 200, y: v.y + 120 });
      ctx.bus.emit('view.changed', next);
      await settle();
    }
  });

  // collapse / expand: zen fold toggle = full-shell redraw (proxy for subtree
  // collapse redraw cost; container-subtree hiding is a v2 refinement).
  await run('collapse', () => { ctx.bus.emit('fold.toggle', { id: 'shell.zen' }); });
  await run('expand', () => { ctx.bus.emit('fold.toggle', { id: 'shell.zen' }); });

  // select + delete: choose all nodes, delete the set.
  if (predict('select+delete') == null || predict("select+delete")! <= GATE_MS) {
    const all = ctx.graphs.current.nodes().map(n => nodeRef(n.id) as ItemRef);
    ctx.selection.choose(all);
    await settle();
  }
  await run('select+delete', () => { ctx.bus.emit('selection.item.delete'); });

  return { nodes, edges, ops };
}
