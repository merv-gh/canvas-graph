#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE, runFp, writeJson } from './shared.mjs';

const run = cleanRun(process.argv[2] || `reference-${Date.now()}`);
const base = process.argv[3] || 'HEAD';
const runScript = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: HERE, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
};

runScript('strict-prepare.mjs', [run, base]);
const root = join(HERE, 'runs', run);
const manifest = JSON.parse(readFileSync(join(root, 'strict-worktree.json'), 'utf8'));
const worktree = manifest.worktree.path;
const recipe = join(HERE, 'recipes', 'automation-workflows.change.json');
const planPath = '.projections/reference.plan.json';
const applyPath = '.projections/reference.apply.json';
const planned = runFp(['change', 'plan', '-change', recipe, '-out', planPath], worktree, 120_000);
const applied = planned.exit_code === 0
  ? runFp(['change', 'apply', '-plan', planPath, '-out', applyPath], worktree, 180_000)
  : { exit_code: null, output: 'apply skipped because planning failed' };
const native = {
  schema_version: 1,
  provenance: 'maintainer-authored feasibility control; never score as model efficiency',
  run,
  worktree,
  recipe,
  plan: { command: planned.command, exit_code: planned.exit_code, output: planned.output },
  apply: { command: applied.command, exit_code: applied.exit_code, output: applied.output },
};
writeJson(join(root, 'reference-native.json'), native);
if (planned.exit_code !== 0 || applied.exit_code !== 0) {
  console.error(JSON.stringify(native, null, 2));
  process.exit(1);
}

runScript('strict-score.mjs', [run]);
const score = JSON.parse(readFileSync(join(root, 'strict-score', 'score.json'), 'utf8'));
const coverage = score.coverage;
const report = `# Reference feasibility control: ${run}\n\n` +
  `Provenance: maintainer-authored recipe replay; no model efficiency claim.\n\n` +
  `- Native plan/apply: PASS\n` +
  `- Strict gate: ${score.strict_gate ? 'PASS' : 'FAIL'}\n` +
  `- Coverage S/B/F/L: ${coverage?.statements?.pct ?? 0}/${coverage?.branches?.pct ?? 0}/${coverage?.functions?.pct ?? 0}/${coverage?.lines?.pct ?? 0}\n` +
  score.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.name}`).join('\n') + '\n';
writeFileSync(join(root, 'REFERENCE-REPORT.md'), report);
console.log(report);
if (!score.strict_gate) process.exit(2);
