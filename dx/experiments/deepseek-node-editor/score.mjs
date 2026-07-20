#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARM = process.argv[2];
const WORKTREE = resolve(process.argv[3] || '');
const RUN = process.argv[4] || 'trial-1';
if (!ARM || !process.argv[3]) {
  console.error('usage: node score.mjs ARM WORKTREE [run-name]');
  process.exit(2);
}
const OUT = join(HERE, 'runs', RUN, ARM);
mkdirSync(OUT, { recursive: true });

function run(name, command, args, timeout = 180_000) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: WORKTREE,
    encoding: 'utf8',
    timeout,
    maxBuffer: 12_000_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const record = {
    name,
    command: [command, ...args].join(' '),
    exit_code: result.status,
    signal: result.signal,
    wall_ms: Date.now() - started,
    passed: result.status === 0,
    output: `${result.stdout || ''}\n${result.stderr || ''}`.slice(-30000),
  };
  writeFileSync(join(OUT, `${name}.log`), record.output);
  return record;
}

const checks = [];
checks.push(existsSync(join(WORKTREE, 'tests/commands/automation.test.ts'))
  ? run('model-test', 'npx', ['vitest', 'run', 'tests/commands/automation.test.ts'])
  : { name: 'model-test', passed: false, exit_code: null, wall_ms: 0, output: 'missing test' });
checks.push(run('typecheck', 'npm', ['run', 'typecheck']));
let full = run('full-vitest', 'npx', ['vitest', 'run']);
if (!full.passed && /LCP: boot stays inside|tests\/commands\/performance\.test\.ts/.test(full.output)) {
  const retry = run('full-vitest-retry', 'npx', ['vitest', 'run']);
  full = { ...retry, name: 'full-vitest', command: 'npx vitest run (isolated timing retry)', attempts: 2 };
  if (!full.passed && /1 failed.*46 passed|46 passed.*1 failed/s.test(full.output)
    && /LCP: boot stays inside|tests\/commands\/performance\.test\.ts/.test(full.output)) {
    const isolated = run('performance-isolated', 'npx', ['vitest', 'run', 'tests/commands/performance.test.ts']);
    if (isolated.passed) full = {
      ...full,
      passed: true,
      accepted_via: 'all non-performance tests passed; documented performance gate passed in isolated suite',
      isolated_wall_ms: isolated.wall_ms,
    };
  }
}
checks.push(full);

const hiddenPath = join(WORKTREE, 'tests/commands/.automation-acceptance.eval.test.ts');
copyFileSync(join(HERE, 'automation.acceptance.test.ts'), hiddenPath);
try {
  checks.push(run('acceptance', 'npx', ['vitest', 'run', 'tests/commands/.automation-acceptance.eval.test.ts']));
} finally {
  unlinkSync(hiddenPath);
}

const systemPath = join(WORKTREE, 'frontend/systems/automation.ts');
const system = existsSync(systemPath) ? readFileSync(systemPath, 'utf8') : '';
const index = readFileSync(join(WORKTREE, 'frontend/systems/index.ts'), 'utf8');
const css = readFileSync(join(WORKTREE, 'frontend/styles.css'), 'utf8');
const requiredCommands = ['automation.example.create', 'automation.run', 'automation.reset', 'automation.inspector.open'];
const staticChecks = {
  system_file: Boolean(system),
  registered: index.includes('registerAutomation(system)') && index.includes("from './automation'"),
  commands: requiredCommands.filter(command => system.includes(command)),
  snapshot_extension: system.includes('registerSnapshotExtension') && system.includes('automation'),
  custom_registry: system.includes('registerType') && system.includes('configure'),
  ui: system.includes('automation-inspector') && system.includes('automation-status'),
  css: css.includes('automation-status'),
};

const pass = name => checks.find(check => check.name === name)?.passed;
let score = 0;
if (pass('acceptance')) score += 45;
if (pass('model-test')) score += 10;
if (pass('typecheck')) score += 15;
if (pass('full-vitest')) score += 15;
if (staticChecks.system_file && staticChecks.registered) score += 4;
if (staticChecks.commands.length === requiredCommands.length) score += 2;
if (staticChecks.snapshot_extension && staticChecks.custom_registry) score += 2;
if (staticChecks.ui && staticChecks.css) score += 2;
if (system && !system.includes('document.querySelector')) score += 5;

const result = {
  schema_version: 1,
  arm: ARM,
  run: RUN,
  worktree: WORKTREE,
  score,
  max_score: 100,
  checks: checks.map(({ output, ...check }) => check),
  static: staticChecks,
};
writeFileSync(join(OUT, 'score.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
