import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';
import { introspect } from '../../../frontend/core';
import type { AppCtx } from '../../../frontend/core';

/**
 * dx probe — answers structured queries about the BOOTED app for tooling
 * (dx/cli/apptool.mjs CLI and the dx model tools). Driven entirely by env:
 *
 *   PROBE_REQUEST  JSON {mode: 'events'|'commands'|'flows'|'scenario', ...}
 *   PROBE_OUT      file path to write the JSON answer to
 *
 * Without PROBE_REQUEST the test is skipped, so the normal suite ignores it.
 * It boots the real app (bootApp) — answers reflect the CURRENT working tree,
 * which is what makes `scenario` a verification micro-loop for agents.
 */

type Step = { command?: string; event?: string; data?: unknown };
type Assert = {
  /** Dot-path into ctx.debug.snapshot(), supports [i] indexing. */
  path?: string;
  /** CSS selector checked against the booted DOM. */
  css?: string;
  /** Regex (string) checked against a repo file's text, e.g. frontend/styles.css. */
  file?: string; matches?: string;
  /** Command-spec assert: command id + property path into its spec, e.g.
   *  {command:'choose.invert', has:'input.key', value:'i'} — the red test for
   *  "shortcut missing" tasks, where behavior alone can't go red. */
  command?: string; has?: string;
  /** Event-trace assert: did `event` fire during the steps? Optional payload
   *  check via path into its data: {event:'graph.exported', path:'json',
   *  op:'contains', value:'e1'}. The red test for "emit a new fact" tasks. */
  event?: string;
  op?: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'truthy' | 'falsy' | 'count' | 'exists' | 'textContains';
  value?: unknown;
};

