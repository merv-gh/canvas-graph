#!/usr/bin/env node
// preview — serve a workspace (optionally with a fix applied) and print a URL
// that autoplays a scenario, so a human can WATCH the fix with their eyes.
//
//   node walker/preview.mjs --task choose-invert-shortcut --apply <fix.patch>
//   node walker/preview.mjs --task choose-invert-shortcut          # current tree
//   node walker/preview.mjs --scenario 'A;A;i' --port 5191         # ad-hoc
//
// The server stays up until Ctrl+C (then the workspace is destroyed). The fix is
// NOT applied to the real repo — preview runs in a disposable copy.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from './workspace.mjs';
import { runProbe } from './probe-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const taskId = opt('task', null);
const applyPatch = opt('apply', null);
const port = Number(opt('port', 5190));
let scenario = opt('scenario', null);

/** Map command ids → player keystroke tokens via the booted command registry
 *  (each command's display `shortcut`). Lets a demo be written as command ids. */
function encodeCommands(wsDir, ids) {
  const answer = runProbe(wsDir, { mode: 'commands' });
  const byId = new Map((answer.commands ?? []).map(c => [c.id, c.shortcut]));
  return ids.map(id => byId.get(id)).filter(Boolean).join(';');
}

function taskDemo(id) {
  const md = readFileSync(join(HERE, 'TASKS.md'), 'utf8');
  const block = md.split(/^## /m).slice(1).find(b => b.split('\n')[0].trim() === id);
  if (!block) return null;
  const m = block.match(/^- demo:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

const ws = new Workspace(REPO, join(HERE, 'preview-ws'), (l) => console.log(l));
let stopping = false;
const shutdown = async () => { if (stopping) return; stopping = true; console.log('\n[preview] shutting down…'); await ws.destroy(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  ws.create();
  if (applyPatch) {
    const patch = resolve(applyPatch);
    if (!existsSync(patch)) { console.error(`patch not found: ${patch}`); await shutdown(); }
    try { ws.git('apply', '--3way', patch); console.log(`[preview] applied ${applyPatch}`); }
    catch { try { ws.git('apply', patch); console.log(`[preview] applied ${applyPatch}`); } catch (e) { console.error(`[preview] git apply failed: ${e.message}`); } }
  }
  if (!scenario && taskId) scenario = taskDemo(taskId);
  if (!scenario && taskId) {
    // Fall back: 2 nodes + the task's command shortcut if it now has one.
    const guessId = taskId.startsWith('choose') ? 'choose.invert'
      : taskId.startsWith('detail') ? 'detail.more'
      : taskId.includes('reverse') ? 'graph.edge.reverse'
      : taskId.includes('duplicate') ? 'editing.node.duplicate' : null;
    const tail = guessId ? encodeCommands(ws.dir, [guessId]) : '';
    scenario = ['A', 'A', tail].filter(Boolean).join(';');
  }
  scenario = scenario || 'A;A;A;Z';

  await ws.startVite(port);
  const url = `http://127.0.0.1:${port}/?io=memory&scenario=${encodeURIComponent(scenario)}`;
  console.log('\n────────────────────────────────────────────────────');
  console.log(`  ▶  OPEN TO WATCH THE FIX:`);
  console.log(`     ${url}`);
  console.log(`     scenario: ${scenario}`);
  console.log(`  (Ctrl+C to stop and clean up the workspace)`);
  console.log('────────────────────────────────────────────────────\n');
  // Keep alive; the vite child keeps the event loop busy, but guard anyway.
  setInterval(() => {}, 1 << 30);
})();
