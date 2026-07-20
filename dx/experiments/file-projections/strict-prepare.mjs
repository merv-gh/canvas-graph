#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanRun, FP_BIN, HERE, REPO, writeJson } from './shared.mjs';

const run = cleanRun(process.argv[2] || `strict-${Date.now()}`);
const base = process.argv[3] || 'HEAD';
const root = resolve(REPO, '../.worktrees', `ecs-canvas-graph-${run}`);
const path = join(root, 'concept-only');
const branch = `codex/fp-${run}-concept-only`;
mkdirSync(root, { recursive: true });

const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const branches = new Set(git(['branch', '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean));
if (!existsSync(path)) {
  if (branches.has(branch)) git(['worktree', 'add', path, branch]);
  else git(['worktree', 'add', '-b', branch, path, base]);
}
if (!existsSync(join(path, 'package.json'))) throw new Error(`invalid worktree: ${path}`);
writeFileSync(join(path, 'EVAL_TASK.md'), readFileSync(join(HERE, 'task.md'), 'utf8'));
const modules = join(path, 'node_modules');
if (!existsSync(modules) && existsSync(join(REPO, 'node_modules'))) symlinkSync(join(REPO, 'node_modules'), modules, 'dir');

const out = join(HERE, 'runs', run);
mkdirSync(out, { recursive: true });
const manifest = {
  schema_version: 1,
  protocol: 'cold-concept-only-v1',
  run,
  base,
  fp_bin: FP_BIN,
  created_at: new Date().toISOString(),
  worktree: { path, branch },
  leakage_controls: {
    authored_context: false,
    authored_concepts: false,
    authored_change_plan: false,
    reference_files_available: false,
    concept_author_source_writes: false,
  },
};
writeJson(join(out, 'strict-worktree.json'), manifest);
console.log(JSON.stringify(manifest, null, 2));
