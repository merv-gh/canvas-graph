#!/usr/bin/env node
// apptool — app-aware tooling over the BOOTED frontend app + the code knowledge graph.
// Same capabilities the dx model gets; runnable by humans and by Claude.
//
//   node dx/cli/apptool.mjs events [filter]            # all bus events + who fires/handles
//   node dx/cli/apptool.mjs commands [filter]          # all commands + shortcuts/origins
//   node dx/cli/apptool.mjs flows <event>              # who fires/handles an event + downstream
//   node dx/cli/apptool.mjs scenario '<json>'          # run {steps,asserts} against a fresh boot
//   node dx/cli/apptool.mjs gen-test '<json>' [out]    # scenario json + title → vitest file
//   node dx/cli/apptool.mjs graph <find|callers|callees|file|tests> <query>
//
// scenario json shape:
//   { "steps": [ {"command":"editing.node.create"}, {"event":"fold.toggle","data":{"id":"shell.zen"}} ],
//     "asserts": [ {"path":"ui.shell.zen","op":"eq","value":true},
//                  {"css":".node","op":"count","value":2},
//                  {"file":"frontend/styles.css","matches":"grid-row:\\s*2"} ] }

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { genTest, runProbe } from '../ollama-runner/probe-client.mjs';
import { graphQuery } from '../ollama-runner/graphdb.mjs';
import { genPlugin } from './gen.mjs';
import { Tools } from '../ollama-runner/tools.mjs';
import { Browser } from '../ollama-runner/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DX_ROOT = resolve(HERE, '..');
const REPO = resolve(DX_ROOT, '..');
const [cmd, ...rest] = process.argv.slice(2);

const print = (x) => console.log(JSON.stringify(x, null, 1));
const parseSpec = (raw) => { try { return JSON.parse(raw); } catch (e) { console.error(`bad JSON: ${e.message}`); process.exit(2); } };

switch (cmd) {
  case 'events':
    print(runProbe(REPO, { mode: 'events', filter: rest[0] }));
    break;
  case 'commands':
    print(runProbe(REPO, { mode: 'commands', filter: rest[0] }));
    break;
  case 'flows':
    print(runProbe(REPO, { mode: 'flows', event: rest[0] }));
    break;
  case 'scenario': {
    const spec = parseSpec(rest[0] ?? '{}');
    print(runProbe(REPO, { mode: 'scenario', steps: spec.steps ?? [], asserts: spec.asserts ?? [] }));
    break;
  }
  case 'gen-test': {
    const spec = parseSpec(rest[0] ?? '{}');
    const validation = runProbe(REPO, { mode: 'scenario', steps: spec.steps ?? [], asserts: [] });
    if (validation.error || validation.steps?.some(s => !s.ok)) {
      console.error('steps do not execute cleanly:'); print(validation); process.exit(1);
    }
    const source = genTest({ title: spec.title ?? 'generated case', steps: spec.steps, asserts: spec.asserts ?? [] });
    if (rest[1]) { writeFileSync(rest[1], source); console.log(`wrote ${rest[1]}`); }
    else console.log(source);
    break;
  }
  case 'app-probe': {
    // Layout/focus/style oracle against a RUNNING dev server (npm run dev → :5174).
    // node dx/cli/apptool.mjs app-probe '<json>' [--port 5174]
    const portArg = rest.indexOf('--port');
    const port = portArg >= 0 ? Number(rest[portArg + 1]) : 5174;
    const spec = parseSpec(rest.find(a => a.trim().startsWith('{')) ?? '{}');
    const browser = new Browser(port, join(tmpdir(), 'dx-app-probe'), () => {});
    await browser.open()
      .then(() => browser.probe({ steps: spec.steps ?? [], asserts: spec.asserts ?? [] }))
      .then(print)
      .catch(err => { console.error(`app-probe failed (is the dev server on :${port}?): ${err.message}`); process.exitCode = 1; })
      .finally(() => browser.close());
    break;
  }
  case 'graph':
    print(graphQuery(REPO, rest[0], rest[1] ?? ''));
    break;
  case 'locate': {
    // Read-only anchor finder over the real repo (same impl the model uses).
    const ws = { dir: REPO, repoRoot: REPO, run: (c, a) => {
      try { return { ok: true, output: execFileSync(c, a, { cwd: REPO, encoding: 'utf8' }) }; }
      catch (e) { return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}` }; }
    } };
    void readFileSync; void join;
    console.log(new Tools({ ws, browser: null, log: () => {} }).tool_locate({ anchor: rest[0] ?? '', dir: rest[1] ?? 'frontend' }));
    break;
  }
  case 'gen': {
    const report = genPlugin({ kind: rest[0], name: rest[1], repoRoot: REPO });
    if (report.error) { console.error(`gen: ${report.error}\nusage: apptool gen <system|feature|ability> <name>`); process.exit(2); }
    console.log(`generated ${report.kind} '${report.name}'`);
    console.log(`  written: ${report.written.join(', ') || '-'}`);
    console.log(`  wired:   ${report.wired.join(', ') || '-'}`);
    console.log('  next:');
    report.nextSteps.forEach(s => console.log(`    - ${s}`));
    break;
  }
  default:
    console.log('usage: apptool <events|commands|flows|scenario|gen-test|graph|locate|gen|app-probe> …  (see file header)');
    console.log('       apptool gen <system|feature|ability> <name>   # scaffold a new plugin');
    console.log("       apptool app-probe '<json>' [--port 5174]      # layout/focus/style oracle (needs npm run dev)");
    process.exit(cmd ? 2 : 0);
}