const getPath = (root: unknown, path: string): unknown =>
  String(path ?? '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], root);

/** Emission edges are runtime-observed (bus origin index), so a fresh boot has
 *  none. Exercise the main lifecycles once so events/flows answers show who
 *  actually emits what. */
async function warmup(ctx: AppCtx) {
  runCommand(ctx, 'editing.node.create');
  await settle();
  runCommand(ctx, 'editing.node.create'); // selection set → also wires an edge
  await settle();
  runCommand(ctx, 'editing.container.create');
  await settle();
  const node = ctx.graphs.current.nodes()[0];
  const container = ctx.graphs.current.itemsOfKind<{ id: string }>('container')[0];
  if (node && container) ctx.sim.replay([{ name: 'container.add-child' as never, data: { containerId: container.id, childRef: { kind: 'node', id: node.id } }, at: 0 }]);
  if (node) ctx.sim.replay([{ name: 'item.update' as never, data: { ref: { kind: 'node', id: node.id }, patch: { Position: { x: 10, y: 10 } } }, at: 0 }]);
  ctx.sim.replay([
    { name: 'fold.toggle' as never, data: { id: 'shell.zen' }, at: 0 },
    { name: 'fold.toggle' as never, data: { id: 'shell.zen' }, at: 0 },
  ]);
  await settle();
}

function eventsAnswer(ctx: AppCtx, filter?: string) {
  const snap = introspect(ctx);
  const events = new Map<string, { event: string; firedByCommands: string[]; emittedBy: string[]; subscribedBy: string[] }>();
  const entry = (id: string) => events.get(id) ?? events.set(id, { event: id, firedByCommands: [], emittedBy: [], subscribedBy: [] }).get(id)!;
  snap.edges.forEach(e => {
    if (e.to.kind !== 'event') return;
    if (e.relation === 'fires') entry(e.to.id).firedByCommands.push(e.from.id);
    if (e.relation === 'emits') entry(e.to.id).emittedBy.push(e.from.id);
    if (e.relation === 'subscribes') entry(e.to.id).subscribedBy.push(e.from.id);
  });
  let list = [...events.values()].sort((a, b) => a.event.localeCompare(b.event));
  if (filter) list = list.filter(e => e.event.includes(filter));
  return { count: list.length, events: list };
}

function commandsAnswer(ctx: AppCtx, filter?: string) {
  let list = ctx.contexts.commands.all().map(c => ({
    id: c.id,
    label: c.label,
    group: c.group ?? null,
    shortcut: c.shortcut ?? null,
    key: c.input ? `${c.input.on}${c.input.key ? `:${c.input.key}` : ''}${c.input.shift ? '+shift' : ''}${c.input.ctrl ? '+ctrl' : ''}${c.input.alt ? '+alt' : ''}${c.input.meta ? '+meta' : ''}` : null,
    event: c.event,
    hidden: !!c.hidden,
    origin: c.origin ?? null,
  }));
  if (filter) list = list.filter(c => `${c.id} ${c.label} ${c.group}`.includes(filter));
  return { count: list.length, commands: list };
}

function flowsAnswer(ctx: AppCtx, eventName: string) {
  const snap = introspect(ctx);
  const firedBy = snap.edges.filter(e => e.relation === 'fires' && e.to.id === eventName).map(e => e.from.id);
  const emittedBy = snap.edges.filter(e => e.relation === 'emits' && e.to.id === eventName).map(e => e.from.id);
  const handlers = snap.edges.filter(e => e.relation === 'subscribes' && e.to.id === eventName).map(e => e.from.id);
  // 1-hop downstream: what each handler emits (the likely continuation of the flow).
  const downstream = handlers.map(origin => ({
    handler: origin,
    emits: snap.edges.filter(e => e.relation === 'emits' && e.from.id === origin).map(e => e.to.id),
  }));
  return { event: eventName, firedByCommands: firedBy, emittedBy, handledBy: handlers, downstream };
}

/** Rank known names by dot-token overlap with a wrong guess — "graph.node.create"
 *  should surface "editing.node.create" as the suggestion. */
const closest = (guess: string, known: string[], n = 3): string[] => {
  const tokens = new Set(guess.split(/[.\-]/).filter(Boolean));
  return known
    .map(name => ({ name, score: name.split(/[.\-]/).filter(t => tokens.has(t)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.name);
};

const TRACE_NOISE = /^(render\.|affordance\.|decoration\.|outline\.|app\.start)/;

async function scenarioAnswer(ctx: AppCtx, steps: Step[], asserts: Assert[]) {
  const stepResults: { step: string; ok: boolean; detail?: string }[] = [];
  const subscribed = (ctx.bus as unknown as { _subscribed?: Set<string> })._subscribed ?? new Set<string>();
  const recorder = ctx.sim.record();
  recorder.start();
  for (const step of steps) {
    // A handler that assumes a real DOM source (e.g. a drag payload reading
    // target.dataset) must FAIL the step cleanly, not crash the whole probe —
    // a red test should fail, not throw.
    try {
    if (step.command) {
      const ran = runCommand(ctx, step.command);
      let hint: string | undefined;
      if (!ran) {
        const spec = ctx.contexts.commands.get(step.command);
        hint = spec
          ? `command exists but is UNAVAILABLE right now — its available() guard needs preconditions (e.g. create nodes with editing.node.create, or select something) earlier in steps`
          : subscribed.has(step.command)
            ? `"${step.command}" is a bus event, not a command — use {"event":"${step.command}","data":{...}} or run the user command that fires it`
          : `unknown command. Closest: ${closest(step.command, ctx.contexts.commands.all().map(c => c.id)).join(', ') || 'none'}`;
      }
      stepResults.push({ step: `command ${step.command}`, ok: ran, detail: hint });
    } else if (step.event) {
      const known = subscribed.has(step.event);
      const domish = /^(key|click|pointer|wheel|input|change|focus)/.test(step.event);
      ctx.sim.replay([{ name: step.event as never, data: step.data, at: 0 }]);
      stepResults.push({
        step: `event ${step.event}`,
        ok: known,
        detail: known ? undefined
          : domish ? `"${step.event}" is DOM input, not a bus event — run the COMMAND instead: {"command":"<id>"}`
          : `no listener for this event. Closest events: ${closest(step.event, [...subscribed]).join(', ') || 'none'}`,
      });
    }
    } catch (err) {
      stepResults.push({ step: step.command ? `command ${step.command}` : `event ${step.event}`, ok: false, detail: `threw: ${(err as Error).message}` });
    }
    await settle();
  }
  const fired = recorder.stop();
  const snap = ctx.debug!.snapshot();
  const check = (a: Assert): { desc: string; pass: boolean; actual: unknown } => {
    if (a.event) {
      const matches = fired.filter(e => e.name === a.event);
      if (!a.path) return { desc: `event ${a.event} fired`, pass: matches.length > 0, actual: matches.length ? `fired ${matches.length}×` : 'never fired' };
      if (typeof a.path !== 'string') return { desc: `event ${a.event} data path`, pass: false, actual: 'invalid path — use a string dot-path like json' };
      const data = matches.at(-1)?.data;
      const actual = getPath(data, a.path);
      const pass = a.op === 'contains' ? String(actual).includes(String(a.value)) : JSON.stringify(actual) === JSON.stringify(a.value);
      return { desc: `event ${a.event} data.${a.path} ${a.op ?? 'eq'} ${JSON.stringify(a.value)}`, pass: matches.length > 0 && pass, actual: matches.length ? actual : 'event never fired' };
    }
    if (a.command) {
      const spec = ctx.contexts.commands.get(a.command);
      if (!spec) return { desc: `command ${a.command} exists`, pass: false, actual: 'no such command' };
      if (a.has != null && typeof a.has !== 'string') return { desc: `command ${a.command} has path`, pass: false, actual: 'invalid has — use a string dot-path like input.key' };
      const actual = a.has ? getPath(spec, a.has) : true;
      const pass = a.value === undefined ? actual != null : JSON.stringify(actual) === JSON.stringify(a.value);
      return { desc: `command ${a.command} ${a.has ?? 'exists'} == ${JSON.stringify(a.value)}`, pass, actual };
    }
    if (a.file) {
      const text = readFileSync(resolve(process.cwd(), a.file), 'utf8');
      const re = new RegExp(a.matches ?? '');
      return { desc: `file ${a.file} matches /${a.matches}/`, pass: re.test(text), actual: re.test(text) };
    }
    if (a.css) {
      const els = document.querySelectorAll(a.css);
      if (a.op === 'count') return { desc: `css ${a.css} count ${a.value}`, pass: els.length === Number(a.value), actual: els.length };
      if (a.op === 'textContains') return { desc: `css ${a.css} text contains ${a.value}`, pass: [...els].some(el => (el.textContent ?? '').includes(String(a.value))), actual: [...els].map(el => el.textContent).join('|').slice(0, 120) };
      return { desc: `css ${a.css} exists`, pass: els.length > 0, actual: els.length };
    }
    if (a.path != null && typeof a.path !== 'string') {
      return { desc: 'snapshot path', pass: false, actual: 'invalid path — use a string dot-path like ui.shell.zen' };
    }
    if (/^ctx\.|\(\)/.test(a.path ?? '')) {
      return { desc: `${a.path}`, pass: false, actual: 'invalid path — use plain snapshot paths like selection.count, graph.nodes, ui.rendered.nodes, ui.shell.zen (no ctx., no ())' };
    }
    const actual = getPath(snap, a.path ?? '');
    const op = a.op ?? 'eq';
    const pass =
      op === 'eq' ? JSON.stringify(actual) === JSON.stringify(a.value)
      : op === 'neq' ? JSON.stringify(actual) !== JSON.stringify(a.value)
      : op === 'gt' ? Number(actual) > Number(a.value)
      : op === 'lt' ? Number(actual) < Number(a.value)
      : op === 'contains' ? String(actual).includes(String(a.value))
      : op === 'truthy' ? !!actual
      : op === 'falsy' ? !actual
      : false;
    return { desc: `${a.path} ${op} ${JSON.stringify(a.value)}`, pass, actual };
  };
  const assertResults = asserts.map(a => {
    try { return check(a); }
    catch (err) { return { desc: `assert ${JSON.stringify(a).slice(0, 60)}`, pass: false, actual: `threw: ${(err as Error).message}` }; }
  });
  const firedNames = [...new Set(fired.map(e => String(e.name)))].filter(n => !TRACE_NOISE.test(n));
  return {
    ok: stepResults.every(s => s.ok) && assertResults.every(a => a.pass),
    steps: stepResults,
    asserts: assertResults,
    eventsFired: firedNames.slice(0, 40),
    state: {
      nodes: snap.graph.nodes.length,
      edges: snap.graph.edges.length,
      containers: snap.graph.containers.length,
      selection: snap.selection.selected,
      rendered: snap.ui.rendered,
      shell: snap.ui.shell,
      modalOpen: snap.ui.modal.open,
    },
  };
}

it.skipIf(!process.env.PROBE_REQUEST)('answers PROBE_REQUEST', async () => {
  const request = JSON.parse(process.env.PROBE_REQUEST!) as { mode: string; filter?: string; event?: string; steps?: Step[]; asserts?: Assert[] };
  const out = process.env.PROBE_OUT!;
  let answer: unknown;
  try {
    const ctx = bootApp();
    await settle();
    if (request.mode === 'events' || request.mode === 'flows') await warmup(ctx);
    if (request.mode === 'events') answer = eventsAnswer(ctx, request.filter);
    else if (request.mode === 'commands') answer = commandsAnswer(ctx, request.filter);
    else if (request.mode === 'flows') answer = flowsAnswer(ctx, request.event ?? request.filter ?? '');
    else if (request.mode === 'scenario') answer = await scenarioAnswer(ctx, request.steps ?? [], request.asserts ?? []);
    else answer = { error: `unknown mode: ${request.mode}` };
  } catch (err) {
    answer = { error: (err as Error).message };
  }
  writeFileSync(out, JSON.stringify(answer, null, 1));
  expect(out).toBeTruthy();
});
