#!/usr/bin/env node
// dx — overnight TDD loop for local models.
//
//   node dx/ollama-runner/loop.mjs                  # endless until dx/STOP exists
//   node dx/ollama-runner/loop.mjs --hours 8        # overnight run
//   node dx/ollama-runner/loop.mjs --task detail-shortcuts --max-turns 6
//
// Cycle = every task in dx/tasks/TASKS.md once (+ a walk session). Each attempt runs in
// a disposable workspace; RED writes a failing test, GREEN makes it pass,
// VERIFY runs the full suite + typecheck. Everything lands in dx/journal/.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fencedBlocks, OllamaChat } from './ollama.mjs';
import { MockChat } from './mock.mjs';
import { HumanChat } from './human.mjs';
import { buildMessages, buildSystemPrompt, buildTaskCard, estTokens, trimResult } from './context.mjs';
import { Tools } from './tools.mjs';
import { Workspace } from './workspace.mjs';
import { Browser } from './browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DX_ROOT = resolve(HERE, '..');
const REPO = resolve(DX_ROOT, '..');
const CONFIG = JSON.parse(readFileSync(join(DX_ROOT, 'config.json'), 'utf8'));

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const HOURS = Number(opt('hours', 0));
const CYCLES = Number(opt('cycles', 0));
const ONLY_TASK = opt('task', null);
const MOCK = flag('mock');
const HUMAN = flag('human'); // you drive the attempt by hand — eval the context/views
const MODEL_OVERRIDE = opt('model', null);
const MAX_TURNS = Number(opt('max-turns', 0));

// ---------- journal ----------
const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = join(DX_ROOT, 'journal', `run-${runId}`);
mkdirSync(runDir, { recursive: true });
const reportPath = join(runDir, 'report.md');
appendFileSync(reportPath, `# dx run ${runId}\n\nmodel: ${MODEL_OVERRIDE ?? CONFIG.ollama.model} | mock: ${MOCK}\n\n| task | attempt | model | outcome | turns | minutes |\n|---|---|---|---|---|---|\n`);
const log = (line) => {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`${stamp} ${line}`);
  appendFileSync(join(runDir, 'dx.log'), `${stamp} ${line}\n`);
};

// ---------- tasks ----------
function parseTasks(md) {
  const tasks = [];
  for (const block of md.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    const task = { id: head.trim(), meta: {}, prompt: '' };
    const body = [];
    for (const line of rest) {
      const m = line.match(/^- (\w[\w-]*): (.*)$/);
      if (m && !body.length) task.meta[m[1]] = m[2].trim();
      else body.push(line);
    }
    task.prompt = body.join('\n').trim();
    task.title = task.meta.title ?? task.id;
    task.kind = task.meta.kind ?? 'bug';
    task.setup = task.meta.setup;
    task.files = task.meta.files;
    if (!task.meta.disabled) tasks.push(task);
  }
  return tasks;
}

// Harness-injected context: fuzzy-search the views by the task's concept and prepend
// the brief (matching commands + flow trace + entity) to the card — so a weak model
// HAS the cross-file context it won't fetch itself, and cards can stay terse.
function gatherAutoContext(wsDir, concept) {
  if (!concept || !concept.trim()) return '';
  try {
    const out = execFileSync(process.execPath, [join(DX_ROOT, 'projections', 'projections.mjs'), 'concept', concept], {
      cwd: wsDir, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
      env: { ...process.env, DX_PROJECTION_ROOT: wsDir },
    });
    const trimmed = out.trim();
    if (!trimmed || /no command\/flow match|provide a phrase/.test(trimmed)) return '';
    return trimmed.length > 1100 ? `${trimmed.slice(0, 1100)}\n…` : trimmed;
  } catch { return ''; }
}

