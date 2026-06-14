import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  COMMANDS_VIEW,
  escapeRe,
  findMatching,
  rel,
} from '../shared.mjs';
import { collectCommands } from '../file-to-projection/commands.mjs';

export function parseCommandArray(text) {
  const decl = text.search(/export\s+const\s+commands\b/);
  if (decl < 0) throw new Error('commands projection: no `export const commands` declaration found');
  const eq = text.indexOf('=', decl);
  const open = eq < 0 ? -1 : text.indexOf('[', eq);
  if (open < 0) throw new Error('commands projection: no `= [` array literal found');
  const close = findMatching(text, open, '[', ']');
  if (close < 0) throw new Error('commands projection: unterminated commands array');
  const blocks = [];
  let i = open + 1;
  while (i < close) {
    if (text[i] !== '{') { i++; continue; }
    const endBrace = findMatching(text, i, '{', '}');
    if (endBrace < 0 || endBrace > close) throw new Error('commands projection: unterminated object literal');
    const body = text.slice(i, endBrace + 1);
    const id = body.match(/\bid\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
    if (!id) throw new Error(`commands projection: array element has no id:\n${body.slice(0, 80)}`);
    blocks.push({ id, body });
    i = endBrace + 1;
  }
  return blocks;
}

function assertBlockStillTargetsId(block) {
  const idProperty = new RegExp(`\\bid\\s*:\\s*(['"\`])${escapeRe(block.id)}\\1`);
  if (!idProperty.test(block.body)) {
    throw new Error(`block ${block.id} no longer contains id: '${block.id}'`);
  }
}

export function syncCommands({ quiet = false } = {}) {
  if (!existsSync(COMMANDS_VIEW)) throw new Error(`${rel(COMMANDS_VIEW)} does not exist; run generate first`);
  const blocks = parseCommandArray(readFileSync(COMMANDS_VIEW, 'utf8'));
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) throw new Error(`duplicate projection element for ${block.id}`);
    seen.add(block.id);
    assertBlockStillTargetsId(block);
  }

  const index = new Map();
  for (const command of collectCommands()) index.set(command.id, command);
  const projectionIds = new Set(blocks.map(block => block.id));

  const edits = new Map();
  const addEdit = (file, edit) => { if (!edits.has(file)) edits.set(file, []); edits.get(file).push(edit); };
  let lastFound = null;
  let added = 0;
  let changedBlocks = 0;
  const pendingByAnchor = new Map();

  for (const block of blocks) {
    const found = index.get(block.id);
    if (found) {
      lastFound = found;
      let next = block.body.trimEnd();
      if (found.text.trimEnd().endsWith(',') && !next.endsWith(',')) next += ',';
      addEdit(found.file, { start: found.start, end: found.end, next });
      continue;
    }
    if (!lastFound) {
      const orphans = [...index.keys()].filter(id => !projectionIds.has(id));
      const hint = orphans.length ? ` (un-projected source commands that may have been renamed: ${orphans.slice(0, 5).join(', ')})` : '';
      throw new Error(`new command '${block.id}' has no preceding existing command to anchor to. Put a new command right after an existing one so sync knows which file + register([…]) it joins.${hint}`);
    }
    const source0 = readFileSync(lastFound.file, 'utf8');
    const indent = source0.slice(source0.lastIndexOf('\n', lastFound.start) + 1, lastFound.start);
    const key = `${lastFound.file}@${lastFound.end}`;
    if (!pendingByAnchor.has(key)) pendingByAnchor.set(key, { file: lastFound.file, at: lastFound.end, indent, bodies: [] });
    pendingByAnchor.get(key).bodies.push(block.body.trimEnd().replace(/,\s*$/, ''));
    added++;
  }

  for (const { file, at, indent, bodies } of pendingByAnchor.values()) {
    addEdit(file, { start: at, end: at, next: bodies.map(body => `\n${indent}${body},`).join('') });
  }

  let changedFiles = 0;
  for (const [file, fileEdits] of edits) {
    const source = readFileSync(file, 'utf8');
    let nextSource = source;
    for (const edit of [...fileEdits].sort((a, b) => b.start - a.start)) {
      if (nextSource.slice(edit.start, edit.end) !== edit.next) changedBlocks++;
      nextSource = `${nextSource.slice(0, edit.start)}${edit.next}${nextSource.slice(edit.end)}`;
    }
    if (nextSource !== source) {
      writeFileSync(file, nextSource);
      changedFiles++;
    }
  }

  if (!quiet) console.log(`synced ${changedBlocks} command slice(s)${added ? ` (+${added} new)` : ''} into ${changedFiles} source file(s)`);
  return changedBlocks;
}
