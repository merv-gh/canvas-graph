// Disposable workspace per attempt: rsync copy of the repo (sans node_modules),
// node_modules symlinked back, git-initialized for diffing, optional task setup
// script (re-introduces a fixed bug), and a vite dev server for the browser tools.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXCLUDES = ['node_modules', '.git', 'walker', 'test-results', 'coverage', 'explore-out', 'cases', '.claude', '.code-review-graph'];

export class Workspace {
  constructor(repoRoot, dir, log = () => {}) {
    this.repoRoot = resolve(repoRoot);
    this.dir = resolve(dir);
    this.log = log;
    this.vite = null;
  }

  create() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    const args = ['-a', ...EXCLUDES.flatMap(e => ['--exclude', e]), `${this.repoRoot}/`, `${this.dir}/`];
    execFileSync('rsync', args);
    symlinkSync(join(this.repoRoot, 'node_modules'), join(this.dir, 'node_modules'));
    mkdirSync(join(this.dir, 'tests/commands/walker'), { recursive: true });
    this.git('init', '-q');
    this.git('add', '-A');
    this.git('-c', 'user.email=walker@local', '-c', 'user.name=walker', 'commit', '-qm', 'base');
    this.log(`[ws] created ${this.dir}`);
  }

  git(...args) {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8' });
  }

  diff() {
    this.git('add', '-A');
    return this.git('-c', 'user.email=walker@local', '-c', 'user.name=walker', 'diff', '--cached');
  }

  async applySetup(setupName) {
    if (!setupName) return;
    const mod = await import(join(this.repoRoot, 'walker/setup', `${setupName}.mjs`));
    await mod.setup(this.dir);
    this.git('add', '-A');
    this.git('-c', 'user.email=walker@local', '-c', 'user.name=walker', 'commit', '-qm', `setup: ${setupName}`);
    this.log(`[ws] setup applied: ${setupName}`);
  }

  /** Run a command in the workspace; never throws — returns {ok, output}. */
  run(cmd, args, timeoutMs = 240000) {
    try {
      const output = execFileSync(cmd, args, { cwd: this.dir, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
      return { ok: true, output };
    } catch (err) {
      return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() || String(err.message) };
    }
  }

  vitest(path) {
    const args = ['vitest', 'run', '--reporter=dot', ...(path ? [path] : [])];
    const res = this.run('npx', args);
    // "ran" = vitest actually executed tests (vs crashing at startup on a
    // broken test file / bad config). Gates must not confuse a crash with red.
    res.ran = /Test Files|No test files found/.test(res.output);
    // "testsRan" = at least one test body executed. A suite that fails with
    // "Tests  no tests" died on import/syntax — that is a crash, not a red test.
    res.testsRan = res.ran && !/Tests\s+no tests/.test(res.output);
    return res;
  }

  typecheck() {
    return this.run('npx', ['tsc', '--noEmit']);
  }

  async startVite(port) {
    await this.stopVite();
    this.vite = spawn('npx', ['vite', 'v2', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: this.dir, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    });
    let out = '';
    this.vite.stdout.on('data', d => { out += d; });
    this.vite.stderr.on('data', d => { out += d; });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) { this.log(`[ws] vite up :${port}`); return; }
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`vite failed to start on :${port}\n${out.slice(-800)}`);
  }

  async stopVite() {
    if (!this.vite) return;
    this.vite.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 300));
    if (!this.vite.killed) this.vite.kill('SIGKILL');
    this.vite = null;
  }

  saveArtifact(relPath, content) {
    const p = join(this.dir, relPath);
    mkdirSync(resolve(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }

  async destroy() {
    await this.stopVite();
    if (existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true });
  }
}
