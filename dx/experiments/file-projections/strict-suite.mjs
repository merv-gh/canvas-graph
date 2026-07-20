#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE } from './shared.mjs';

const run = cleanRun(process.argv[2] || `strict-${Date.now()}`);
const base = process.argv[3] || 'HEAD';
for (const [script, ...args] of [
  ['strict-prepare.mjs', run, base],
  ['strict-concepts.mjs', run],
  ['strict-package.mjs', run],
  ['strict-implement.mjs', run],
  ['strict-score.mjs', run],
  ['strict-report.mjs', run],
]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: HERE, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

const score = JSON.parse(readFileSync(join(HERE, 'runs', run, 'strict-score', 'score.json'), 'utf8'));
if (!score.strict_gate) {
  console.error(`strict experiment ${run} failed its 99%/acceptance gate; report preserved`);
  process.exit(2);
}
