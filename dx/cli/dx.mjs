#!/usr/bin/env node
// Unified control plane for dx.
//
// No args opens the small terminal menu:
//   node dx/cli/dx.mjs
//   npm run dx
//
// Direct commands are intentionally thin wrappers around the existing harness:
//   node dx/cli/dx.mjs status
//   node dx/cli/dx.mjs run <task|pending|all> [--mock] [--model <name>]
//   node dx/cli/dx.mjs log [--follow]
//   node dx/cli/dx.mjs preview <task>
//   node dx/cli/dx.mjs gate <task>
//   node dx/cli/dx.mjs land <task> [--yes]
//   node dx/cli/dx.mjs approve <task>
//   node dx/cli/dx.mjs archive <task>
//   node dx/cli/dx.mjs add
//   node dx/cli/dx.mjs clean [--keep 3] [--yes]
//   node dx/cli/dx.mjs project <list|status|show|generate|sync|watch> [projection] [filter]

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DX_ROOT = resolve(HERE, '..');
const REPO = resolve(DX_ROOT, '..');
const TASKS_FILE = join(DX_ROOT, 'tasks', 'TASKS.md');
const DONE_FILE = join(DX_ROOT, 'tasks', 'DONE.md');
const APPROVALS_FILE = join(DX_ROOT, 'tasks', 'APPROVALS.md');
const JOURNAL_DIR = join(DX_ROOT, 'journal');

const argv = parseArgv(process.argv.slice(2));

function parseArgv(args) {
  const positionals = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = true;
    }
  }
  return { cmd: positionals[0] ?? null, args: positionals.slice(1), opts };
}

function lines(s) {
  return String(s ?? '').split('\n').map(l => l.trim()).filter(Boolean);
}

function rel(p) {
  return relative(REPO, p).replaceAll('\\', '/');
}

function crop(value, n) {
  const s = String(value ?? '');
  return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}~`;
}

function pad(value, n) {
  return crop(value, n).padEnd(n, ' ');
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO,
    encoding: 'utf8',
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function runNode(script, args) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO,
    stdio: 'inherit',
  });
  return res.status ?? (res.signal ? 1 : 0);
}

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
    task.files = task.meta.files;
    task.disabled = Boolean(task.meta.disabled);
    tasks.push(task);
  }
  return tasks;
}

function loadTasks() {
  return parseTasks(readFileSync(TASKS_FILE, 'utf8'));
}

function loadDoneTasks() {
  if (!existsSync(DONE_FILE)) return [];
  return parseTasks(readFileSync(DONE_FILE, 'utf8'));
}

function splitTaskFile(md) {
  const parts = md.split(/^## /m);
  return {
    preamble: parts[0].trimEnd(),
    blocks: parts.slice(1).map(block => `## ${block.trimEnd()}\n`),
  };
}

