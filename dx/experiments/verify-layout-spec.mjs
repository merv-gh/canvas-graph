#!/usr/bin/env node
// Run one generated .layout.json against a disposable copy of the current app.
// Useful for proving candidate tests are RED before any builder receives them.

import { createServer } from 'node:net';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser } from '../ollama-runner/browser.mjs';
import { Workspace } from '../ollama-runner/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const specPath = argv.find(arg => !arg.startsWith('--') && !['red', 'green'].includes(arg));
const expected = opt('expect', 'red');
const resultPath = opt('result', null);

if (!specPath || !['red', 'green'].includes(expected)) {
  console.error('usage: verify-layout-spec.mjs <spec.layout.json> [--expect red|green] [--result result.json]');
  process.exit(2);
}

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(error => error ? reject(error) : resolvePort(port));
  });
});

const atomicJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};

const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));
const ws = new Workspace(REPO, resolve(HERE, 'verify-layout-ws'), line => console.log(line));
let browser;
let record;
try {
  ws.create();
  const port = await freePort();
  await ws.startVite(port);
  browser = new Browser(port, resolve(HERE, 'verify-layout-shots'));
  await browser.open();
  const verdict = await browser.probe(spec);
  const matchedExpectation = expected === 'green' ? verdict.pass : !verdict.pass;
  record = {
    schema: 'recursive-mas/layout-candidate-verification-v2',
    spec: resolve(specPath),
    expected,
    observed: verdict.pass ? 'green' : 'red',
    matchedExpectation,
    results: verdict.results,
  };
  if (resultPath) atomicJson(resolve(resultPath), record);
  console.log(JSON.stringify(record, null, 2));
  if (!matchedExpectation) process.exitCode = 1;
} finally {
  await browser?.close();
  await ws.destroy();
}
