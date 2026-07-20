#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE, runCheck, runDir, writeJson } from './shared.mjs';

const run = cleanRun(process.argv[2]);
const manifestPath = join(HERE, 'runs', run, 'strict-worktree.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const worktree = process.env.STRICT_WORKTREE || manifest?.worktree?.path;
if (!worktree) throw new Error('strict worktree unavailable; prepare the run or set STRICT_WORKTREE');
const out = runDir(run, 'strict-score');
const checks = [];
const testFiles = [
  'tests/commands/automation-backend.test.ts',
  'tests/commands/automation.test.ts',
  'tests/commands/automation-canvas.test.ts',
].filter(path => existsSync(join(worktree, path)));

checks.push(testFiles.length
  ? runCheck('focused', 'npx', ['vitest', 'run', ...testFiles], worktree, out, 120_000)
  : runCheck('focused', process.execPath, ['-e', "console.error('no automation tests authored');process.exit(1)"], worktree, out, 10_000));
checks.push(runCheck('typecheck', 'npm', ['run', 'typecheck'], worktree, out, 120_000));
let full = runCheck('full-vitest', 'npx', ['vitest', 'run'], worktree, out, 240_000);
if (!full.passed && /LCP: boot stays inside|tests\/commands\/performance\.test\.ts/.test(full.output)) {
  const isolated = runCheck('performance-isolated', 'npx', ['vitest', 'run', 'tests/commands/performance.test.ts'], worktree, out, 120_000);
  checks.push(isolated);
  if (isolated.passed && /1 failed/.test(full.output)) {
    full = { ...full, passed: true, accepted_via: 'all functional tests plus isolated existing performance gate' };
  }
}
checks.push(full);
checks.push(runCheck('coverage', 'npx', [
  'vitest', 'run', ...testFiles,
  '--coverage', '--coverage.include=backend/automation.ts', '--coverage.include=frontend/systems/automation.ts',
  '--coverage.reporter=text', '--coverage.reporter=json-summary', '--coverage.reportsDirectory=coverage/strict-automation',
], worktree, out, 180_000));

for (const [name, fixture, targetName] of [
  ['acceptance-ui', 'automation-ui.acceptance.test.ts', '.fp-automation-ui.acceptance.test.ts'],
  ['acceptance-backend', 'automation-backend.acceptance.test.ts', '.fp-automation-backend.acceptance.test.ts'],
]) {
  const target = join(worktree, 'tests', 'commands', targetName);
  copyFileSync(join(HERE, 'acceptance', fixture), target);
  try {
    checks.push(runCheck(name, 'npx', ['vitest', 'run', `tests/commands/${targetName}`], worktree, out, 120_000));
  } finally {
    unlinkSync(target);
  }
}

const coveragePath = join(worktree, 'coverage', 'strict-automation', 'coverage-summary.json');
const coverage = existsSync(coveragePath) ? JSON.parse(readFileSync(coveragePath, 'utf8')).total : null;
const percentages = coverage ? ['statements', 'branches', 'functions', 'lines'].map(key => coverage[key]?.pct ?? 0) : [];
const coverageCheck = checks.find(check => check.name === 'coverage');
if (coverageCheck) {
  coverageCheck.process_passed = coverageCheck.passed;
  coverageCheck.passed = coverageCheck.passed && percentages.length === 4 && percentages.every(value => value >= 99);
}
const passed = name => checks.some(check => check.name === name && check.passed);
const strictGate = ['focused', 'typecheck', 'full-vitest', 'coverage', 'acceptance-ui', 'acceptance-backend'].every(passed)
  && percentages.length === 4
  && percentages.every(value => value >= 99);
const result = {
  schema_version: 1,
  protocol: 'concept-scoped-editing-99-v1',
  run,
  worktree,
  strict_gate: strictGate,
  coverage,
  checks: checks.map(({ output, ...check }) => check),
};
writeJson(join(out, 'score.json'), result);
console.log(JSON.stringify(result, null, 2));
