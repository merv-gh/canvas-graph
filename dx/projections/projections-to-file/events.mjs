import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { EVENTS_VIEW, findMatching, rel } from '../shared.mjs';
import { collectEventDecls } from '../file-to-projection/events.mjs';

function parseEventInterfaces(text) {
  const decls = [];
  const ifaceRe = /\binterface\s+\w+\s*\{/g;
  for (let m; (m = ifaceRe.exec(text));) {
    const open = text.indexOf('{', m.index);
    const close = findMatching(text, open, '{', '}');
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    const lineRe = /^[^\S\n]*(['"])([^'"]+)\1\s*:\s*[^;]+;[^\n]*$/gm;
    for (let d; (d = lineRe.exec(body));) decls.push({ id: d[2], body: d[0] });
    ifaceRe.lastIndex = close + 1;
  }
  return decls;
}

export function syncEvents({ quiet = false } = {}) {
  if (!existsSync(EVENTS_VIEW)) throw new Error(`${rel(EVENTS_VIEW)} does not exist; run generate first`);
  const blocks = parseEventInterfaces(readFileSync(EVENTS_VIEW, 'utf8'));
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) throw new Error(`duplicate event declaration for ${block.id}`);
    seen.add(block.id);
  }

  const index = new Map();
  for (const decl of collectEventDecls()) index.set(decl.id, decl);
  const projectionIds = new Set(blocks.map(block => block.id));

  const byFile = new Map();
  for (const block of blocks) {
    const found = index.get(block.id);
    if (!found) {
      const orphans = [...index.keys()].filter(id => !projectionIds.has(id));
      const hint = orphans.length ? ` Un-projected source event(s): ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ', …' : ''}. Renaming an event isn't auto-synced (handlers/emitters would dangle) — use refactor_tool, then regenerate.` : '';
      throw new Error(`event '${block.id}' is not declared in any source file. Declare new events where the owning system augments CustomEvents, not in the projection.${hint}`);
    }
    if (!byFile.has(found.file)) byFile.set(found.file, []);
    byFile.get(found.file).push({ ...found, next: block.body.trimEnd() });
  }

  let changedFiles = 0;
  let changedBlocks = 0;
  for (const [file, replacements] of byFile) {
    const source = readFileSync(file, 'utf8');
    let nextSource = source;
    for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
      if (nextSource.slice(replacement.start, replacement.end) !== replacement.next) changedBlocks++;
      nextSource = `${nextSource.slice(0, replacement.start)}${replacement.next}${nextSource.slice(replacement.end)}`;
    }
    if (nextSource !== source) {
      writeFileSync(file, nextSource);
      changedFiles++;
    }
  }
  if (!quiet) console.log(`synced ${changedBlocks} event declaration(s) into ${changedFiles} source file(s)`);
}
