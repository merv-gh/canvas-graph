import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const DEFAULT_BUDGET_MS = 10_000;
const DEV_LANES = ['test:commands', 'test:browser'];

const npmCommand = script => process.env.npm_execpath
  ? [process.execPath, [process.env.npm_execpath, 'run', script]]
  : ['npm', ['run', script]];

const runLane = script => new Promise(resolve => {
  const [command, args] = npmCommand(script);
  const child = spawn(command, args, { env: process.env, stdio: 'inherit' });
  child.once('exit', code => resolve({ code: code ?? 1, script }));
  child.once('error', () => resolve({ code: 1, script }));
});

const budgetMs = Number(
  process.env.DEVELOPMENT_TEST_BUDGET_MS ?? process.env.DEV_TEST_BUDGET_MS ?? DEFAULT_BUDGET_MS,
);
const startedAt = performance.now();
const results = await Promise.all(DEV_LANES.map(runLane));
const elapsedMs = performance.now() - startedAt;
const failed = results.filter(result => result.code !== 0);

console.log(`development tests: ${(elapsedMs / 1_000).toFixed(2)}s / ${(budgetMs / 1_000).toFixed(2)}s`);
if (failed.length) {
  console.error(`failed lanes: ${failed.map(result => result.script).join(', ')}`);
  process.exitCode = 1;
} else if (elapsedMs > budgetMs) {
  console.error(`dev test budget exceeded by ${((elapsedMs - budgetMs) / 1_000).toFixed(2)}s`);
  process.exitCode = 1;
}