function blockId(block) {
  return block.replace(/^## /, '').split('\n')[0].trim();
}

function approvedIds() {
  if (!existsSync(APPROVALS_FILE)) return new Set();
  return new Set(readFileSync(APPROVALS_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('##')));
}

function collectAttempts() {
  if (!existsSync(JOURNAL_DIR)) return [];
  const attempts = [];
  for (const run of readdirSync(JOURNAL_DIR).filter(n => n.startsWith('run-'))) {
    const runDir = join(JOURNAL_DIR, run);
    let entries = [];
    try { entries = readdirSync(runDir); } catch { continue; }
    for (const entry of entries) {
      const dir = join(runDir, entry);
      const resultFile = join(dir, 'result.json');
      if (!existsSync(resultFile)) continue;
      try {
        const result = JSON.parse(readFileSync(resultFile, 'utf8'));
        const patch = join(dir, 'fix.patch');
        attempts.push({
          ...result,
          dir,
          run,
          resultFile,
          patch: existsSync(patch) ? patch : null,
          at: statSync(resultFile).mtimeMs,
        });
      } catch {
        // Skip malformed journal entries; the log still has the details.
      }
    }
  }
  attempts.sort((a, b) => b.at - a.at);
  return attempts;
}

function indexAttempts(attempts = collectAttempts()) {
  const latest = new Map();
  const fixed = new Map();
  for (const attempt of attempts) {
    if (!latest.has(attempt.task)) latest.set(attempt.task, attempt);
    if (attempt.outcome === 'fixed' && attempt.patch && !fixed.has(attempt.task)) fixed.set(attempt.task, attempt);
  }
  return { latest, fixed };
}

function recordedTestPath(id) {
  return join(REPO, 'tests/commands/recorded', `${id}.test.ts`);
}

function taskRows() {
  const tasks = loadTasks();
  const approvals = approvedIds();
  const attempts = indexAttempts();
  return tasks.map((task, index) => {
    const latest = attempts.latest.get(task.id) ?? null;
    const fixed = attempts.fixed.get(task.id) ?? null;
    const landed = existsSync(recordedTestPath(task.id));
    const approved = approvals.has(task.id);
    const status = task.disabled
      ? 'disabled'
      : landed
        ? 'landed'
        : fixed
          ? 'fixed'
          : latest
            ? String(latest.outcome).slice(0, 16)
            : 'queued';
    const last = latest
      ? `${latest.outcome} ${latest.minutes ?? '?'}m ${latest.model ?? ''}`.trim()
      : '-';
    return { index: index + 1, task, latest, fixed, landed, approved, status, last };
  });
}

function printStatus() {
  const rows = taskRows();
  console.log('\ndx');
  console.log(`${pad('#', 3)} ${pad('task', 27)} ${pad('kind', 8)} ${pad('status', 10)} ${pad('patch', 5)} ${pad('approved', 8)} ${pad('last', 34)} title`);
  console.log(`${'-'.repeat(3)} ${'-'.repeat(27)} ${'-'.repeat(8)} ${'-'.repeat(10)} ${'-'.repeat(5)} ${'-'.repeat(8)} ${'-'.repeat(34)} ${'-'.repeat(20)}`);
  for (const row of rows) {
    const patch = row.fixed?.patch ? 'yes' : '-';
    const approved = row.approved ? 'yes' : '-';
    console.log(`${pad(row.index, 3)} ${pad(row.task.id, 27)} ${pad(row.task.kind, 8)} ${pad(row.status, 10)} ${pad(patch, 5)} ${pad(approved, 8)} ${pad(row.last, 34)} ${row.task.title}`);
  }
  const done = loadDoneTasks();
  if (done.length) console.log(`\ndone: ${done.map(t => t.id).join(', ')}`);
  const latestRun = latestRunDir();
  if (latestRun) console.log(`\nlatest run: ${rel(latestRun)}`);
}

function latestRunDir() {
  if (!existsSync(JOURNAL_DIR)) return null;
  const runs = readdirSync(JOURNAL_DIR)
    .filter(n => n.startsWith('run-'))
    .map(n => join(JOURNAL_DIR, n))
    .filter(p => {
      try { return statSync(p).isDirectory(); } catch { return false; }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return runs[0] ?? null;
}

function latestLogPath() {
  const run = latestRunDir();
  if (!run) return null;
  const log = join(run, 'dx.log');
  return existsSync(log) ? log : null;
}

function resolveTask(input, rows = taskRows()) {
  const value = String(input ?? '').trim();
  if (!value) return null;
  const number = Number(value);
  if (Number.isInteger(number)) {
    return rows.find(r => r.index === number) ?? (number >= 1 && number <= rows.length ? rows[number - 1] : null);
  }
  return rows.find(r => r.task.id === value) ?? null;
}

async function askTask(rl, { fixedOnly = false, includeLanded = true } = {}) {
  const rows = taskRows().filter(r => {
    if (fixedOnly && !r.fixed) return false;
    if (!includeLanded && r.landed) return false;
    return true;
  });
  if (!rows.length) {
    console.log(fixedOnly ? 'No fixed patches in the journal yet.' : 'No tasks found.');
    return null;
  }
  for (const row of rows) {
    const patch = row.fixed?.patch ? ` patch=${rel(row.fixed.patch)}` : '';
    console.log(`${row.index}. ${row.task.id} [${row.status}]${patch} - ${row.task.title}`);
  }
  const answer = await rl.question('Task number or id: ');
  return resolveTask(answer, rows);
}

function runDxRunner(target, opts = {}) {
  const args = ['dx/ollama-runner/loop.mjs', '--cycles', String(opts.cycles ?? 1)];
  if (target && target !== 'all' && target !== 'pending') args.push('--task', target);
  if (opts.mock) args.push('--mock');
  if (opts.human) args.push('--human');
  if (opts.model) args.push('--model', opts.model);
  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
  return runNode(args[0], args.slice(1));
}

async function runModel(rl, targetArg = null, opts = {}) {
  let target = targetArg;
  if (opts.human && (!target || target === 'pending' || target === 'all')) {
    console.log('Human mode drives one task by hand: node dx/cli/dx.mjs <task-id> --human');
    return 1;
  }
  if (!target) {
    console.log('\nRun target: task id/number, pending, or all.');
    const answer = await rl.question('Target [pending]: ');
    target = answer.trim() || 'pending';
  }
  if (/^\d+$/.test(target)) {
    const row = resolveTask(target);
    if (!row) return console.log('No such task number.');
    target = row.task.id;
  }
  if (target === 'pending') {
    const pending = taskRows()
      .filter(r => !r.task.disabled && !r.landed && !r.fixed && r.task.kind !== 'walk')
      .map(r => r.task.id);
    if (!pending.length) return console.log('No pending non-landed tasks. Add a task or archive completed work first.');
    console.log(`Running pending tasks: ${pending.join(', ')}`);
    for (const id of pending) {
      const code = runDxRunner(id, opts);
      if (code !== 0) return code;
    }
    return 0;
  }
  return runDxRunner(target, opts);
}

function showLog({ follow = false } = {}) {
  const log = latestLogPath();
  if (!log) {
    console.log('No dx.log found yet.');
    return 1;
  }
  console.log(`log: ${rel(log)}\n`);
  const args = follow ? ['-n', '120', '-f', log] : ['-n', '160', log];
  const res = spawnSync('tail', args, { cwd: REPO, stdio: 'inherit' });
  return res.status ?? 0;
}

async function isPortFree(port) {
  return new Promise(resolvePort => {
    const server = net.createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => server.close(() => resolvePort(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start = 5190) {
  for (let port = start; port < start + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  return start;
}

async function previewTask(row, opts = {}) {
  if (!row?.fixed?.patch) {
    console.log('No fixed patch for that task yet.');
    return 1;
  }
  const port = opts.port ? Number(opts.port) : await findFreePort(5190);
  console.log(`Previewing ${row.task.id} on port ${port}. Ctrl+C stops the preview workspace.`);
  return runNode('dx/cli/preview.mjs', [
    '--task', row.task.id,
    '--apply', row.fixed.patch,
    '--port', String(port),
  ]);
}

function gateTask(row) {
  if (!row?.fixed?.patch) {
    console.log('No fixed patch for that task yet.');
    return 1;
  }
  console.log(`Running apply gate for ${row.task.id}: ${rel(row.fixed.patch)}`);
  return runNode('dx/cli/apply.mjs', ['--task', row.task.id, '--patch', row.fixed.patch]);
}

function patchTouchedFiles(patch) {
  const files = new Set();
  for (const line of readFileSync(patch, 'utf8').split('\n')) {
    const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (m) files.add(m[2]);
  }
  return [...files];
}

function statusForPaths(paths) {
  if (!paths.length) return [];
  const out = git(['status', '--porcelain', '--', ...paths]);
  return lines(out);
}

function stagedFiles() {
  return lines(git(['diff', '--cached', '--name-only']));
}

function archiveTask(id) {
  if (!existsSync(TASKS_FILE)) return false;
  const { preamble, blocks } = splitTaskFile(readFileSync(TASKS_FILE, 'utf8'));
  const block = blocks.find(b => blockId(b) === id);
  if (!block) return false;

  const remaining = blocks.filter(b => blockId(b) !== id);
  writeFileSync(TASKS_FILE, `${preamble}\n\n${remaining.map(b => b.trimEnd()).join('\n\n')}\n`);

  const doneText = existsSync(DONE_FILE)
    ? readFileSync(DONE_FILE, 'utf8')
    : '# dx done\n\nCompleted tasks live here so `TASKS.md` stays the active local-model queue.\n';
  const doneIds = new Set(parseTasks(doneText).map(t => t.id));
  if (!doneIds.has(id)) {
    const archived = block.replace(/\n$/, '');
    writeFileSync(DONE_FILE, `${doneText.trimEnd()}\n\n${archived}\n`);
  }
  return true;
}

function ensureCleanLandingPaths(row) {
  const touched = patchTouchedFiles(row.fixed.patch);
  const recorded = `tests/commands/recorded/${row.task.id}.test.ts`;
  const checked = [...new Set([...touched, recorded])];
  const staged = stagedFiles();
  if (staged.length) {
    throw new Error(`Refusing to land with pre-existing staged files:\n${staged.join('\n')}`);
  }
  const dirty = statusForPaths(checked);
  if (dirty.length) {
    throw new Error(`Refusing to land because target paths are already dirty:\n${dirty.join('\n')}`);
  }
}

async function landTask(row, { yes = false, rl = null } = {}) {
  if (!row?.fixed?.patch) {
    console.log('No fixed patch for that task yet.');
    return 1;
  }
  if (row.landed && !yes) {
    console.log(`Task ${row.task.id} already has ${rel(recordedTestPath(row.task.id))}; not landing again.`);
    return 1;
  }
  if (!yes) {
    console.log(`\nThis will gate, apply, re-verify, stage only the patch paths, and commit:`);
    console.log(`task:  ${row.task.id}`);
    console.log(`patch: ${rel(row.fixed.patch)}`);
    console.log(`msg:   fix: ${row.task.id}`);
    const answer = await ask(rl, 'Type "land" to continue: ');
    if (answer.trim() !== 'land') return 1;
  }
  try {
    ensureCleanLandingPaths(row);
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  const code = runNode('dx/cli/apply.mjs', [
    '--task', row.task.id,
    '--patch', row.fixed.patch,
    '--apply-for-real',
    '--force',
  ]);
  if (code !== 0) return code;

  const archived = archiveTask(row.task.id);
  const commitPaths = new Set([
    ...patchTouchedFiles(row.fixed.patch),
    `tests/commands/recorded/${row.task.id}.test.ts`,
    `tests/commands/dx/${row.task.id}.test.ts`,
    ...(archived ? ['dx/tasks/TASKS.md', 'dx/tasks/DONE.md'] : []),
  ]);
  const addPaths = [...commitPaths].filter(path => existsSync(join(REPO, path)) || statusForPaths([path]).length);
  git(['add', '-A', '--', ...addPaths]);
  const staged = stagedFiles().filter(p => commitPaths.has(p));
  if (!staged.length) {
    console.log('Patch landed but no new staged files were found for the commit.');
    return 0;
  }
  const commit = spawnSync('git', ['commit', '-m', `fix: ${row.task.id}`, '--', ...staged], {
    cwd: REPO,
    stdio: 'inherit',
  });
  const status = commit.status ?? 0;
  if (status === 0) {
    const url = demoUrl(row.task);
    console.log(`\n🎉 Landed ${row.task.id}.`);
    if (url) console.log(`   See it: ${url}\n   (run \`npm run dev\` if it isn't up — the ?scenario= macro replays the demo on load)`);
    else console.log(`   Try it: run \`npm run dev\`, open http://127.0.0.1:5174/  (add a \`demo:\` macro to the task card for a one-click replay link)`);
  }
  return status;
}

function approveTask(row) {
  if (!row) return 1;
  const approvals = approvedIds();
  if (approvals.has(row.task.id)) {
    console.log(`${row.task.id} is already in ${rel(APPROVALS_FILE)}.`);
    return 0;
  }
  appendFileSync(APPROVALS_FILE, `${row.task.id}\n`);
  console.log(`Approved ${row.task.id} in ${rel(APPROVALS_FILE)}.`);
  return 0;
}

function archiveTaskRow(row) {
  if (!row) return 1;
  if (!archiveTask(row.task.id)) {
    console.log(`Task ${row.task.id} is not in ${rel(TASKS_FILE)}.`);
    return 1;
  }
  console.log(`Moved ${row.task.id} from ${rel(TASKS_FILE)} to ${rel(DONE_FILE)}.`);
  return 0;
}

async function addTask(rl) {
  console.log('\nNew dx task. Keep it small enough for the local model.');
  const id = (await rl.question('id (kebab-case): ')).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return console.log('Bad id. Use lowercase kebab-case.');
  if (loadTasks().some(t => t.id === id)) return console.log(`Task ${id} already exists.`);
  const kind = (await rl.question('kind [bug|feature|walk] (bug): ')).trim() || 'bug';
  const title = (await rl.question('title: ')).trim() || id;
  const files = (await rl.question('likely files (comma-separated, optional): ')).trim();
  const demo = (await rl.question('demo scenario macro (optional): ')).trim();
  console.log('Prompt lines. End with a single "." line.');
  const promptLines = [];
  for (;;) {
    const line = await rl.question('> ');
    if (line.trim() === '.') break;
    promptLines.push(line);
  }
  const meta = [
    `- kind: ${kind}`,
    files ? `- files: ${files}` : '',
    `- title: ${title}`,
    demo ? `- demo: ${demo}` : '',
  ].filter(Boolean);
  const block = `\n## ${id}\n${meta.join('\n')}\n\n${promptLines.join('\n').trim()}\n`;
  appendFileSync(TASKS_FILE, block);
  console.log(`Added ${id} to ${rel(TASKS_FILE)}.`);
}

async function cleanJournal({ keep = 3, yes = false, rl = null } = {}) {
  if (!existsSync(JOURNAL_DIR)) return console.log('No journal directory yet.');
  const runs = readdirSync(JOURNAL_DIR)
    .filter(n => n.startsWith('run-'))
    .map(n => ({ name: n, path: join(JOURNAL_DIR, n), at: statSync(join(JOURNAL_DIR, n)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const remove = runs.slice(Number(keep));
  if (!remove.length) return console.log(`Nothing to clean; ${runs.length} run(s), keeping ${keep}.`);
  console.log(`Will remove ${remove.length} old journal run(s), keeping ${keep}:`);
  for (const run of remove) console.log(`- ${rel(run.path)}`);
  if (!yes) {
    const answer = await ask(rl, 'Type "clean" to remove them: ');
    if (answer.trim() !== 'clean') return;
  }
  for (const run of remove) rmSync(run.path, { recursive: true, force: true });
  console.log('Journal cleaned.');
}

async function askLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); }
  finally { rl.close(); }
}

/** Prompt using the caller's readline when it has one. The menu shares a SINGLE
 *  interface for the whole session; a second interface on the same stdin echoes
 *  every keystroke twice AND, when it closes, pauses shared stdin so the menu's
 *  next question never resolves (the input-duplication + unsettled-await bug). */
async function ask(rl, question) {
  return rl ? rl.question(question) : askLine(question);
}

/** A shareable demo link: the dev server replays a `?scenario=` keystroke macro
 *  on load, so landing a feature hands back a one-click "see it work". */
function demoUrl(task) {
  const demo = task?.meta?.demo;
  return demo ? `http://127.0.0.1:5174/?scenario=${encodeURIComponent(demo)}` : null;
}

async function pause(rl) {
  await rl.question('\nPress Enter to continue...');
}

async function menu() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      printStatus();
      console.log('\nShortcuts:');
      console.log('  r  run local model     n  new task');
      console.log('  w  watch latest log    p  preview fixed patch');
      console.log('  g  gate fixed patch    l  land + commit fixed patch');
      console.log('  d  archive done task   o  approve task id');
      console.log('  c  clean old journal runs');
      console.log('  v  feature projections');
      console.log('  q  quit');
      const choice = (await rl.question('\ndx> ')).trim().toLowerCase();
      if (!choice || choice === 'q') break;
      if (choice === 'r') await runModel(rl, null, {});
      else if (choice === 'n') await addTask(rl);
      else if (choice === 'w') {
        const follow = (await rl.question('Follow live? [y/N]: ')).trim().toLowerCase() === 'y';
        showLog({ follow });
      } else if (choice === 'p') {
        const row = await askTask(rl, { fixedOnly: true });
        if (row) await previewTask(row, {});
      } else if (choice === 'g') {
        const row = await askTask(rl, { fixedOnly: true });
        if (row) gateTask(row);
      } else if (choice === 'l') {
        const row = await askTask(rl, { fixedOnly: true });
        if (row) await landTask(row, { rl });
      } else if (choice === 'o') {
        const row = await askTask(rl, { fixedOnly: true });
        if (row) approveTask(row);
      } else if (choice === 'd') {
        const row = await askTask(rl, {});
        if (row) archiveTaskRow(row);
      } else if (choice === 'c') {
        const keepRaw = await rl.question('Keep latest N runs [3]: ');
        await cleanJournal({ keep: keepRaw.trim() || 3, rl });
      } else if (choice === 'v') {
        console.log('\nProjection actions: list, status, show, generate, sync, watch');
        const action = (await rl.question('Action [status]: ')).trim() || 'status';
        const name = (await rl.question('Projection [commands]: ')).trim() || 'commands';
        runNode('dx/projections/projections.mjs', [action, name]);
      } else {
        printHelp();
      }
      if (!['r', 'p', 'g', 'l', 'w', 'v'].includes(choice)) await pause(rl);
    }
  } finally {
    rl.close();
  }
}

function printHelp() {
  console.log(`
usage:
  npm run dx
  node dx/cli/dx.mjs status
  node dx/cli/dx.mjs run <task|pending|all> [--mock] [--model <name>] [--max-turns <n>]
  node dx/cli/dx.mjs log [--follow]
  node dx/cli/dx.mjs preview <task>
  node dx/cli/dx.mjs gate <task>
  node dx/cli/dx.mjs land <task> [--yes]
  node dx/cli/dx.mjs approve <task>
  node dx/cli/dx.mjs archive <task>
  node dx/cli/dx.mjs add
  node dx/cli/dx.mjs clean [--keep 3] [--yes]
  node dx/cli/dx.mjs project <list|status|show|generate|sync|watch> [projection] [filter]
`);
}

async function main() {
  if (!argv.cmd) return menu();
  if (argv.cmd === 'status') return printStatus();
  if (argv.cmd === 'help' || argv.cmd === '--help' || argv.cmd === '-h') return printHelp();
  if (argv.cmd === 'run' || argv.cmd === 'watch' || argv.cmd === 'human') {
    const target = argv.args[0] ?? 'pending';
    return runModel(null, target, {
      mock: Boolean(argv.opts.mock),
      human: argv.cmd === 'human' || Boolean(argv.opts.human),
      model: argv.opts.model,
      maxTurns: argv.opts['max-turns'],
      cycles: argv.opts.cycles ?? 1,
    });
  }
  if (argv.cmd === 'log') return showLog({ follow: Boolean(argv.opts.follow) });
  if (argv.cmd === 'add') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return addTask(rl); }
    finally { rl.close(); }
  }
  if (['preview', 'gate', 'land', 'approve', 'archive'].includes(argv.cmd)) {
    const rows = taskRows();
    const row = resolveTask(argv.args[0], rows);
    if (!row) {
      console.error('Task not found. Run `node dx/cli/dx.mjs status` for ids.');
      process.exitCode = 1;
      return;
    }
    if (argv.cmd === 'preview') return previewTask(row, { port: argv.opts.port });
    if (argv.cmd === 'gate') return gateTask(row);
    if (argv.cmd === 'approve') return approveTask(row);
    if (argv.cmd === 'archive') return archiveTaskRow(row);
    return landTask(row, { yes: Boolean(argv.opts.yes) });
  }
  if (argv.cmd === 'clean') return cleanJournal({ keep: argv.opts.keep ?? 3, yes: Boolean(argv.opts.yes) });
  if (['project', 'projection', 'projections', 'view', 'views'].includes(argv.cmd)) {
    const passthroughFlags = Object.entries(argv.opts)
      .flatMap(([key, value]) => (value === true ? [`--${key}`] : [`--${key}`, String(value)]));
    const passed = (argv.args.length ? argv.args : ['status']).concat(passthroughFlags);
    return runNode('dx/projections/projections.mjs', passed);
  }
  // Bare task id: `dx <task-id> [--human]` is shorthand for `dx run <task-id>`.
  if (argv.cmd && resolveTask(argv.cmd)) {
    return runModel(null, argv.cmd, {
      human: Boolean(argv.opts.human),
      mock: Boolean(argv.opts.mock),
      model: argv.opts.model,
      maxTurns: argv.opts['max-turns'],
      cycles: argv.opts.cycles ?? 1,
    });
  }
  printHelp();
  process.exitCode = 2;
}

// No top-level await: the menu's stdin loop can legitimately stay pending until
// the user quits, and a top-level await over it triggers Node's spurious
// "unsettled top-level await" warning. `.then` settles the exit code instead.
main()
  .then(code => { if (Number.isInteger(code)) process.exitCode = code; })
  .catch(err => { console.error(err?.stack ?? err); process.exitCode = 1; });
