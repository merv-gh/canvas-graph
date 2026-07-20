#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const run = (process.argv[2] || 'trial-1').replace(/[^a-zA-Z0-9._-]/g, '-');
const base = process.argv[3] || 'HEAD';
const worktreesRoot = resolve(REPO, '../.worktrees', `ecs-canvas-graph-${run}`);
const task = readFileSync(join(HERE, 'task.md'), 'utf8');
const context = readFileSync(join(HERE, 'context.md'), 'utf8');
const projection = readFileSync(join(HERE, 'projections', 'automation-system.projection.md'), 'utf8');
const defaultArms = ['baseline', 'context', 'code-review-graph', 'file-projections', 'file-projections-optimized', 'file-projections-prefetched', 'file-projections-guided', 'file-projections-recipe', 'reference'];
const requestedArms = process.argv.slice(4);
const arms = requestedArms.length ? requestedArms : defaultArms;
if (arms.some(arm => !defaultArms.includes(arm))) throw new Error(`unknown arm: ${arms.find(arm => !defaultArms.includes(arm))}`);
const manifest = { schema_version: 1, run, base, created_at: new Date().toISOString(), worktrees: {} };

mkdirSync(worktreesRoot, { recursive: true });

const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const branches = new Set(git(['branch', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean));

for (const arm of arms) {
  const path = join(worktreesRoot, arm);
  const branch = `codex/n8n-${run}-${arm}`;
  if (!existsSync(path)) {
    if (branches.has(branch)) git(['worktree', 'add', path, branch]);
    else {
      git(['worktree', 'add', '-b', branch, path, base]);
      branches.add(branch);
    }
  }
  if (!existsSync(join(path, 'package.json'))) throw new Error(`invalid worktree: ${path}`);

  writeFileSync(join(path, 'EVAL_TASK.md'), task);
  if (arm === 'context') writeFileSync(join(path, 'context.md'), context);
  if (arm === 'file-projections' || arm === 'file-projections-optimized' || arm === 'file-projections-prefetched' || arm === 'file-projections-guided' || arm === 'file-projections-recipe') {
    mkdirSync(join(path, '.projections'), { recursive: true });
    writeFileSync(join(path, '.projections', 'automation-system.projection.md'), projection);
  }
  const nodeModules = join(path, 'node_modules');
  if (!existsSync(nodeModules) && existsSync(join(REPO, 'node_modules'))) symlinkSync(join(REPO, 'node_modules'), nodeModules, 'dir');
  const graph = join(path, '.code-review-graph');
  if (arm === 'code-review-graph' && !existsSync(graph) && existsSync(join(REPO, '.code-review-graph'))) {
    symlinkSync(join(REPO, '.code-review-graph'), graph, 'dir');
  }
  manifest.worktrees[arm] = { path, branch };
}

const manifestPath = join(HERE, 'runs', run, 'worktrees.json');
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
