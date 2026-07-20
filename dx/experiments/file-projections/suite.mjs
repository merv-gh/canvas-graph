#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cleanRun, HERE } from './shared.mjs';

const run = cleanRun(process.argv[2] || `file-projections-${Date.now()}`);
const base = process.argv[3] || 'HEAD';
const steps = [
  ['prepare.mjs', run, base],
  ['discoverability.mjs', run],
  ['automation.mjs', run],
  ['score.mjs', run],
  ['report.mjs', run],
];

for (const [script, ...args] of steps) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: HERE,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
