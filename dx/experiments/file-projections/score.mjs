#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE, manifestFor, runCheck, runDir, writeJson } from './shared.mjs';

const run = cleanRun(process.argv[2]);
const worktree = manifestFor(run).worktrees.automation.path;
const out = runDir(run, 'score');
const checks = [];

checks.push(runCheck(
  'focused',
  'npx',
  ['vitest', 'run', 'tests/commands/automation-backend.test.ts', 'tests/commands/automation.test.ts'],
  worktree,
  out,
  120_000,
));
checks.push(runCheck('typecheck', 'npm', ['run', 'typecheck'], worktree, out, 120_000));

let full = runCheck('full-vitest', 'npx', ['vitest', 'run'], worktree, out, 240_000);
if (!full.passed && /LCP: boot stays inside|tests\/commands\/performance\.test\.ts/.test(full.output)) {
  const retry = runCheck('full-vitest-retry', 'npx', ['vitest', 'run'], worktree, out, 240_000);
  full = { ...retry, name: 'full-vitest', attempts: 2 };
  if (!full.passed && /LCP: boot stays inside|tests\/commands\/performance\.test\.ts/.test(full.output)) {
    const isolated = runCheck('performance-isolated', 'npx', ['vitest', 'run', 'tests/commands/performance.test.ts'], worktree, out, 120_000);
    if (isolated.passed && /1 failed/.test(full.output)) {
      full = { ...full, passed: true, accepted_via: 'all functional tests plus isolated performance gate' };
    }
  }
}
checks.push(full);

const hidden = [
  ['acceptance-ui', 'automation-ui.acceptance.test.ts', '.fp-automation-ui.acceptance.test.ts'],
  ['acceptance-backend', 'automation-backend.acceptance.test.ts', '.fp-automation-backend.acceptance.test.ts'],
];
for (const [name, fixture, targetName] of hidden) {
  const target = join(worktree, 'tests', 'commands', targetName);
  copyFileSync(join(HERE, 'acceptance', fixture), target);
  try {
    checks.push(runCheck(name, 'npx', ['vitest', 'run', `tests/commands/${targetName}`], worktree, out, 120_000));
  } finally {
    unlinkSync(target);
  }
}

const backendPath = join(worktree, 'backend', 'automation.ts');
const frontendPath = join(worktree, 'frontend', 'systems', 'automation.ts');
const backend = existsSync(backendPath) ? readFileSync(backendPath, 'utf8') : '';
const frontend = existsSync(frontendPath) ? readFileSync(frontendPath, 'utf8') : '';
const index = readFileSync(join(worktree, 'frontend', 'systems', 'index.ts'), 'utf8');
const css = readFileSync(join(worktree, 'frontend', 'styles.css'), 'utf8');
const tsconfig = readFileSync(join(worktree, 'tsconfig.json'), 'utf8');
const staticChecks = {
  backend_exists: Boolean(backend),
  backend_dom_free: Boolean(backend) && !/\b(document|window|HTMLElement)\b/.test(backend) && !/from ['"]\.\.\/frontend/.test(backend),
  backend_api: ['AutomationBackend', 'createAutomationBackend', 'executeAutomation'].every(name => backend.includes(name)),
  frontend_uses_backend: frontend.includes("from '../../backend/automation'") && frontend.includes('backend.execute'),
  registered: index.includes("from './automation'") && index.includes('registerAutomation(system)'),
  commands: ['automation.example.create', 'automation.run', 'automation.reset', 'automation.inspector.open'].every(command => frontend.includes(command)),
  persistence_ui: frontend.includes('registerSnapshotExtension') && frontend.includes('automation-inspector') && css.includes('automation-status-success'),
  backend_typechecked: /backend\/\*\*\/\*\.ts/.test(tsconfig),
};

const passed = name => checks.find(check => check.name === name)?.passed;
let score = 0;
if (passed('acceptance-ui')) score += 25;
if (passed('acceptance-backend')) score += 20;
if (passed('focused')) score += 10;
if (passed('typecheck')) score += 15;
if (passed('full-vitest')) score += 15;
if (staticChecks.backend_exists && staticChecks.backend_dom_free && staticChecks.backend_api) score += 6;
if (staticChecks.frontend_uses_backend && staticChecks.registered) score += 4;
if (staticChecks.commands && staticChecks.persistence_ui) score += 3;
if (staticChecks.backend_typechecked) score += 2;

const result = {
  schema_version: 1,
  run,
  worktree,
  score,
  max_score: 100,
  checks: checks.map(({ output, ...check }) => check),
  static: staticChecks,
};
writeJson(join(out, 'score.json'), result);
console.log(JSON.stringify(result, null, 2));
