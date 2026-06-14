import { existsSync, readFileSync } from 'node:fs';
import {
  COMMAND_UI_VIEW,
  escapeRe,
  findMatching,
  rel,
  sourcePathFromMarker,
  writeChanged,
} from '../shared.mjs';
import { collectCommandUi } from '../file-to-projection/command-ui.mjs';

function parseCommandUiArray(text) {
  const decl = text.search(/export\s+const\s+commandUi\b/);
  if (decl < 0) throw new Error('command-ui projection: no `export const commandUi` declaration found');
  const eq = text.indexOf('=', decl);
  const open = eq < 0 ? -1 : text.indexOf('[', eq);
  if (open < 0) throw new Error('command-ui projection: no `= [` array literal found');
  const close = findMatching(text, open, '[', ']');
  if (close < 0) throw new Error('command-ui projection: unterminated commandUi array');
  const blocks = [];
  let i = open + 1;
  while (i < close) {
    if (text[i] !== '{') {
      i++;
      continue;
    }
    const endBrace = findMatching(text, i, '{', '}');
    if (endBrace < 0 || endBrace > close) throw new Error('command-ui projection: unterminated object literal');
    const body = text.slice(i, endBrace + 1);
    const id = body.match(/\bcommand\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
    if (!id) throw new Error(`command-ui projection: array element has no command:\n${body.slice(0, 80)}`);
    blocks.push({ id, body });
    i = endBrace + 1;
  }
  return blocks;
}

function parseMarkedBlocks(text, kind) {
  const blocks = [];
  const beginRe = new RegExp(`^// BEGIN ${kind} ([^\\s]+) (.+?):(\\d+)(?: .*)?$`, 'gm');
  for (let begin; (begin = beginRe.exec(text));) {
    const key = begin[1];
    const id = decodeURIComponent(key);
    const file = begin[2];
    const contentStart = beginRe.lastIndex;
    const endRe = new RegExp(`^// END ${kind} ${escapeRe(key)}\\s*$`, 'gm');
    endRe.lastIndex = contentStart;
    const end = endRe.exec(text);
    if (!end) throw new Error(`projection block for ${kind} ${id} has no END marker`);
    let body = text.slice(contentStart, end.index);
    if (body.startsWith('\n')) body = body.slice(1);
    if (body.endsWith('\n')) body = body.slice(0, -1);
    blocks.push({ id, file: sourcePathFromMarker(file), body });
    beginRe.lastIndex = end.index + end[0].length;
  }
  return blocks;
}

export function syncCommandUi({ quiet = false } = {}) {
  if (!existsSync(COMMAND_UI_VIEW)) throw new Error(`${rel(COMMAND_UI_VIEW)} does not exist; run generate first`);
  const viewText = readFileSync(COMMAND_UI_VIEW, 'utf8');
  const blocks = /export\s+const\s+commandUi\b/.test(viewText)
    ? parseCommandUiArray(viewText)
    : parseMarkedBlocks(viewText, 'command-ui');
  const index = new Map();
  for (const item of collectCommandUi()) index.set(item.id, item);
  const byFile = new Map();
  const addReplacement = (file, replacement) => {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(replacement);
  };
  let lastFound = null;
  let added = 0;
  for (const block of blocks) {
    const found = index.get(block.id);
    if (found) {
      lastFound = found;
      addReplacement(found.file, { ...found, next: `${found.prefix}${block.body.trimEnd()}${found.suffix}` });
      continue;
    }
    if (!lastFound) throw new Error(`new command UI contribution '${block.id}' has no preceding sibling to anchor to`);
    const source = readFileSync(lastFound.file, 'utf8');
    const indent = source.slice(source.lastIndexOf('\n', lastFound.start) + 1, lastFound.start);
    addReplacement(lastFound.file, {
      start: lastFound.end,
      end: lastFound.end,
      next: `\n${indent}${lastFound.prefix}${block.body.trimEnd()}${lastFound.suffix}`,
    });
    added++;
  }
  let changedFiles = 0;
  let changedBlocks = 0;
  for (const [file, replacements] of byFile) {
    let source = readFileSync(file, 'utf8');
    let nextSource = source;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      if (nextSource.slice(replacement.start, replacement.end) !== replacement.next) changedBlocks++;
      nextSource = `${nextSource.slice(0, replacement.start)}${replacement.next}${nextSource.slice(replacement.end)}`;
    }
    if (writeChanged(file, nextSource)) changedFiles++;
  }
  if (!quiet) console.log(`synced ${changedBlocks} command UI contribution(s)${added ? ` (+${added} new)` : ''} into ${changedFiles} source file(s)`);
}
