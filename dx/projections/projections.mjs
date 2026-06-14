#!/usr/bin/env node
// CLI for editable feature projections.

import { existsSync, readFileSync, watch } from 'node:fs';
import { projections, selectProjection } from './registry.mjs';
import { rel, setDryRun, takeDryRunLedger } from './shared.mjs';
import { renderConcept } from './concepts/concept.mjs';

const rawArgv = process.argv.slice(2);
const flags = new Set(rawArgv.filter(arg => arg.startsWith('-')));
const argv = rawArgv.filter(arg => !arg.startsWith('-'));
// --dry-run / --no-write / --no-sync: compute the source edits a view change
// implies and report them, but write nothing — the views-only dogfood guard.
const DRY = flags.has('--dry-run') || flags.has('--no-write') || flags.has('--no-sync');

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

function watchProjections(defs, dry = false) {
  for (const def of defs) def.generate({ quiet: true });
  console.log(`serving projections: ${defs.map(def => `${def.name}=${rel(def.outFile)}`).join(', ')}`);
  console.log(dry
    ? 'DRY RUN (views-only dogfood): view edits report intended source changes but write NOTHING; Ctrl+C stops'
    : 'edit a projection to sync back; edit sources to regenerate; Ctrl+C stops');

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
            if (dry) {
              // views-only dogfood: report what the view edit would do, write nothing,
              // and skip regenerate so the in-progress view edits are preserved.
              setDryRun(true);
              try { def.sync({ quiet: true }); } finally { setDryRun(false); }
              reportLedger(def.name);
            } else {
              def.sync({ quiet: true });
              ignoreProjectionUntil = Date.now() + 500;
              def.generate({ quiet: true });
              console.log(`synced ${rel(def.outFile)} -> sources -> ${rel(def.outFile)}`);
            }
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
  node dx/projections/projections.mjs sync [commands|events|command-ui|render] [--dry-run]
  node dx/projections/projections.mjs watch [commands|events|flows|command-ui|data|render] [--dry-run]

Generated views live in views/. Source files remain the owners.
--dry-run (aka --no-write/--no-sync): compute + report the source edits a view
change implies, but write nothing — the views-only dogfood guard.
`);
}

function defsForSelected(name) {
  return name ? [selectProjection(name)] : [...projections.values()];
}

function runForSelected(name, fn) {
  for (const def of defsForSelected(name)) def[fn]();
}

function changeStat(before, after) {
  // Trim the common prefix/suffix so we report the size of the actual changed
  // region (a same-line edit reads as ~1 line, an inserted block as its size),
  // not a net line delta that hides in-place edits as "0 lines".
  const min = Math.min(before.length, after.length);
  let p = 0;
  while (p < min && before[p] === after[p]) p++;
  let s = 0;
  while (s < min - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const removed = before.slice(p, before.length - s);
  const added = after.slice(p, after.length - s);
  return {
    added: added ? added.split('\n').length : 0,
    removed: removed ? removed.split('\n').length : 0,
  };
}

function reportLedger(label) {
  const ledger = takeDryRunLedger();
  if (!ledger.length) {
    console.log(`${label}: dry-run — view edits imply no source changes`);
    return;
  }
  console.log(`${label}: DRY RUN — wrote nothing; these ${ledger.length} source file(s) would change:`);
  for (const { file, before, after } of ledger) {
    const { added, removed } = changeStat(before, after);
    console.log(`  ${rel(file)}  (+${added}/-${removed} lines)`);
  }
}

function syncSelected(name) {
  if (!DRY) return runForSelected(name, 'sync');
  setDryRun(true);
  try {
    for (const def of defsForSelected(name)) {
      def.sync({ quiet: true });
      reportLedger(def.name);
    }
  } finally {
    setDryRun(false);
  }
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
  if (cmd === 'sync') return syncSelected(name);
  if (cmd === 'watch' || cmd === 'serve') return watchProjections(defsForSelected(name), DRY);
  printHelp();
  process.exitCode = 2;
}

try {
  main();
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
}
