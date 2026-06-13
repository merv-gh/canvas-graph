#!/usr/bin/env node
// apptool — app-aware tooling over the BOOTED v2 app + the code knowledge graph.
// Same capabilities the walker model gets; runnable by humans and by Claude.
//
//   node walker/apptool.mjs events [filter]            # all bus events + who fires/handles
//   node walker/apptool.mjs commands [filter]          # all commands + shortcuts/origins
//   node walker/apptool.mjs flows <event>              # who fires/handles an event + downstream
//   node walker/apptool.mjs scenario '<json>'          # run {steps,asserts} against a fresh boot
//   node walker/apptool.mjs gen-test '<json>' [out]    # scenario json + title → vitest file
//   node walker/apptool.mjs graph <find|callers|callees|file|tests> <query>
//
// scenario json shape:
//   { "steps": [ {"command":"editing.node.create"}, {"event":"fold.toggle","data":{"id":"shell.zen"}} ],
//     "asserts": [ {"path":"ui.shell.zen","op":"eq","value":true},
//                  {"css":".node","op":"count","value":2},
//                  {"file":"v2/styles.css","matches":"grid-row:\\s*2"} ] }

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genTest, runProbe } from './probe-client.mjs';
import { graphQuery } from './graphdb.mjs';
import { Tools } from './tools.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
    console.log(new Tools({ ws, browser: null, log: () => {} }).tool_locate({ anchor: rest[0] ?? '', dir: rest[1] ?? 'v2' }));
    break;
  }
  default:
    console.log('usage: apptool <events|commands|flows|scenario|gen-test|graph|locate> …  (see file header)');
    process.exit(cmd ? 2 : 0);
}