// ---------- one attempt ----------
async function attempt(task, { cycle, n, model, temperature, seed }) {
  const attemptDir = join(runDir, `${task.id}-c${cycle}a${n}`);
  mkdirSync(attemptDir, { recursive: true });
  const jlog = (line) => log(`[${task.id}] ${line}`);
  const journal = (entry) => appendFileSync(join(attemptDir, 'messages.jsonl'), JSON.stringify(entry) + '\n');
  // Compact streaming hint for a tool call — the salient arg, not the whole blob.
  const argHint = (name, args) => {
    if (name === 'scenario' || name === 'gen_test') return `${(args.spec?.steps ?? []).length} steps / ${(args.spec?.asserts ?? []).length} asserts`;
    if (name === 'set_command' || name === 'add_command') return `${args.id ?? args.spec?.id ?? ''} ${Object.keys(args.props ?? args.spec ?? {}).join(',')}`;
    if (name === 'patch') return `${args.path} ${args.op}@${args.line}`;
    if (name === 'inspect') return `${args.what} ${args.filter ?? ''}`;
    if (name === 'graph') return `${args.mode} ${args.query ?? ''}`;
    return (args.path ?? args.id ?? args.event ?? JSON.stringify(args)).toString().slice(0, 80);
  };

  const ws = new Workspace(REPO, join(HERE, 'workspace'), jlog);
  const chat = HUMAN ? new HumanChat({ wsDir: ws.dir, log: jlog })
    : MOCK ? new MockChat(task.id, jlog)
    : new OllamaChat({ ...CONFIG.ollama, temperature }, jlog);
  let browser = null;
  const startedAt = Date.now();
  const deadline = startedAt + CONFIG.budgets.attemptMinutes * 60000;
  let outcome = 'fail';
  let turns = 0;

  try {
    ws.create();
    await ws.applySetup(task.setup);
    const autoContext = gatherAutoContext(ws.dir, task.meta?.concept ?? task.title);
    if (autoContext) jlog(`[context] injected ${estTokens(autoContext)}tok concept brief`);
    try {
      await ws.startVite(CONFIG.ports.vite);
      browser = new Browser(CONFIG.ports.vite, join(attemptDir, 'shots'), jlog);
      await browser.open();
    } catch (err) {
      jlog(`app stack unavailable (${err.message.split('\n')[0]}) — continuing without`);
      browser = null;
    }

    const tools = new Tools({ ws, browser, log: jlog });
    // Layout/focus tasks judge a real browser via the oracle (.layout.json spec);
    // everything else uses a jsdom vitest file.
    tools.defaultTestPath = task.kind === 'layout'
      ? `tests/commands/dx/${task.id}.layout.json`
      : `tests/commands/dx/${task.id}.test.ts`;
    tools.task = task;
    if (task.kind === 'layout' && !browser) { jlog('layout task needs the app stack, which failed to start — skipping'); outcome = 'fail: no browser'; }
    const notes = [];
    const history = [];
    const isWalk = task.kind === 'walk';
    tools.phase = isWalk ? 'walk' : 'red';
    // Built once with the initial phase; walk gets a reconnaissance-only prompt +
    // tool palette (red/green share SYSTEM_BASE, so 'red' is correct for both).
    const system = buildSystemPrompt(tools.phase);
    let parseMisses = 0;
    let extra = '';
    // Doom-loop breaker: small models repeat an identical failing action forever.
    const callCounts = new Map();
    let repeatStrikes = 0;
    let giveUpBounced = false;
    // Two-step payload protocol: small models reliably emit a bare tool head
    // ({"name":"write","arguments":{"path":...}}) and reliably emit pure fenced
    // code — but not both in one reply. When a write/edit arrives without its
    // payload, park it and ask for ONLY the missing piece as fenced block(s).
    let pending = null; // { name, args, asked }
    const missingPayload = (name, args) =>
      (name === 'write' && args.content == null)
      || (name === 'edit' && (args.old == null || args.new == null))
      || (name === 'patch' && args.text == null);
    const askForPayload = (p) => p.name === 'write'
      ? `Now send ONLY the entire file content for ${p.args.path} as ONE fenced code block (\`\`\` … \`\`\`). No JSON, no prose.`
      : p.name === 'patch'
        ? `Now send ONLY the new line(s) for ${p.args.path} as ONE fenced code block. No JSON, no prose.`
        : `Now send TWO fenced code blocks for ${p.args.path}: first the EXACT existing text to replace, second the new text. No JSON, no prose.`;

    const phaseTurnCap = () => MAX_TURNS
      || (isWalk ? CONFIG.budgets.walkTurns : tools.phase === 'red' ? CONFIG.budgets.redTurns : CONFIG.budgets.greenTurns);
    let phaseTurns = 0;

    while (Date.now() < deadline) {
      if (phaseTurns >= phaseTurnCap()) { jlog(`phase ${tools.phase}: turn cap`); break; }
      const card = buildTaskCard(task, tools.phase, extra, autoContext);
      const { messages, tokens } = buildMessages({ system, taskCard: card, notes, history, budgets: CONFIG.budgets, log: jlog });
      journal({ at: Date.now(), dir: 'send', phase: tools.phase, staticTokens: tokens, lastUser: messages.at(-1)?.content?.slice(0, 400) });

      let reply;
      try {
        reply = await chat.chat({ model, messages, seed: seed + turns, temperature });
      } catch (err) {
        jlog(`model error: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      turns++; phaseTurns++;

      // A parked write/edit consumes this reply as its payload: harvest fenced
      // blocks (or, for write, treat a code-looking bare reply as the file).
      if (pending && reply.kind === 'tool' && !missingPayload(reply.name, reply.args)) {
        pending = null; // model self-corrected with a complete (or different) call
      }
      if (pending) {
        const blocks = fencedBlocks(reply.rawText ?? '');
        const p = pending;
        if (p.name === 'write' && (blocks[0] != null || /^\s*import /.test(reply.rawText ?? ''))) {
          p.args.content = blocks[0] ?? reply.rawText;
          pending = null;
          reply = { kind: 'tool', name: p.name, args: p.args, rawText: reply.rawText };
        } else if (p.name === 'patch' && blocks[0] != null) {
          p.args.text = blocks[0];
          pending = null;
          reply = { kind: 'tool', name: p.name, args: p.args, rawText: reply.rawText };
        } else if (p.name === 'edit' && blocks.length >= 1) {
          if (p.args.old == null) p.args.old = blocks[0];
          if (p.args.new == null && blocks[1] != null) p.args.new = blocks[1];
          else if (p.args.new == null && p.asked >= 1 && blocks[0] != null && p.args.old !== blocks[0]) p.args.new = blocks[0];
          if (!missingPayload(p.name, p.args)) {
            pending = null;
            reply = { kind: 'tool', name: p.name, args: p.args, rawText: reply.rawText };
          } else {
            p.asked++;
            history.push({ role: 'user', content: `Got the old text. Now send ONE fenced code block with the NEW text for ${p.args.path}.` });
            continue;
          }
        } else {
          p.asked++;
          if (p.asked > 2) { pending = null; jlog('payload never arrived, dropping pending tool'); }
          else { history.push({ role: 'user', content: askForPayload(p) }); continue; }
        }
      }

      if (reply.kind === 'text') {
        parseMisses++;
        journal({ at: Date.now(), dir: 'recv-text', text: reply.text.slice(0, 600) });
        jlog(`${tools.phase.toUpperCase()}·t${phaseTurns} … prose, not a tool call: "${reply.text.replace(/\s+/g, ' ').slice(0, 90)}"`);
        if (parseMisses >= CONFIG.budgets.parseMisses) { jlog('too many non-tool replies'); break; }
        history.push({ role: 'assistant', content: reply.text.slice(0, 400) });
        history.push({ role: 'user', content: 'Reply with exactly ONE tool call (JSON: {"name":...,"arguments":{...}}). No prose.' });
        continue;
      }

      const { name, args } = reply;

      if (missingPayload(name, args)) {
        pending = { name, args, asked: 0 };
        journal({ at: Date.now(), dir: 'recv-tool', name, args: JSON.stringify(args).slice(0, 200), note: 'parked, awaiting payload' });
        jlog(`→ ${name} ${args.path} (awaiting fenced payload)`);
        history.push({ role: 'assistant', content: JSON.stringify({ name, arguments: args }) });
        history.push({ role: 'user', content: askForPayload(pending) });
        continue;
      }
      journal({ at: Date.now(), dir: 'recv-tool', name, args: JSON.stringify(args).slice(0, 800) });
      jlog(`${tools.phase.toUpperCase()}·t${phaseTurns} → ${name} ${argHint(name, args)}`);

      // read loops vary from/lines while re-reading the same file — key reads
      // by path so the breaker still sees them; allow more honest re-reads.
      const callKey = name === 'read' ? `read:${args.path}` : `${name}:${JSON.stringify(args)}`;
      const repeats = (callCounts.get(callKey) ?? 0) + 1;
      callCounts.set(callKey, repeats);
      const limit = name === 'read' ? 5 : 3;
      if (repeats >= limit && name !== 'run_test') {
        repeatStrikes++;
        if (repeatStrikes >= 3) { outcome = 'looping'; jlog('aborting: identical actions repeated'); break; }
        history.push({ role: 'assistant', content: JSON.stringify({ name, arguments: args }) });
        history.push({ role: 'user', content: `STOP. You already did exactly this ${repeats - 1} times and it did not help. The result will be identical. Re-read the last error and do something DIFFERENT (e.g. read the file, fix the actual cause, or use note to rethink).` });
        continue;
      }

      if (name === 'note' && args.text) notes.push(String(args.text).slice(0, 400));
      if (name === 'give_up') {
        if (!isWalk && !giveUpBounced && phaseTurns < phaseTurnCap() - 2) {
          giveUpBounced = true;
          history.push({ role: 'assistant', content: `give_up: ${args.reason ?? ''}` });
          history.push({ role: 'user', content: `Rejected — the task is real and you have ${phaseTurnCap() - phaseTurns} turns left. If a command id was "not found", use inspect {"what":"commands","filter":"<keyword>"} to get the REAL ids, then retry. Continue.` });
          continue;
        }
        outcome = `gave-up: ${args.reason ?? ''}`.slice(0, 120);
        break;
      }

      if (name === 'done') {
        if (isWalk) { outcome = 'walked'; writeFileSync(join(attemptDir, 'observations.md'), [...notes, args.summary ?? ''].join('\n')); break; }
        const check = phaseGate(tools, ws, task, jlog);
        if (check.advance === 'green') {
          tools.phase = 'green'; phaseTurns = 0; extra = '';
          history.push({ role: 'assistant', content: `done(red): ${args.summary ?? ''}` });
          history.push({ role: 'user', content: `RED ACCEPTED — your test fails as required:\n${check.detail}\nNow PHASE GREEN: edit frontend/ to make it pass.` });
          if (browser) await browser.screenshot('red-accepted').catch(() => {});
          continue;
        }
        if (check.advance === 'verify') {
          const verdict = verify(ws, jlog);
          if (verdict.ok) {
            outcome = 'fixed';
            if (browser) await browser.screenshot('fixed').catch(() => {});
            break;
          }
          extra = '';
          history.push({ role: 'assistant', content: `done(green): ${args.summary ?? ''}` });
          history.push({ role: 'user', content: `Your test passes BUT full verification failed:\n${trimResult(verdict.detail, CONFIG.budgets.toolResultChars)}\nFix without breaking your test. If the failing test asserts old behavior that this task intentionally changes, call give_up with "spec conflict" instead of patching random source.` });
          continue;
        }
        history.push({ role: 'assistant', content: `done: ${args.summary ?? ''}` });
        history.push({ role: 'user', content: check.detail });
        continue;
      }

      const result = await tools.dispatch(name, args);
      jlog(`     ⤷ ${String(result).split('\n')[0].slice(0, 150)}`);
      const cap = name === 'read' ? (CONFIG.budgets.readResultChars ?? 2600) : CONFIG.budgets.toolResultChars;
      let trimmed = trimResult(result, cap);

      // Auto-advance on evidence: models reliably run their test but forget
      // done(). A failing task-test in RED *is* the red gate; a passing one in
      // GREEN *is* the green gate.
      const lastRun = name === 'run_test' ? tools.lastRun : null;
      if (lastRun?.rel === tools.defaultTestPath && lastRun.ran && lastRun.testsRan) {
        if (tools.phase === 'red' && !lastRun.ok) {
          tools.phase = 'green'; phaseTurns = 0; extra = '';
          tools.taskTestPath = lastRun.rel;
          jlog('RED accepted (auto-advance)');
          if (browser) await browser.screenshot('red-accepted').catch(() => {});
          trimmed += `\n\n✅ RED ACCEPTED — your test fails as required. You are now in PHASE GREEN: edit code under frontend/ until this test passes (scenario to iterate, run_test to confirm).`;
        } else if (tools.phase === 'green' && lastRun.ok) {
          jlog('GREEN accepted (auto-advance), verifying');
          const verdict = verify(ws, jlog);
          if (verdict.ok) {
            outcome = 'fixed';
            if (browser) await browser.screenshot('fixed').catch(() => {});
            journal({ at: Date.now(), dir: 'auto', note: 'green verified, fixed' });
            break;
          }
          trimmed += `\n\nYour test passes BUT full verification failed:\n${trimResult(verdict.detail, CONFIG.budgets.toolResultChars)}\nFix without breaking your test. If the failing test asserts old behavior that this task intentionally changes, call give_up with "spec conflict" instead of patching random source.`;
        }
      }
      journal({ at: Date.now(), dir: 'tool-result', name, result: trimmed.slice(0, 800) });
      const turnsLeft = phaseTurnCap() - phaseTurns;
      const pressure = turnsLeft === 4 && !isWalk
        ? (tools.phase === 'red'
          ? `\n\n⚠ Only 4 turns left in RED. STOP exploring — write tests/commands/dx/${task.id}.test.ts NOW with what you know, run_test it, then done.`
          : '\n\n⚠ Only 4 turns left in GREEN. Apply your best fix NOW, run_test, then done.')
        : '';
      history.push({ role: 'assistant', content: JSON.stringify({ name, arguments: args }) });
      history.push({ role: 'user', content: `RESULT of ${name}:\n${trimmed}${pressure}` });
    }

    // A walk that ran out of turns/time (never called done) still produced
    // observations — salvage them and label it walked, not fail.
    if (isWalk && outcome === 'fail') {
      outcome = 'walked';
      writeFileSync(join(attemptDir, 'observations.md'), notes.join('\n'));
    }

    // ---------- wrap up ----------
    const diff = ws.diff();
    writeFileSync(join(attemptDir, 'fix.patch'), diff);
    if (browser) writeFileSync(join(attemptDir, 'console.log'), browser.consoleLogs());
    const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
    writeFileSync(join(attemptDir, 'result.json'), JSON.stringify({ task: task.id, cycle, attempt: n, model, seed, outcome, turns, minutes }, null, 2));
    appendFileSync(reportPath, `| ${task.id} | c${cycle}a${n} | ${model} | ${outcome} | ${turns} | ${minutes} |\n`);
    jlog(`outcome=${outcome} turns=${turns} ${minutes}min`);
    return outcome;
  } finally {
    chat.close?.();
    await browser?.close();
    await ws.destroy();
  }
}

/** Gate for done() in red/green. Returns {advance: 'green'|'verify'|null, detail}. */
function phaseGate(tools, ws, task, jlog) {
  // Layout/focus tasks are judged by the async browser oracle via run_test, which
  // pins tools.lastRun. done() trusts that just-computed result (re-running the
  // oracle synchronously here isn't possible); the model always run_tests first.
  if (task.kind === 'layout') {
    const specPath = `tests/commands/dx/${task.id}.layout.json`;
    if (!existsSync(join(ws.dir, specPath))) return { advance: null, detail: `No layout spec at ${specPath} yet — write one with gen_layout_test.` };
    const lr = tools.lastRun;
    const stale = !lr || lr.rel !== specPath || !lr.ran;
    if (tools.phase === 'red') {
      if (stale) return { advance: null, detail: `Run run_test on ${specPath} so the oracle can judge it before done.` };
      if (lr.ok) return { advance: null, detail: `Your layout asserts PASS on current code — not red. They must FAIL to prove the bug.` };
      tools.taskTestPath = specPath; jlog('RED accepted (layout oracle)');
      return { advance: 'green', detail: 'oracle: asserts fail as required' };
    }
    if (stale || !lr.ok) return { advance: null, detail: `Run run_test on ${specPath}; the oracle must PASS before done.` };
    jlog('GREEN accepted (layout oracle), verifying');
    return { advance: 'verify', detail: '' };
  }
  const testPath = `tests/commands/dx/${task.id}.test.ts`;
  if (tools.phase === 'red') {
    if (!existsSync(join(ws.dir, testPath))) return { advance: null, detail: `No test at ${testPath} yet — write it first.` };
    const res = ws.vitest(testPath);
    if (!res.ran || !res.testsRan) return { advance: null, detail: `Your test file CRASHES before any test runs (syntax/import error) — that is not a red test. Fix it:\n${res.output.slice(-600)}` };
    if (res.ok) return { advance: null, detail: `Your test PASSES on current code — it is not red. It must FAIL to prove the bug. Output:\n${res.output.slice(0, 500)}` };
    tools.taskTestPath = testPath;
    jlog('RED accepted');
    return { advance: 'green', detail: res.output.slice(-500) };
  }
  if (tools.phase === 'green') {
    const res = ws.vitest(tools.taskTestPath);
    if (!res.ok) return { advance: null, detail: `Your test still FAILS:\n${res.output.slice(-600)}` };
    jlog('GREEN accepted, verifying');
    return { advance: 'verify', detail: '' };
  }
  return { advance: null, detail: 'unexpected phase' };
}

function verify(ws, jlog) {
  let suite = ws.vitest();
  if (!suite.ok) {
    // Timing-sensitive tests (camera animation) flake under load. Don't bounce
    // a phantom regression back to the model — confirm it twice.
    jlog('VERIFY: suite red, retrying once to rule out flake');
    suite = ws.vitest();
  }
  if (!suite.ok) { jlog('VERIFY: suite red (confirmed)'); return { ok: false, detail: suite.output.slice(-1200) }; }
  const types = ws.typecheck();
  if (!types.ok) { jlog('VERIFY: typecheck red'); return { ok: false, detail: types.output.slice(0, 1200) }; }
  jlog('VERIFY: all green');
  return { ok: true, detail: '' };
}

// ---------- main ----------
const tasks = parseTasks(readFileSync(join(DX_ROOT, 'tasks', 'TASKS.md'), 'utf8'))
  // Honour the delegate gate: in the normal queue only `delegate: ready` (or
  // untagged cards like walk) run, so un-disabling a not-ready card never hands
  // it to a weak model. --task overrides for manual / debug runs.
  .filter(t => ONLY_TASK ? t.id === ONLY_TASK : (!t.meta.delegate || t.meta.delegate === 'ready'));
if (!tasks.length) { console.error('no tasks matched'); process.exit(1); }

const endAt = HOURS ? Date.now() + HOURS * 3600000 : null;
const failCounts = {};
let cycle = 0;

log(`run ${runId}: ${tasks.length} task(s) — ${tasks.map(t => t.id).join(', ')}`);
for (;;) {
  cycle++;
  for (const task of tasks) {
    if (existsSync(join(DX_ROOT, 'STOP'))) { log('STOP file found — exiting'); process.exit(0); }
    if (endAt && Date.now() > endAt) { log('time budget reached'); process.exit(0); }
    if (task.kind === 'walk' && cycle % (CONFIG.walkEveryNCycles || 1) !== 0) continue;

    const fails = failCounts[task.id] ?? 0;
    const escalate = !MOCK && fails >= CONFIG.escalateAfterFails;
    const model = MODEL_OVERRIDE ?? (escalate ? CONFIG.ollama.escalateModel : CONFIG.ollama.model);
    const temperature = escalate ? CONFIG.ollama.escalateTemperature : CONFIG.ollama.temperature;
    const seed = CONFIG.ollama.seedBase + cycle * 131 + fails * 17;

    log(`=== cycle ${cycle} · ${task.id} · ${model}${escalate ? ' (escalated)' : ''} ===`);
    const outcome = await attempt(task, { cycle, n: fails + 1, model, temperature, seed });
    if (outcome === 'fixed' || outcome === 'walked') failCounts[task.id] = 0;
    else failCounts[task.id] = fails + 1;
  }
  if (CYCLES && cycle >= CYCLES) { log('cycle budget reached'); break; }
  if (HUMAN) { log('human: single pass'); break; } // you drive once; no auto-retry/escalation
  if (!CYCLES && !endAt && MOCK) break; // mock: single pass
}
log('dx finished');
