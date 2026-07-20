#!/usr/bin/env node
// apply — gate a model's fix and (when approved) land it in the real repo.
//
//   node dx/cli/apply.mjs --task <id>                  # dry-run: gate + report
//   node dx/cli/apply.mjs --task <id> --apply-for-real # land it (needs approval)
//   node dx/cli/apply.mjs --task <id> --patch <file>   # gate a specific patch
//
// The gate runs in a fresh workspace: full vitest suite + browser layout oracle
// + tsc + 80% coverage. "Truly ready" = all four green. Landing also requires the task id in
// dx/tasks/APPROVALS.md (the human gate) unless --force. Landing applies the frontend/
// change to the repo, relocates the model's test into tests/commands/recorded/,
// then re-verifies the real repo. Nothing touches the repo without --apply-for-real.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser } from '../ollama-runner/browser.mjs';
import { Workspace } from '../ollama-runner/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DX_ROOT = resolve(HERE, '..');
const REPO = resolve(DX_ROOT, '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const taskId = opt('task', null);
const forReal = has('apply-for-real');
const force = has('force');
let patchPath = opt('patch', null);

if (!taskId && !patchPath) { console.error('usage: apply.mjs --task <id> [--apply-for-real] [--patch <file>] [--force]'); process.exit(2); }

const log = (l) => console.log(l);
const fail = (l) => { console.error(`✗ ${l}`); process.exit(1); };

/** Most recent journal attempt for the task whose result.json says fixed. */
function latestFixedPatch(id) {
  const journal = join(DX_ROOT, 'journal');
  if (!existsSync(journal)) return null;
  const candidates = [];
  for (const run of readdirSync(journal)) {
    const dir = join(journal, run, `${id}-c1a1`);
    const result = join(dir, 'result.json');
    const patch = join(dir, 'fix.patch');
    if (existsSync(result) && existsSync(patch)) {
      try {
        const r = JSON.parse(readFileSync(result, 'utf8'));
        if (r.outcome === 'fixed') candidates.push({ patch, at: statSync(patch).mtimeMs });
      } catch { /* skip */ }
    }
  }
  candidates.sort((a, b) => b.at - a.at);
  return candidates[0]?.patch ?? null;
}

function approved(id) {
  const f = join(DX_ROOT, 'tasks', 'APPROVALS.md');
  if (!existsSync(f)) return false;
  return readFileSync(f, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('##'))
    .includes(id);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function browserLayoutGate(ws) {
  const specsDir = join(ws.dir, 'tests', 'commands', 'dx');
  if (!existsSync(specsDir)) return { ok: true, count: 0, detail: '' };
  const specs = readdirSync(specsDir)
    .filter(name => name.endsWith('.layout.json'))
    .sort();
  if (!specs.length) return { ok: true, count: 0, detail: '' };

  const port = await freePort();
  const browser = new Browser(port, join(ws.dir, 'test-results', 'dx-gate'), log);
  const failures = [];
  try {
    await ws.startVite(port);
    await browser.open();
    for (const name of specs) {
      await browser.page.setViewportSize({ width: 1280, height: 800 });
      await browser.fresh();
      const spec = JSON.parse(readFileSync(join(specsDir, name), 'utf8'));
      const verdict = await browser.probe(spec);
      if (!verdict.pass) {
        const failed = verdict.results.filter(result => !result.ok)
          .map(result => `${result.label}: ${result.actual}`).join('; ');
        failures.push(`${name}: ${failed}`);
      }
    }
  } catch (error) {
    failures.push(`browser harness: ${error.message}`);
  } finally {
    await browser.close();
    await ws.stopVite();
  }
  return { ok: !failures.length, count: specs.length, detail: failures.join('\n') };
}

const patch = patchPath ? resolve(patchPath) : latestFixedPatch(taskId);
if (!patch || !existsSync(patch)) fail(`no fixed patch found for "${taskId}" (run the dx first, or pass --patch)`);
log(`[apply] patch: ${patch.replace(REPO + '/', '')}`);

const ws = new Workspace(REPO, join(HERE, 'apply-ws'), log);
(async () => {
  try {
    ws.create();
    try { ws.git('apply', '--3way', patch); } catch { ws.git('apply', patch); }
    log('[apply] patch applies cleanly to a fresh workspace');

    // ---- Quality gate ----
    log('[gate] vitest suite…');
    const suite = ws.vitest();
    if (!suite.ok) fail(`suite red:\n${suite.output.slice(-1000)}`);
    log('[gate] ✓ suite');
    log('[gate] browser layout oracle…');
    const layout = await browserLayoutGate(ws);
    if (!layout.ok) fail(`browser layout red:\n${layout.detail}`);
    log(`[gate] ✓ browser layout (${layout.count} spec${layout.count === 1 ? '' : 's'})`);
    log('[gate] typecheck…');
    const types = ws.typecheck();
    if (!types.ok) fail(`typecheck red:\n${types.output.slice(0, 1000)}`);
    log('[gate] ✓ typecheck');
    log('[gate] coverage (80% thresholds, slow)…');
    const cov = ws.coverage();
    if (!cov.ok) fail(`coverage below thresholds:\n${cov.output}`);
    log(`[gate] ✓ coverage\n${cov.output}`);
    log('\n✅ READY — all gates green.');

    if (!forReal) {
      log(`\n(dry-run) To land it: ensure "${taskId ?? '<id>'}" is in dx/tasks/APPROVALS.md, then re-run with --apply-for-real`);
      return;
    }
    if (!taskId) fail('--apply-for-real needs --task <id> (for the approval check + test relocation)');
    if (!force && !approved(taskId)) fail(`not approved — add "${taskId}" to dx/tasks/APPROVALS.md (or pass --force)`);

    // ---- Land in the real repo ----
    log('\n[land] applying to the real repo…');
    try { execFileSync('git', ['apply', '--3way', patch], { cwd: REPO }); }
    catch { execFileSync('git', ['apply', patch], { cwd: REPO }); }
    // Relocate the model's scratch test into the permanent regression corpus.
    const scratch = join(REPO, `tests/commands/dx/${taskId}.test.ts`);
    if (existsSync(scratch)) {
      execFileSync('git', ['add', '-A', 'tests/commands/dx'], { cwd: REPO });
      execFileSync('git', ['mv', '-f', `tests/commands/dx/${taskId}.test.ts`, `tests/commands/recorded/${taskId}.test.ts`], { cwd: REPO });
      log(`[land] moved test → tests/commands/recorded/${taskId}.test.ts`);
    }
    // Re-verify the real repo (fast gate; coverage already proven in the workspace).
    const realSuite = execFileSync('npx', ['vitest', 'run', '--reporter=dot'], { cwd: REPO, encoding: 'utf8' });
    log(realSuite.split('\n').slice(-2).join('\n'));
    execFileSync('npx', ['tsc', '--noEmit'], { cwd: REPO });
    log('\n✅ LANDED + real repo re-verified. Review `git diff`, then commit.');
  } finally {
    await ws.destroy();
  }
})();
