#!/usr/bin/env node
// Development launcher: live projection watcher + Vite app server.

import { spawn } from 'node:child_process';

const children = new Set();

function start(label, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (stopping) return;
    if (code === 0 || signal) return;
    console.error(`[dev] ${label} exited with ${code ?? signal}`);
    stop(code ?? 1);
  });
  return child;
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

start('projections', process.execPath, ['dx/projections/projections.mjs', 'watch']);
start('vite', 'npx', ['vite', 'frontend', '--host', '127.0.0.1', '--port', '5174', '--strictPort']);
