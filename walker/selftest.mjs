#!/usr/bin/env node
// Self-test for the walker toolbox: probe modes, scenario verdicts, test
// generation round-trip, knowledge-graph queries, and parser shapes.
//
//   node walker/selftest.mjs        (~40s; boots the real app several times)

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genTest, runProbe } from './probe-client.mjs';
import { graphQuery } from './graphdb.mjs';
import { parseToolFromText } from './ollama.mjs';
import { Tools } from './tools.mjs';
import { Workspace } from './workspace.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err.message}`); process.exitCode = 1; }
};
const okAsync = async (name, fn) => {
  try { await fn(); passed++; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err.message}`); process.exitCode = 1; }
};

// --- inspect: commands ---
const commands = runProbe(REPO, { mode: 'commands' });
ok('commands: lists 60+ with shortcuts', () => {
  assert(commands.count > 60, `count ${commands.count}`);
  const create = commands.commands.find(c => c.id === 'editing.node.create');
  assert.equal(create.key, 'keydown:a');
  assert.equal(create.origin, 'nodeLifecycle');
});
ok('commands: filter narrows', () => {
  const detail = runProbe(REPO, { mode: 'commands', filter: 'detail' });
  assert.equal(detail.count, 2);
  assert.equal(detail.commands[0].shortcut, null); // the known gap (detail-shortcuts task)
});

// --- inspect: events + flows ---
ok('events: fold.toggle has subscribers', () => {
  const events = runProbe(REPO, { mode: 'events', filter: 'fold.toggle' });
  const fold = events.events.find(e => e.event === 'fold.toggle');
  assert(fold.subscribedBy.includes('foldable'), JSON.stringify(fold));
});
ok('flows: editing.node.create chains through nodeLifecycle', () => {
  const flow = runProbe(REPO, { mode: 'flows', event: 'editing.node.create' });
  assert(flow.handledBy.includes('nodeLifecycle'), JSON.stringify(flow.handledBy));
  const lifecycle = flow.downstream.find(d => d.handler === 'nodeLifecycle');
  assert(lifecycle.emits.includes('graph.node.create'), JSON.stringify(lifecycle));
});

// --- scenario: pass + fail verdicts ---
ok('scenario: passing asserts + state summary', () => {
  const answer = runProbe(REPO, {
    mode: 'scenario',
    steps: [{ command: 'editing.node.create' }, { command: 'editing.node.create' }],
    asserts: [
      { path: 'ui.rendered.nodes', op: 'eq', value: 2 },
      { css: '.node', op: 'count', value: 2 },
      { path: 'selection.count', op: 'eq', value: 1 },
    ],
  });
  assert.equal(answer.ok, true, JSON.stringify(answer.asserts));
  assert.equal(answer.state.nodes, 2);
});
ok('scenario: failing assert reports actual', () => {
  const answer = runProbe(REPO, {
    mode: 'scenario',
    steps: [{ event: 'fold.toggle', data: { id: 'shell.zen' } }],
    asserts: [{ path: 'ui.shell.zen', op: 'eq', value: false }],
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.asserts[0].actual, true);
});
ok('scenario: unknown command surfaces as failed step with suggestions', () => {
  const answer = runProbe(REPO, { mode: 'scenario', steps: [{ command: 'graph.node.create' }], asserts: [] });
  assert.equal(answer.ok, false);
  assert(answer.steps[0].detail.includes('editing.node.create'), answer.steps[0].detail);
});

ok('scenario: command-spec assert (shortcut red) reports actual', () => {
  const answer = runProbe(REPO, {
    mode: 'scenario',
    steps: [],
    asserts: [
      { command: 'choose.invert', has: 'input.key', value: 'i' },   // missing today → red
      { command: 'editing.node.create', has: 'input.key', value: 'a' }, // bound → green
    ],
  });
  assert.equal(answer.asserts[0].pass, false);
  assert.equal(answer.asserts[1].pass, true);
});
ok('scenario: unavailable vs unknown command hints differ', () => {
  const answer = runProbe(REPO, {
    mode: 'scenario',
    steps: [{ command: 'choose.invert' }, { command: 'totally.fake.cmd' }],
    asserts: [],
  });
  assert(answer.steps[0].detail.includes('UNAVAILABLE'), answer.steps[0].detail);
  assert(answer.steps[1].detail.includes('Closest'), answer.steps[1].detail);
});

// --- gen_test: generated file actually runs green on current truths ---
ok('gen_test: source runs green when asserting current behavior', () => {
  const source = genTest({
    title: 'selftest generated',
    steps: [{ event: 'fold.toggle', data: { id: 'shell.zen' } }],
    asserts: [{ path: 'ui.shell.zen', op: 'eq', value: true }, { file: 'v2/styles.css', matches: 'grid-row:\\s*2' }],
  });
  const dir = join(REPO, 'tests/commands/walker');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, '_selftest-gen.test.ts');
  writeFileSync(file, source);
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=dot', 'tests/commands/walker/_selftest-gen.test.ts'], { cwd: REPO, timeout: 120000, stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- graph queries ---
ok('graph find: locates the editable ability source', () => {
  const hits = graphQuery(REPO, 'find', 'registerEditable');
  assert(hits.some(h => h.file === 'v2/abilities/editable.ts'), JSON.stringify(hits).slice(0, 300));
});
ok('graph callers: someone calls registerJump', () => {
  const hits = graphQuery(REPO, 'callers', 'registerJump');
  assert(hits.length >= 1 && hits[0].file.includes('systems'), JSON.stringify(hits).slice(0, 300));
});
ok('graph file: symbols of containers.ts', () => {
  const hits = graphQuery(REPO, 'file', 'v2/systems/containers.ts');
  assert(hits.some(h => h.name === 'registerContainers'), JSON.stringify(hits.map(h => h.name)));
});

ok('scenario: event-trace assert sees a fired fact', () => {
  const answer = runProbe(REPO, {
    mode: 'scenario',
    steps: [{ command: 'editing.node.create' }],
    asserts: [{ event: 'graph.node.created' }, { event: 'never.fires.xyz' }],
  });
  assert.equal(answer.asserts[0].pass, true, JSON.stringify(answer.asserts[0]));
  assert.equal(answer.asserts[1].pass, false);
  assert(answer.eventsFired.includes('editing.node.create'), JSON.stringify(answer.eventsFired));
});

// --- parser shapes (regression for the live failures we saw) ---
ok('parser: backtick-string JSON, call syntax, fenced payload, patch', () => {
  const bt = parseToolFromText('{"name":"note","arguments":{"text":`multi\nline`}}');
  assert.equal(bt.args.text, 'multi\nline');
  const call = parseToolFromText('give_up("no way")');
  assert.equal(call.args.reason, 'no way');
  const fenced = parseToolFromText('{"name":"write","arguments":{"path":"a.ts"}}\n```ts\nconst x = "q";\n```');
  assert.equal(fenced.args.content, 'const x = "q";');
  const patch = parseToolFromText('{"name":"patch","arguments":{"path":"a.ts","op":"replace","line":3}}\n```\nnew line\n```');
  assert.equal(patch.args.text, 'new line');
});

// Stub workspace that mirrors Workspace.run (git/grep) for the read-only tools.
const stubWs = (dir) => ({
  dir, repoRoot: REPO,
  run(cmd, args, timeoutMs = 20000) {
    try { return { ok: true, output: execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (err) { return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() }; }
  },
});

// --- pure fs tools (instant, no boot) ---
ok('patch: replace + insert_after (green-phase v2 path)', () => {
  const dir = join(REPO, 'walker/.selftest-tmp');
  mkdirSync(join(dir, 'v2'), { recursive: true });
  const file = join(dir, 'v2/x.ts');
  writeFileSync(file, 'a\nb\nc\n');
  const tools = new Tools({ ws: stubWs(dir), browser: null, log: () => {} });
  tools.phase = 'green';
  tools.tool_patch({ path: 'v2/x.ts', op: 'replace', line: 2, count: 1, text: 'B' });
  tools.tool_patch({ path: 'v2/x.ts', op: 'insert_after', line: 1, text: 'a2' });
  assert.equal(readFileSync(file, 'utf8'), 'a\na2\nB\nc\n');
  rmSync(dir, { recursive: true, force: true });
});
ok('patch: refuses a non-v2 path during GREEN', () => {
  const dir = join(REPO, 'walker/.selftest-tmp2');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'y.ts'), 'x\n');
  const tools = new Tools({ ws: stubWs(dir), browser: null, log: () => {} });
  tools.phase = 'green';
  const out = tools.tool_patch({ path: 'y.ts', op: 'replace', line: 1, text: 'z' });
  assert(/not allowed/.test(out), out);
  rmSync(dir, { recursive: true, force: true });
});
ok('locate: returns verbatim numbered context for an anchor', () => {
  const tools = new Tools({ ws: stubWs(REPO), browser: null, log: () => {} });
  const out = tools.tool_locate({ anchor: "id: 'choose.invert'", dir: 'v2' });
  assert(/choose\.ts/.test(out) && /\d+\|/.test(out), out.slice(0, 200));
});
ok('serializeObject: arrow-fn strings stay raw, data quoted', () => {
  const tools = new Tools({ ws: stubWs(REPO), browser: null, log: () => {} });
  const out = tools.serializeObject({ shortcut: 'I', input: { on: 'keydown', key: 'i', prevent: true }, available: '() => true' });
  assert(out.includes("shortcut: 'I'"), out);
  assert(out.includes('available: () => true') && !out.includes("'() => true'"), out);
  assert(out.includes("{ on: 'keydown', key: 'i', prevent: true }"), out);
});

// --- constructor tools, verified in a disposable workspace copy ---
await okAsync('set_command + add_command take effect in a booted copy', async () => {
  const ws = new Workspace(REPO, join(REPO, 'walker/.selftest-ws'), () => {});
  try {
    ws.create();
    const tools = new Tools({ ws, browser: null, log: () => {} });
    tools.phase = 'green';

    // set_command: bind choose.invert to `i`.
    const sc = tools.tool_set_command({ id: 'choose.invert', props: { shortcut: 'I', input: { on: 'keydown', key: 'i', prevent: true } } });
    assert(/updated/.test(sc), `set_command: ${sc}`);

    // add_command: register a brand-new verb in graph.ts WITH a handler — and
    // no manual declare first, so this also exercises add_command's auto-declare
    // of the command's own request event (else the on(...) wouldn't typecheck).
    const ac = tools.tool_add_command({
      system: 'v2/systems/graph.ts',
      spec: { id: 'graph.edge.reverse', label: 'Reverse edge', group: 'edge' },
      handler: 'void data;',
    });
    assert(/registered 'graph\.edge\.reverse'/.test(ac), `add_command: ${ac}`);
    const graphSrc = readFileSync(join(ws.dir, 'v2/systems/graph.ts'), 'utf8');
    assert(/on\('graph\.edge\.reverse'/.test(graphSrc), 'handler not spliced');
    assert(/'graph\.edge\.reverse':\s*void;/.test(graphSrc), 'add_command did not auto-declare its event');

    // declare_event (standalone): a new typed fact.
    const de = tools.tool_declare_event({ system: 'v2/systems/graph.ts', event: 'graph.exported', type: '{ json: string }' });
    assert(/declared 'graph\.exported'/.test(de), `declare_event: ${de}`);
    assert(/'graph\.exported':\s*\{ json: string \}/.test(readFileSync(join(ws.dir, 'v2/systems/graph.ts'), 'utf8')), 'event not declared in file');

    // Boot the copy and confirm BOTH command changes are live, AND the new
    // event + declaration typecheck (run_test full = suite + tsc).
    const inv = runProbe(ws.dir, { mode: 'commands', filter: 'choose.invert' });
    assert.equal(inv.commands.find(c => c.id === 'choose.invert')?.key, 'keydown:i', JSON.stringify(inv.commands[0]));
    const rev = runProbe(ws.dir, { mode: 'commands', filter: 'graph.edge.reverse' });
    assert(rev.commands.some(c => c.id === 'graph.edge.reverse'), JSON.stringify(rev));
    const types = ws.typecheck();
    assert(types.ok, `constructor output must typecheck:\n${types.output.slice(0, 600)}`);
  } finally {
    await ws.destroy();
  }
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with FAILURES above)' : ''}`);
