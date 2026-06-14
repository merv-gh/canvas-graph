#!/usr/bin/env node
// CLI for editable feature projections.

import { existsSync, readFileSync, watch } from 'node:fs';
import { projections, selectProjection } from './registry.mjs';
import { rel } from './shared.mjs';
import { renderConcept } from './concepts/concept.mjs';

const argv = process.argv.slice(2);

function projectionStatus(def) {
  const outExists = existsSync(def.outFile);
  const stale = !outExists || readFileSync(def.outFile, 'utf8') !== def.render();
  const out = outExists ? rel(def.outFile) : `${rel(def.outFile)} (missing)`;
  console.log(`${def.name}: ${out}; ${def.count()} slices; ${stale ? 'stale' : 'fresh'}`);
}

function printList() {
  for (const def of projections.values()) {
    console.log(`${def.name.padEnd(10)} ${rel(def.outFile)}  ${def.description}`);
  }
}

function filterProjectionText(text, filter) {
  const needle = String(filter ?? '').trim().toLowerCase();
  if (!needle) return text;
  const chunks = text.includes('\n// BEGIN ')
    ? text.split(/\n(?=\/\/ BEGIN )/)
    : /\nexport const \w+/.test(text)
      ? text.split(/\n(?=  (?:\/\/|\{))/)
      : /\ninterface \w+\s*\{/.test(text)
        ? text.split(/\n(?=\s*(?:\/\/ ──|['"]))/)
        : text.split(/\n(?=## )/);
  const header = chunks.shift() ?? '';
  const hits = chunks.filter(chunk => chunk.toLowerCase().includes(needle));
  if (hits.length) return [header.trimEnd(), ...hits.map(hit => hit.trimEnd())].join('\n\n') + '\n';
  const lines = text.split('\n').filter(line => line.toLowerCase().includes(needle));
  return lines.length ? lines.join('\n') + '\n' : `no projection matches for: ${filter}\n`;
}

function showProjection(def, filter) {
  console.log(filterProjectionText(def.render(), filter).trimEnd());
}

function watchProjections(defs) {
  for (const def of defs) def.generate({ quiet: true });
  console.log(`serving projections: ${defs.map(def => `${def.name}=${rel(def.outFile)}`).join(', ')}`);
  console.log('edit a projection to sync back; edit sources to regenerate; Ctrl+C stops');

  let busy = false;
  let timer = null;
  let ignoreProjectionUntil = Date.now() + 500;

  const byFile = new Map();
  const addWatch = (file, def, kind) => {
    const key = file;
    if (!byFile.has(key)) byFile.set(key, { file, projectionDefs: new Set(), sourceDefs: new Set() });
    byFile.get(key)[kind === 'projection' ? 'projectionDefs' : 'sourceDefs'].add(def);
  };
  for (const def of defs) {
    addWatch(def.outFile, def, 'projection');
    for (const file of def.watchFiles()) addWatch(file, def, 'source');
  }

  const run = (entry, kind) => {
    if (kind === 'projection' && Date.now() < ignoreProjectionUntil) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (busy) return;
      busy = true;
      try {
        const touched = kind === 'projection' ? entry.projectionDefs : entry.sourceDefs;
        if (kind === 'projection') {
          for (const def of touched) {
            def.sync({ quiet: true });
            ignoreProjectionUntil = Date.now() + 500;
            def.generate({ quiet: true });
            console.log(`synced ${rel(def.outFile)} -> sources -> ${rel(def.outFile)}`);
          }
        } else {
          for (const def of touched) {
            ignoreProjectionUntil = Date.now() + 500;
            def.generate({ quiet: true });
            console.log(`regenerated ${rel(def.outFile)} from source change`);
          }
        }
      } catch (err) {
        console.error(err?.message ?? err);
      } finally {
        setTimeout(() => { busy = false; }, 200);
      }
    }, 150);
  };

  const watchers = [...byFile.values()]
    .filter(entry => existsSync(entry.file))
    .map(entry => watch(entry.file, { persistent: true }, () => {
      run(entry, entry.projectionDefs.size ? 'projection' : 'source');
    }));
  const close = () => {
    for (const watcher of watchers) watcher.close();
  };
  process.once('SIGINT', () => { close(); process.exit(0); });
  process.once('SIGTERM', () => { close(); process.exit(0); });
}

function printHelp() {
  console.log(`
usage:
  node dx/projections/projections.mjs list
  node dx/projections/projections.mjs status
  node dx/projections/projections.mjs show [commands|events|flows|command-ui|data|render] [filter]
  node dx/projections/projections.mjs generate [commands|events|flows|command-ui|data|render]
  node dx/projections/projections.mjs sync [commands|events|command-ui|render]
  node dx/projections/projections.mjs watch [commands|events|flows|command-ui|data|render]

Generated views live in views/. Source files remain the owners.
`);
}

function defsForSelected(name) {
  return name ? [selectProjection(name)] : [...projections.values()];
}

function runForSelected(name, fn) {
  for (const def of defsForSelected(name)) def[fn]();
}

function main() {
  const cmd = argv[0] ?? 'list';
  const name = argv[1];
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return printHelp();
  if (cmd === 'list') return printList();
  if (cmd === 'status') {
    for (const def of defsForSelected(name)) projectionStatus(def);
    return;
  }
  if (cmd === 'concept') return console.log(renderConcept(argv.slice(1).join(' ')));
  if (cmd === 'show') return showProjection(selectProjection(name ?? 'commands'), argv.slice(2).join(' '));
  if (cmd === 'generate') return runForSelected(name, 'generate');
  if (cmd === 'sync') return runForSelected(name, 'sync');
  if (cmd === 'watch' || cmd === 'serve') return watchProjections(defsForSelected(name));
  printHelp();
  process.exitCode = 2;
}

try {
  main();
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
}
