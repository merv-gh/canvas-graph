#!/usr/bin/env node
// Editable feature projections.
//
// A projection is a local view over slices that still belong to their original
// files. Generate the view, edit the marked slices, then sync them back.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SOURCE_ROOT = join(REPO, 'v2');
const VIEWS_DIR = join(HERE, 'views');
const COMMANDS_VIEW = join(VIEWS_DIR, 'commands.proj.ts');

const projections = new Map([
  ['commands', {
    name: 'commands',
    outFile: COMMANDS_VIEW,
    description: 'all contexts.commands.register(...) command literals from v2/',
    generate: generateCommands,
    sync: syncCommands,
    watchFiles: commandSourceFiles,
    count: () => collectCommands().length,
  }],
]);

const argv = process.argv.slice(2);

function rel(path) {
  return relative(REPO, path).replaceAll('\\', '/');
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path && !path.startsWith('..') && !path.startsWith('/'));
}

function sourcePathFromMarker(file) {
  const path = resolve(REPO, file);
  if (!isInside(SOURCE_ROOT, path)) throw new Error(`projection marker points outside v2/: ${file}`);
  if (!existsSync(path)) throw new Error(`projection marker points at missing file: ${file}`);
  return path;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function listSourceFiles(dir = SOURCE_ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function findMatching(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function includeTrailingComma(source, endBrace) {
  let i = endBrace + 1;
  while (/\s/.test(source[i] ?? '')) i++;
  return source[i] === ',' ? i + 1 : endBrace + 1;
}

function registerRanges(source) {
  const ranges = [];
  const re = /\bcommands\.register\s*\(\s*\[/g;
  for (let m; (m = re.exec(source));) {
    const open = source.indexOf('[', m.index);
    if (open < 0) continue;
    const close = findMatching(source, open, '[', ']');
    if (close < 0) continue;
    ranges.push({ start: open + 1, end: close });
    re.lastIndex = close + 1;
  }
  return ranges;
}

function extractCommandsFromSource(source, file) {
  const commands = [];
  const idRe = /\bid\s*:\s*(['"`])([^'"`]+)\1/g;
  for (const range of registerRanges(source)) {
    idRe.lastIndex = range.start;
    for (let m; (m = idRe.exec(source)) && m.index < range.end;) {
      const id = m[2];
      if (!id.includes('.')) continue;
      const start = source.lastIndexOf('{', m.index);
      if (start < range.start) continue;
      const endBrace = findMatching(source, start, '{', '}');
      if (endBrace < 0 || endBrace > range.end) continue;
      const end = includeTrailingComma(source, endBrace);
      commands.push({
        id,
        file,
        rel: rel(file),
        start,
        end,
        line: lineNumber(source, start),
        text: source.slice(start, end),
      });
    }
  }
  return commands;
}

function collectCommands() {
  const commands = [];
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    commands.push(...extractCommandsFromSource(source, file));
  }
  commands.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.id.localeCompare(b.id));
  return commands;
}

function commandSourceFiles() {
  return [...new Set(collectCommands().map(command => command.file))];
}

function renderCommands(commands) {
  const blocks = commands.map(command => [
    `// BEGIN command ${encodeURIComponent(command.id)} ${command.rel}:${command.line}`,
    command.text.trimEnd(),
    `// END command ${encodeURIComponent(command.id)}`,
    '',
  ].join('\n'));
  return [
    '// @walker-projection commands v1',
    '// Editable view over command specs. Source files still own these slices.',
    '// Generate: node walker/projections.mjs generate commands',
    '// Sync edits back: node walker/projections.mjs sync commands',
    '// Watch both ways: node walker/projections.mjs watch commands',
    '',
    ...blocks,
  ].join('\n');
}

function ensureViewDir() {
  mkdirSync(VIEWS_DIR, { recursive: true });
}

function generateCommands({ quiet = false } = {}) {
  ensureViewDir();
  const commands = collectCommands();
  const next = renderCommands(commands);
  if (!existsSync(COMMANDS_VIEW) || readFileSync(COMMANDS_VIEW, 'utf8') !== next) {
    writeFileSync(COMMANDS_VIEW, next);
  }
  if (!quiet) console.log(`generated ${rel(COMMANDS_VIEW)} (${commands.length} command slices)`);
  return commands.length;
}

function parseCommandBlocks(text) {
  const blocks = [];
  const beginRe = /^\/\/ BEGIN command ([^\s]+) (.+):(\d+)$/gm;
  for (let begin; (begin = beginRe.exec(text));) {
    const key = begin[1];
    const id = decodeURIComponent(key);
    const file = begin[2];
    const contentStart = beginRe.lastIndex;
    const endRe = new RegExp(`^// END command ${escapeRe(key)}\\s*$`, 'gm');
    endRe.lastIndex = contentStart;
    const end = endRe.exec(text);
    if (!end) throw new Error(`projection block for ${id} has no END marker`);
    let body = text.slice(contentStart, end.index);
    if (body.startsWith('\n')) body = body.slice(1);
    if (body.endsWith('\n')) body = body.slice(0, -1);
    blocks.push({ id, file: sourcePathFromMarker(file), body });
    beginRe.lastIndex = end.index + end[0].length;
  }
  return blocks;
}

function findCommand(source, id) {
  return extractCommandsFromSource(source, join(REPO, '<memory>')).find(command => command.id === id) ?? null;
}

function assertBlockStillTargetsId(block) {
  const idProperty = new RegExp(`\\bid\\s*:\\s*(['"\`])${escapeRe(block.id)}\\1`);
  if (!idProperty.test(block.body)) {
    throw new Error(`block ${block.id} no longer contains id: '${block.id}'`);
  }
}

function syncCommands({ quiet = false } = {}) {
  if (!existsSync(COMMANDS_VIEW)) throw new Error(`${rel(COMMANDS_VIEW)} does not exist; run generate first`);
  const blocks = parseCommandBlocks(readFileSync(COMMANDS_VIEW, 'utf8'));
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) throw new Error(`duplicate projection block for ${block.id}`);
    seen.add(block.id);
    assertBlockStillTargetsId(block);
  }

  const byFile = new Map();
  for (const block of blocks) {
    if (!byFile.has(block.file)) byFile.set(block.file, []);
    byFile.get(block.file).push(block);
  }

  let changedFiles = 0;
  let changedBlocks = 0;
  for (const [file, fileBlocks] of byFile) {
    let source = readFileSync(file, 'utf8');
    const replacements = fileBlocks.map(block => {
      const found = findCommand(source, block.id);
      if (!found) throw new Error(`could not find source command ${block.id} in ${rel(file)}`);
      let next = block.body.trimEnd();
      if (found.text.trimEnd().endsWith(',') && !next.endsWith(',')) next += ',';
      return { ...found, next };
    }).sort((a, b) => b.start - a.start);

    let nextSource = source;
    for (const replacement of replacements) {
      if (nextSource.slice(replacement.start, replacement.end) !== replacement.next) changedBlocks++;
      nextSource = `${nextSource.slice(0, replacement.start)}${replacement.next}${nextSource.slice(replacement.end)}`;
    }
    if (nextSource !== source) {
      writeFileSync(file, nextSource);
      changedFiles++;
    }
  }

  if (!quiet) console.log(`synced ${changedBlocks} command slice(s) into ${changedFiles} source file(s)`);
  return changedBlocks;
}

function projectionStatus(def) {
  const sourceFiles = def.watchFiles();
  const maxSourceMtime = sourceFiles.reduce((max, file) => Math.max(max, statSync(file).mtimeMs), 0);
  const outExists = existsSync(def.outFile);
  const stale = !outExists || statSync(def.outFile).mtimeMs < maxSourceMtime;
  const out = outExists ? rel(def.outFile) : `${rel(def.outFile)} (missing)`;
  console.log(`${def.name}: ${out}; ${def.count()} slices; ${stale ? 'stale' : 'fresh'}`);
}

function selectProjection(name) {
  const def = projections.get(name);
  if (!def) throw new Error(`unknown projection '${name}'. Known: ${[...projections.keys()].join(', ')}`);
  return def;
}

function printList() {
  for (const def of projections.values()) {
    console.log(`${def.name.padEnd(10)} ${rel(def.outFile)}  ${def.description}`);
  }
}

function watchProjection(def) {
  def.generate({ quiet: true });
  console.log(`serving ${def.name}: ${rel(def.outFile)}`);
  console.log('edit the projection to sync back; edit sources to regenerate the projection; Ctrl+C stops');

  let busy = false;
  let timer = null;
  let ignoreProjectionUntil = Date.now() + 500;
  const sourceFiles = def.watchFiles();
  const watched = [def.outFile, ...sourceFiles];
  const run = (kind) => {
    if (kind === 'projection' && Date.now() < ignoreProjectionUntil) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (busy) return;
      busy = true;
      try {
        if (kind === 'projection') {
          def.sync({ quiet: true });
          ignoreProjectionUntil = Date.now() + 500;
          def.generate({ quiet: true });
          console.log(`synced ${rel(def.outFile)} -> sources -> ${rel(def.outFile)}`);
        } else {
          ignoreProjectionUntil = Date.now() + 500;
          def.generate({ quiet: true });
          console.log(`regenerated ${rel(def.outFile)} from source change`);
        }
      } catch (err) {
        console.error(err?.message ?? err);
      } finally {
        setTimeout(() => { busy = false; }, 200);
      }
    }, 150);
  };

  const watchers = watched.map(file => watch(file, { persistent: true }, () => {
    run(file === def.outFile ? 'projection' : 'source');
  }));
  const close = () => {
    for (const watcher of watchers) watcher.close();
  };
  process.once('SIGINT', () => {
    close();
    process.exit(0);
  });
}

function printHelp() {
  console.log(`
usage:
  node walker/projections.mjs list
  node walker/projections.mjs status
  node walker/projections.mjs generate [commands]
  node walker/projections.mjs sync [commands]
  node walker/projections.mjs watch [commands]

Generated views live in walker/views/. Source files remain the owners.
`);
}

function runForSelected(name, fn) {
  const defs = name ? [selectProjection(name)] : [...projections.values()];
  for (const def of defs) def[fn]();
}

function main() {
  const cmd = argv[0] ?? 'list';
  const name = argv[1];
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return printHelp();
  if (cmd === 'list') return printList();
  if (cmd === 'status') {
    const defs = name ? [selectProjection(name)] : [...projections.values()];
    for (const def of defs) projectionStatus(def);
    return;
  }
  if (cmd === 'generate') return runForSelected(name, 'generate');
  if (cmd === 'sync') return runForSelected(name, 'sync');
  if (cmd === 'watch' || cmd === 'serve') return watchProjection(selectProjection(name ?? 'commands'));
  printHelp();
  process.exitCode = 2;
}

try {
  main();
} catch (err) {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
}
