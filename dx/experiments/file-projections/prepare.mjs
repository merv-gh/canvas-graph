#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanRun, FP_BIN, HERE, REPO, runFp, writeJson } from './shared.mjs';

const run = cleanRun(process.argv[2] || `file-projections-${Date.now()}`);
const base = process.argv[3] || 'HEAD';
const root = resolve(REPO, '../.worktrees', `ecs-canvas-graph-${run}`);
const arms = ['discoverability', 'automation'];
const manifest = { schema_version: 1, run, base, fp_bin: FP_BIN, created_at: new Date().toISOString(), worktrees: {} };

mkdirSync(root, { recursive: true });
const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const branches = new Set(git(['branch', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean));

for (const arm of arms) {
  const path = join(root, arm);
  const branch = `codex/fp-${run}-${arm}`;
  if (!existsSync(path)) {
    if (branches.has(branch)) git(['worktree', 'add', path, branch]);
    else {
      git(['worktree', 'add', '-b', branch, path, base]);
      branches.add(branch);
    }
  }
  if (!existsSync(join(path, 'package.json'))) throw new Error(`invalid worktree: ${path}`);
  writeFileSync(join(path, 'EVAL_TASK.md'), readFileSync(join(HERE, 'task.md'), 'utf8'));
  const modules = join(path, 'node_modules');
  if (!existsSync(modules) && existsSync(join(REPO, 'node_modules'))) symlinkSync(join(REPO, 'node_modules'), modules, 'dir');

  if (arm === 'automation') {
    writeFileSync(join(path, 'EVAL_RECIPE.change.json'), readFileSync(join(HERE, 'recipes', 'automation-workflows.change.json'), 'utf8'));
    mkdirSync(join(path, 'concepts'), { recursive: true });
    writeFileSync(join(path, 'concepts', 'automation-workflows.yaml'), readFileSync(join(REPO, 'concepts', 'automation-workflows.yaml'), 'utf8'));
    const indexed = runFp(['architecture', '-root', 'frontend'], path);
    if (indexed.exit_code !== 0) throw new Error(`failed to index automation concept: ${indexed.output}`);
  }
  manifest.worktrees[arm] = { path, branch };
}

const out = join(HERE, 'runs', run);
mkdirSync(out, { recursive: true });
writeJson(join(out, 'worktrees.json'), manifest);
console.log(JSON.stringify(manifest, null, 2));
