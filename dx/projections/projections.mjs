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
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.env.WALKER_PROJECTION_ROOT ?? resolve(HERE, '..'));
const SOURCE_ROOT = join(REPO, 'v2');
const VIEWS_DIR = join(REPO, 'walker', 'views');
const COMMANDS_VIEW = join(VIEWS_DIR, 'commands.proj.ts');
const EVENTS_VIEW = join(VIEWS_DIR, 'events.proj.ts');
const FLOWS_VIEW = join(VIEWS_DIR, 'flows.proj.md');
const COMMAND_UI_VIEW = join(VIEWS_DIR, 'command-ui.proj.ts');
const DATA_VIEW = join(VIEWS_DIR, 'data.proj.md');
const RENDER_VIEW = join(VIEWS_DIR, 'render.proj.md');

const projections = new Map([
  ['commands', {
    name: 'commands',
    outFile: COMMANDS_VIEW,
    description: 'all contexts.commands.register(...) command literals from v2/',
    render: () => renderCommands(collectCommands()),
    generate: generateCommands,
    sync: syncCommands,
    watchFiles: commandSourceFiles,
    count: () => collectCommands().length,
  }],
  ['events', {
    name: 'events',
    outFile: EVENTS_VIEW,
    description: 'typed CustomEvents/BuiltinEvents declaration lines from v2/',
    render: () => renderEvents(collectEventDecls()),
    generate: generateEvents,
    sync: syncEvents,
    watchFiles: eventSourceFiles,
    count: () => collectEventDecls().length,
  }],
  ['flows', {
    name: 'flows',
    outFile: FLOWS_VIEW,
    description: 'generated command/event/on/emit flow map from v2/',
    render: renderFlows,
    generate: generateFlows,
    sync: () => console.log('flows is read-only; edit event declarations or source handlers instead'),
    watchFiles: () => listSourceFiles(),
    count: () => collectEventUsages().length,
  }],
  ['command-ui', {
    name: 'command-ui',
    outFile: COMMAND_UI_VIEW,
    description: 'all contribute({ surface, command, ... }) command UI affordances from v2/',
    render: () => renderCommandUi(collectCommandUi()),
    generate: generateCommandUi,
    sync: syncCommandUi,
    watchFiles: commandUiSourceFiles,
    count: () => collectCommandUi().length,
  }],
  ['data', {
    name: 'data',
    outFile: DATA_VIEW,
    description: 'per-entity data lifecycle: commands → mutation requests → handler → fact (⟳ render)',
    render: renderData,
    generate: generateData,
    sync: () => console.log('data is read-only; it is derived from events + handlers in source'),
    watchFiles: () => listSourceFiles(),
    count: () => DATA_ENTITIES.length,
  }],
  ['render', {
    name: 'render',
    outFile: RENDER_VIEW,
    description: 'editable shell fold render wiring: dataset mirrors + snapshot fields + CSS rules',
    render: () => renderRender(collectShellFolds()),
    generate: generateRender,
    sync: syncRender,
    watchFiles: () => [join(SOURCE_ROOT, 'systems/main.ts'), join(SOURCE_ROOT, 'core/snapshot.ts'), join(SOURCE_ROOT, 'styles.css')],
    count: () => collectShellFolds().length,
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
  for (const range of registerRanges(source)) {
    let i = range.start;
    while (i < range.end) {
      if (source[i] !== '{') {
        i++;
        continue;
      }
      const start = i;
      const endBrace = findMatching(source, start, '{', '}');
      if (endBrace < 0 || endBrace > range.end) break;
      const text = source.slice(start, includeTrailingComma(source, endBrace));
      const id = text.match(/\bid\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
      i = endBrace + 1;
      if (!id || !id.includes('.')) continue;
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

// Render the command slices as one valid `CommandSpec[]` literal. The bodies close
// over system-local helpers (refFromSource, graphs, selected, …) that don't resolve
// in isolation, so the view is @ts-nocheck: valid, readable TS (no sea of red that
// makes weak models flail) rather than a sequence of bare object literals. The real
// type/behaviour oracle is the loop's VERIFY step (vitest + tsc on actual source).
function renderCommands(commands) {
  // Bodies are emitted verbatim (source indentation preserved) so a no-op sync is a
  // true no-op — the watcher must not rewrite source on every save. Only the trailing
  // comma is normalized; the `// ── file ──` headers are skipped by the parser.
  // Two spaces prefix the opening brace only; inner lines keep their source
  // indentation untouched. The parser slices from `{`, so the prefix sits outside
  // the captured body and a no-op sync stays a true no-op.
  let lastRel = null;
  const elements = commands.map(command => {
    const body = `${command.text.trimEnd().replace(/,\s*$/, '')},`;
    const header = command.rel !== lastRel ? `  // ── ${command.rel} ──\n` : '';
    lastRel = command.rel;
    return `${header}  ${body}`;
  });
  return [
    '// @ts-nocheck — @walker-projection commands v2. Source files still own these slices.',
    '// Edit a field below, then: node walker/projections.mjs sync commands  (routes by id).',
    "import type { CommandSpec } from '../../v2/types';",
    '',
    'export const commands: CommandSpec[] = [',
    ...elements,
    '];',
    '',
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

function writeProjection(def, text, quiet) {
  ensureViewDir();
  if (!existsSync(def.outFile) || readFileSync(def.outFile, 'utf8') !== text) {
    writeFileSync(def.outFile, text);
  }
  if (!quiet) console.log(`generated ${rel(def.outFile)} (${def.count()} slice(s))`);
}

// Walk `export const commands … = [ … ]` and brace-match each top-level { … }
// element. Comments and the `// ── file ──` headers between elements are skipped
// (we only scan for object braces). Routing is by the body's own `id:` field.
function parseCommandArray(text) {
  const decl = text.search(/export\s+const\s+commands\b/);
  if (decl < 0) throw new Error('commands projection: no `export const commands` declaration found');
  const eq = text.indexOf('=', decl); // skip the CommandSpec[] type annotation's brackets
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

function assertBlockStillTargetsId(block) {
  const idProperty = new RegExp(`\\bid\\s*:\\s*(['"\`])${escapeRe(block.id)}\\1`);
  if (!idProperty.test(block.body)) {
    throw new Error(`block ${block.id} no longer contains id: '${block.id}'`);
  }
}

function syncCommands({ quiet = false } = {}) {
  if (!existsSync(COMMANDS_VIEW)) throw new Error(`${rel(COMMANDS_VIEW)} does not exist; run generate first`);
  const blocks = parseCommandArray(readFileSync(COMMANDS_VIEW, 'utf8'));
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) throw new Error(`duplicate projection element for ${block.id}`);
    seen.add(block.id);
    assertBlockStillTargetsId(block);
  }

  // ids are globally unique, so route each element to its owning source file by id.
  const index = new Map();
  for (const command of collectCommands()) index.set(command.id, command);
  const projectionIds = new Set(blocks.map(block => block.id));

  // Edits per file: replacements for existing slices, plus insertions for NEW
  // commands. A new command anchors on the preceding existing element in the
  // projection — it lands in that sibling's file, right after it. This makes the
  // projection a CREATE surface, not just an edit surface.
  const edits = new Map(); // file -> [{ start, end, text }]
  const addEdit = (file, edit) => { if (!edits.has(file)) edits.set(file, []); edits.get(file).push(edit); };
  let lastFound = null;
  let added = 0;
  let changedBlocks = 0;
  const pendingByAnchor = new Map(); // anchor.end -> { file, at, indent, bodies: [] }

  for (const block of blocks) {
    const found = index.get(block.id);
    if (found) {
      lastFound = found;
      let next = block.body.trimEnd();
      if (found.text.trimEnd().endsWith(',') && !next.endsWith(',')) next += ',';
      addEdit(found.file, { start: found.start, end: found.end, next });
      continue;
    }
    // New command: needs a preceding existing sibling to inherit a target file.
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
  // Turn each anchor's pending new commands into one insertion (preserving order).
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

function interfaceBodies(source, names = ['CustomEvents', 'BuiltinEvents']) {
  const bodies = [];
  for (const name of names) {
    const re = new RegExp(`\\binterface\\s+${name}\\s*\\{`, 'g');
    for (let m; (m = re.exec(source));) {
      const open = source.indexOf('{', m.index);
      const close = findMatching(source, open, '{', '}');
      if (close < 0) continue;
      bodies.push({ name, start: open + 1, end: close });
      re.lastIndex = close + 1;
    }
  }
  return bodies;
}

function lineBounds(source, index) {
  const start = source.lastIndexOf('\n', index) + 1;
  const endRaw = source.indexOf('\n', index);
  const end = endRaw < 0 ? source.length : endRaw;
  return { start, end };
}

function collectEventDecls() {
  const decls = [];
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const body of interfaceBodies(source)) {
      const text = source.slice(body.start, body.end);
      const re = /^\s*['"]([^'"]+)['"]\s*:\s*[^;]+;/gm;
      for (let m; (m = re.exec(text));) {
        const quoteAt = m[0].search(/['"]/);
        const absIndex = body.start + m.index + Math.max(0, quoteAt);
        const bounds = lineBounds(source, absIndex);
        decls.push({
          id: m[1],
          iface: body.name,
          file,
          rel: rel(file),
          start: bounds.start,
          end: bounds.end,
          line: lineNumber(source, bounds.start),
          text: source.slice(bounds.start, bounds.end),
        });
      }
    }
  }
  decls.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.id.localeCompare(b.id));
  return decls;
}

function eventSourceFiles() {
  return [...new Set(collectEventDecls().map(decl => decl.file))];
}

// Render the event declarations as compilable `interface` blocks (one per
// CustomEvents/BuiltinEvents), grouped by source file. Decl lines are emitted
// verbatim (source indentation preserved) so a no-op sync stays a true no-op;
// routing is by event name (globally unique), so no markers are needed.
// @ts-nocheck because the type bodies reference app types (ItemRef, …) that don't
// resolve in isolation.
function renderEvents(decls) {
  const byIface = new Map();
  for (const decl of decls) {
    if (!byIface.has(decl.iface)) byIface.set(decl.iface, []);
    byIface.get(decl.iface).push(decl);
  }
  const blocks = [];
  for (const [iface, ifaceDecls] of byIface) {
    blocks.push(`interface ${iface} {`);
    let lastRel = null;
    for (const decl of ifaceDecls) {
      if (decl.rel !== lastRel) { blocks.push(`  // ── ${decl.rel} ──`); lastRel = decl.rel; }
      blocks.push(decl.text.trimEnd());
    }
    blocks.push('}', '');
  }
  return [
    "// @ts-nocheck — @walker-projection events v2. Source declares these in `declare module '../types'`.",
    '// Edit a type below, then: node walker/projections.mjs sync events  (routes by event name).',
    '',
    ...blocks,
  ].join('\n');
}

function generateEvents({ quiet = false } = {}) {
  const def = selectProjection('events');
  writeProjection(def, def.render(), quiet);
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

// Walk each `interface X { … }` block and pull out `'name': type;` decl lines.
// Routing is by event name; the decl line text is captured verbatim.
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

function syncEvents({ quiet = false } = {}) {
  if (!existsSync(EVENTS_VIEW)) throw new Error(`${rel(EVENTS_VIEW)} does not exist; run generate first`);
  const blocks = parseEventInterfaces(readFileSync(EVENTS_VIEW, 'utf8'));
  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) throw new Error(`duplicate event declaration for ${block.id}`);
    seen.add(block.id);
  }
  // event names are globally unique, so route each decl to its source by name.
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

function collectEventUsages() {
  const usages = [];
  const callRe = /\b(on|emit|bus\.emit)\s*\(\s*(['"`])([^'"`]+)\2/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (let m; (m = callRe.exec(source));) {
      usages.push({ kind: m[1] === 'bus.emit' ? 'emit' : m[1], event: m[3], file, rel: rel(file), line: lineNumber(source, m.index) });
    }
  }
  for (const command of collectCommands()) {
    const eventMatch = command.text.match(/\bevent\s*:\s*(['"`])([^'"`]+)\1/);
    usages.push({
      kind: 'command',
      event: eventMatch?.[2] ?? command.id,
      command: command.id,
      file: command.file,
      rel: command.rel,
      line: command.line,
    });
  }
  usages.sort((a, b) => a.event.localeCompare(b.event) || a.kind.localeCompare(b.kind) || a.rel.localeCompare(b.rel) || a.line - b.line);
  return usages;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function summarizeEmitCall(callText, event) {
  if (event === 'render.view.set' || event === 'render.view.clear') {
    const place = callText.match(/\bplace\s*:\s*([^,\n}]+)/)?.[1]?.trim();
    const key = callText.match(/\bkey\s*:\s*([^,\n}]+)/)?.[1]?.trim();
    const bits = [place ? `place: ${place}` : '', key ? `key: ${key}` : ''].filter(Boolean);
    if (bits.length) return `{${bits.join(', ')}}`;
  }
  if (event === 'fold.toggle' || event === 'fold.changed') {
    const id = callText.match(/\bid\s*:\s*([^,\n}]+)/)?.[1]?.trim();
    if (id) return `{id: ${id}}`;
  }
  return '';
}

function extractEmitInfos(text) {
  const emits = [];
  const re = /\b(?:emit|bus\.emit)\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (let m; (m = re.exec(text));) {
    const open = text.indexOf('(', m.index);
    const close = open >= 0 ? findMatching(text, open, '(', ')') : -1;
    const callText = close >= 0 ? text.slice(m.index, close + 1) : m[0];
    emits.push({ event: m[2], detail: summarizeEmitCall(callText, m[2]) });
    if (close >= 0) re.lastIndex = close + 1;
  }
  // The fold context owns the actual fact emit in v2/core/fold.ts. Most systems
  // call the context, not `emit('fold.changed')`, so bridge that known seam.
  if (/\bcontexts\.fold\.(?:toggle|set)\s*\(/.test(text)) emits.push({ event: 'fold.changed', detail: 'via contexts.fold' });
  const seen = new Set();
  return emits.filter(info => {
    const key = `${info.event}\0${info.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractEmits(text) {
  return unique(extractEmitInfos(text).map(info => info.event));
}

function formatEmitInfos(infos) {
  return infos.length
    ? infos.map(info => info.detail ? `${info.event} ${info.detail}` : info.event).join(', ')
    : '-';
}

function uniqueEmitInfos(infos) {
  const seen = new Set();
  return infos.filter(info => {
    const key = `${info.event}\0${info.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectLocalEmitters(source) {
  const locals = new Map();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
  for (let m; (m = re.exec(source));) {
    let bodyStart = re.lastIndex;
    while (/\s/.test(source[bodyStart] ?? '')) bodyStart++;
    let body = '';
    if (source[bodyStart] === '{') {
      const close = findMatching(source, bodyStart, '{', '}');
      if (close < 0) continue;
      body = source.slice(bodyStart, close + 1);
      re.lastIndex = close + 1;
    } else {
      const directEmit = source.slice(bodyStart, bodyStart + 24).match(/^(?:emit|bus\.emit)\s*\(/);
      if (directEmit) {
        const open = source.indexOf('(', bodyStart);
        const close = open >= 0 ? findMatching(source, open, '(', ')') : -1;
        if (close < 0) continue;
        body = source.slice(bodyStart, close + 1);
        re.lastIndex = close + 1;
      } else {
        const end = source.indexOf(';', bodyStart);
        body = source.slice(bodyStart, end < 0 ? source.length : end);
        re.lastIndex = end < 0 ? source.length : end + 1;
      }
    }
    const emits = extractEmitInfos(body);
    if (emits.length) locals.set(m[1], emits);
  }
  return locals;
}

function expandLocalEmitInfos(handlerText, localEmitters) {
  const infos = [...extractEmitInfos(handlerText)];
  const directHandler = handlerText.match(/\bon\s*\(\s*(['"`])[^'"`]+\1\s*,\s*([A-Za-z_$][\w$]*)\s*\)$/)?.[2];
  for (const [name, emits] of localEmitters) {
    if (directHandler !== name && !new RegExp(`\\b${escapeRe(name)}\\s*\\(`).test(handlerText)) continue;
    infos.push(...emits.map(info => ({
      event: info.event,
      detail: info.detail ? `${info.detail} via ${name}()` : `via ${name}()`,
    })));
  }
  return uniqueEmitInfos(infos);
}

function collectEventHandlers() {
  const handlers = [];
  const re = /\bon\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    const localEmitters = collectLocalEmitters(source);
    for (let m; (m = re.exec(source));) {
      const open = source.indexOf('(', m.index);
      const close = findMatching(source, open, '(', ')');
      if (close < 0) continue;
      const text = source.slice(m.index, close + 1);
      const emitDetails = expandLocalEmitInfos(text, localEmitters);
      handlers.push({
        event: m[2],
        file,
        rel: rel(file),
        line: lineNumber(source, m.index),
        emitDetails,
        emits: unique(emitDetails.map(info => info.event)),
      });
      re.lastIndex = close + 1;
    }
  }
  handlers.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.event.localeCompare(b.event));
  return handlers;
}

function eventFlowData() {
  const declsByEvent = new Map();
  for (const decl of collectEventDecls()) {
    if (!declsByEvent.has(decl.id)) declsByEvent.set(decl.id, []);
    declsByEvent.get(decl.id).push(decl);
  }
  const commandsByEvent = new Map();
  for (const command of collectCommands()) {
    const event = command.text.match(/\bevent\s*:\s*(['"`])([^'"`]+)\1/)?.[2] ?? command.id;
    if (!commandsByEvent.has(event)) commandsByEvent.set(event, []);
    commandsByEvent.get(event).push(command);
  }
  const usagesByEvent = new Map();
  const emittedEvents = new Set();
  for (const usage of collectEventUsages()) {
    if (!usagesByEvent.has(usage.event)) usagesByEvent.set(usage.event, []);
    usagesByEvent.get(usage.event).push(usage);
    if (usage.kind === 'emit') emittedEvents.add(usage.event);
  }
  const handlersByEvent = new Map();
  for (const handler of collectEventHandlers()) {
    if (!handlersByEvent.has(handler.event)) handlersByEvent.set(handler.event, []);
    handlersByEvent.get(handler.event).push(handler);
  }
  const events = [...new Set([
    ...declsByEvent.keys(),
    ...commandsByEvent.keys(),
    ...usagesByEvent.keys(),
    ...handlersByEvent.keys(),
  ])].sort();
  return { declsByEvent, commandsByEvent, usagesByEvent, handlersByEvent, emittedEvents, events };
}

function formatLoc(item) {
  return `${item.rel}:${item.line}`;
}

// Past-tense facts auto-redraw (Principle: facts emitted by the data owner trigger
// render). So a leaf that is a fact is where the cascade reaches the UI — the spot
// to check for a *render* bug vs. a *logic* bug upstream.
const FACT_RE = /\.(created|updated|deleted|removed|changed|focused|selected|moved|added|committed|toggled|opened|closed|started|done|cancelled|cleared|set|applied|fit)$/;
const leafNote = (event) => FACT_RE.test(event)
  ? '  ⟳ fact → auto-redraw (UI leaf — render reads data here)'
  : '  ▪ terminal (no further handler)';

function renderFlowEvent(lines, data, event, depth, seen) {
  const pad = '  '.repeat(depth);
  const handlers = data.handlersByEvent.get(event) ?? [];
  if (!handlers.length) {
    lines.push(`${pad}- ${event}${leafNote(event)}`);
    return;
  }
  lines.push(`${pad}- ${event}`);
  for (const handler of handlers) {
    const emits = formatEmitInfos(handler.emitDetails ?? handler.emits.map(event => ({ event, detail: '' })));
    lines.push(`${pad}  handler ${formatLoc(handler)} emits ${emits}`);
    for (const next of handler.emits.slice(0, 8)) {
      if (seen.has(next)) {
        lines.push(`${pad}    -> ${next} (cycle)`);
      } else if (depth >= 5) {
        lines.push(`${pad}    -> ${next} (depth limit)`);
      } else {
        renderFlowEvent(lines, data, next, depth + 2, new Set([...seen, event]));
      }
    }
    if (handler.emits.length > 8) lines.push(`${pad}    …${handler.emits.length - 8} more emitted events`);
  }
}

function renderFlows() {
  const data = eventFlowData();
  const starts = data.events.filter(event =>
    data.commandsByEvent.has(event) ||
    event === 'app.start' ||
    (data.handlersByEvent.has(event) && !data.emittedEvents.has(event))
  );
  const lines = [
    '# @walker-projection flows v2',
    '',
    'Read-only causal streams: origin event -> listeners in source order -> the events',
    'each listener emits, recursively, across files. See cross-system behaviour without',
    'opening every handler. Trace one origin: `project show flows <event|command-id>`.',
    'Leaf markers: `⟳ fact` = cascade reaches the UI (render reads data — a render bug',
    'lives here, logic bugs upstream); `▪ terminal` = dead-ends with no handler.',
    '',
  ];
  for (const event of starts) {
    lines.push(`## stream ${event}`);
    const commands = data.commandsByEvent.get(event) ?? [];
    if (commands.length) lines.push(`origin commands: ${commands.map(command => `${command.id} (${formatLoc(command)})`).join(', ')}`);
    renderFlowEvent(lines, data, event, 0, new Set());
    lines.push('');
  }

  lines.push('## event index', '');
  for (const event of data.events) {
    const decls = data.declsByEvent.get(event) ?? [];
    const usages = data.usagesByEvent.get(event) ?? [];
    const commands = usages.filter(u => u.kind === 'command');
    const emitters = usages.filter(u => u.kind === 'emit');
    const handlers = usages.filter(u => u.kind === 'on');
    lines.push(`### ${event}`);
    if (decls.length) lines.push(`declared: ${decls.map(d => `${d.rel}:${d.line}`).join(', ')}`);
    if (commands.length) lines.push(`commands: ${commands.map(u => `${u.command} (${u.rel}:${u.line})`).join(', ')}`);
    if (emitters.length) lines.push(`emitters: ${emitters.map(u => `${u.rel}:${u.line}`).join(', ')}`);
    if (handlers.length) lines.push(`handlers: ${handlers.map(u => `${u.rel}:${u.line}`).join(', ')}`);
    if (!decls.length) lines.push('declared: -');
    if (!commands.length && !emitters.length && !handlers.length) lines.push('usage: -');
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

function generateFlows({ quiet = false } = {}) {
  const def = selectProjection('flows');
  writeProjection(def, def.render(), quiet);
}

// ---- data flows: the entity axis of the event graph ----
const DATA_ENTITIES = ['node', 'edge', 'container', 'item', 'graph'];

/** Which data entity an event concerns, by dotted-name segment (graph.NODE.created → node). */
function entityOf(event) {
  const segs = event.split('.');
  return DATA_ENTITIES.find(e => segs.includes(e)) ?? null;
}

// Per-entity data lifecycle: command → mutation request → handler (the data owner)
// → the fact it emits. The fact is a WRITE that auto-redraws, so it's where the
// entity's data changed and the UI re-reads it. Complements `flows` (event cascade)
// with the data axis — to find where an entity is created/updated/deleted, and the
// render leaf that reads it, without opening every system.
function renderData() {
  const data = eventFlowData();
  const lines = [
    '# @walker-projection data v1',
    '',
    'Per-entity data lifecycle: command → mutation request → handler (owner) → fact (⟳ render).',
    'The fact is where the data changed and the UI re-reads it. Read-only.',
    'Trace one entity: `project show data node`.',
    '',
  ];
  for (const entity of DATA_ENTITIES) {
    const events = data.events.filter(event => entityOf(event) === entity);
    if (!events.length) continue;
    const requests = events.filter(event => !FACT_RE.test(event));
    const facts = events.filter(event => FACT_RE.test(event));
    const commands = [...new Set(events.flatMap(event =>
      (data.commandsByEvent.get(event) ?? []).map(command => `${command.id} (${formatLoc(command)})`)))];
    lines.push(`## ${entity}`);
    if (commands.length) lines.push(`commands: ${commands.join(', ')}`);
    lines.push('writes (request → owner handler → fact emitted):');
    let wrote = false;
    for (const request of requests) {
      for (const handler of data.handlersByEvent.get(request) ?? []) {
        const emitted = handler.emits.length ? handler.emits.join(', ') : '(emits no fact)';
        lines.push(`  ${request} → ${formatLoc(handler)} → ${emitted}`);
        wrote = true;
      }
    }
    if (!wrote) lines.push('  (no static request handlers found — may mutate via item.update or a store)');
    if (facts.length) lines.push(`facts (data changed → ⟳ render reads here): ${facts.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

function generateData({ quiet = false } = {}) {
  const def = selectProjection('data');
  writeProjection(def, def.render(), quiet);
}

// ---- render surface: shell fold dataset/snapshot/CSS wiring ----
const MAIN_TS = join(SOURCE_ROOT, 'systems/main.ts');
const SNAPSHOT_TS = join(SOURCE_ROOT, 'core/snapshot.ts');
const STYLES_CSS = join(SOURCE_ROOT, 'styles.css');

function kebab(value) {
  return String(value).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

function quoteString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function constantsIn(source) {
  const constants = new Map();
  const re = /^\s*const\s+([A-Z0-9_]+)\s*=\s*(['"`])([^'"`]+)\2\s*;/gm;
  for (let m; (m = re.exec(source));) constants.set(m[1], m[3]);
  return constants;
}

function foldExprToId(expr, constants) {
  const raw = String(expr ?? '').trim();
  const quoted = raw.match(/^(['"`])([^'"`]+)\1$/);
  if (quoted) return quoted[2];
  return constants.get(raw) ?? raw;
}

function cssRuleRanges(source) {
  const ranges = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{') continue;
    const close = findMatching(source, i, '{', '}');
    if (close < 0) continue;
    const prevClose = source.lastIndexOf('}', i);
    let selectorStart = prevClose < 0 ? 0 : prevClose + 1;
    while (/\s/.test(source[selectorStart] ?? '')) selectorStart++;
    ranges.push({ start: selectorStart, end: close + 1, text: source.slice(selectorStart, close + 1).trimEnd() });
    i = close;
  }
  return ranges;
}

function cssForAttr(source, attr) {
  return cssRuleRanges(source)
    .filter(rule => rule.text.includes(`[${attr}=`))
    .map(rule => rule.text)
    .join('\n');
}

function collectShellFolds() {
  if (!existsSync(MAIN_TS)) return [];
  const main = readFileSync(MAIN_TS, 'utf8');
  const css = existsSync(STYLES_CSS) ? readFileSync(STYLES_CSS, 'utf8') : '';
  const constants = constantsIn(main);
  const folds = [];
  const re = /^\s*shell\.dataset\.([A-Za-z_$][\w$]*)\s*=\s*contexts\.fold\.folded\(([^)]+)\)\s*\?\s*['"]true['"]\s*:\s*['"]false['"]\s*;/gm;
  for (let m; (m = re.exec(main));) {
    const field = m[1];
    const foldExpr = m[2].trim();
    const foldId = foldExprToId(foldExpr, constants);
    const attr = `data-${kebab(field)}`;
    folds.push({
      field,
      foldId,
      foldExpr,
      attr,
      line: lineNumber(main, m.index),
      css: cssForAttr(css, attr),
    });
  }
  return folds;
}

function renderRender(folds) {
  const lines = [
    '# @walker-projection render v1',
    '',
    'Editable shell fold render wiring. Each block syncs:',
    '- v2/systems/main.ts dataset mirror + fold.changed guard',
    '- v2/core/snapshot.ts ui.shell mirror',
    '- v2/styles.css shell CSS rules',
    '',
    'Add a new `## shell-fold <field>` block next to siblings to create a render seam.',
    '',
  ];
  for (const fold of folds) {
    lines.push(`## shell-fold ${fold.field}`);
    lines.push(`field: ${fold.field}`);
    lines.push(`foldId: ${fold.foldId}`);
    if (fold.foldExpr && fold.foldExpr !== quoteString(fold.foldId)) lines.push(`foldExpr: ${fold.foldExpr}`);
    lines.push(`attr: ${fold.attr}`);
    lines.push('css:');
    lines.push('```css');
    lines.push((fold.css || `.shell[${fold.attr}="true"] { }`).trimEnd());
    lines.push('```', '');
  }
  return lines.join('\n');
}

function generateRender({ quiet = false } = {}) {
  const def = selectProjection('render');
  writeProjection(def, def.render(), quiet);
}

function parseRender(text) {
  const blocks = [];
  const parts = text.split(/\n(?=## shell-fold )/).slice(1);
  for (const part of parts) {
    const head = part.match(/^## shell-fold\s+([^\n]+)/);
    if (!head) continue;
    const body = part.slice(head[0].length);
    const get = (key) => body.match(new RegExp(`\\n${key}:\\s*([^\\n]+)`))?.[1]?.trim();
    const css = body.match(/```css\s*\n([\s\S]*?)```/)?.[1]?.trimEnd() ?? '';
    const field = get('field') ?? head[1].trim();
    const foldId = get('foldId');
    if (!field || !foldId) throw new Error(`render projection shell-fold ${head[1]} needs field and foldId`);
    blocks.push({
      field,
      foldId,
      foldExpr: get('foldExpr') || quoteString(foldId),
      attr: get('attr') || `data-${kebab(field)}`,
      css,
    });
  }
  return blocks;
}

function replaceBetween(source, startNeedle, endNeedle, replacement) {
  const startAt = source.indexOf(startNeedle);
  if (startAt < 0) throw new Error(`render sync: missing start marker ${startNeedle}`);
  const bodyStart = startAt + startNeedle.length;
  const endAt = source.indexOf(endNeedle, bodyStart);
  if (endAt < 0) throw new Error(`render sync: missing end marker ${endNeedle}`);
  return `${source.slice(0, bodyStart)}${replacement}${source.slice(endAt)}`;
}

function replaceObjectBody(source, objectName, body) {
  const re = new RegExp(`const\\s+${objectName}\\s*:[^{]+\\{`, 'm');
  const m = re.exec(source);
  if (!m) throw new Error(`render sync: missing ${objectName}`);
  const open = source.indexOf('{', m.index);
  const close = findMatching(source, open, '{', '}');
  if (close < 0) throw new Error(`render sync: unterminated ${objectName}`);
  return `${source.slice(0, open + 1)}\n${body}\n${source.slice(close)}`;
}

function removeShellFoldCss(source, folds) {
  const attrs = new Set(folds.map(fold => fold.attr));
  let next = source;
  for (const rule of cssRuleRanges(source).sort((a, b) => b.start - a.start)) {
    if (![...attrs].some(attr => rule.text.includes(`[${attr}=`))) continue;
    let start = rule.start;
    let end = rule.end;
    while (next[end] === '\n' && next[end + 1] === '\n') end++;
    next = `${next.slice(0, start)}${next.slice(end)}`;
  }
  return next.replace(/\n{3,}/g, '\n\n');
}

function insertAfterShellRule(source, cssText) {
  const shell = source.match(/\.shell\s*\{[^}]*\}/);
  if (!shell) throw new Error('render sync: missing .shell CSS rule');
  const at = (shell.index ?? 0) + shell[0].length;
  return `${source.slice(0, at)}\n${cssText.trimEnd()}\n${source.slice(at).replace(/^\n+/, '')}`;
}

function syncRender({ quiet = false } = {}) {
  if (!existsSync(RENDER_VIEW)) throw new Error(`${rel(RENDER_VIEW)} does not exist; run generate first`);
  const folds = parseRender(readFileSync(RENDER_VIEW, 'utf8'));
  const seen = new Set();
  for (const fold of folds) {
    if (seen.has(fold.field)) throw new Error(`duplicate shell fold field ${fold.field}`);
    seen.add(fold.field);
  }

  let changedFiles = 0;
  const writeChanged = (file, next) => {
    const current = readFileSync(file, 'utf8');
    if (current === next) return;
    writeFileSync(file, next);
    changedFiles++;
  };

  let main = readFileSync(MAIN_TS, 'utf8');
  const datasetLines = folds.map(fold =>
    `      shell.dataset.${fold.field} = contexts.fold.folded(${fold.foldExpr}) ? 'true' : 'false';`).join('\n');
  main = replaceBetween(main, '      if (!shell) return;\n', '    };', `${datasetLines}\n`);
  const guard = `      if (${folds.map(fold => `id !== ${fold.foldExpr}`).join(' && ')}) return;`;
  main = main.replace(/^\s*if \(id !== [^\n]+?\) return;$/m, guard);
  writeChanged(MAIN_TS, main);

  let snapshot = readFileSync(SNAPSHOT_TS, 'utf8');
  const shellObject = folds.map(fold => `      ${fold.field}: shellEl?.dataset.${fold.field} === 'true',`).join('\n');
  snapshot = replaceBetween(snapshot, '    shell: {\n', '    },\n    rendered:', `${shellObject}\n`);
  const shellCode = folds.map(fold =>
    `  ${fold.field}: "ctx.contexts.places.el('top')?.parentElement?.dataset.${fold.field} === 'true'",`).join('\n');
  snapshot = replaceObjectBody(snapshot, 'SHELL_CODE', shellCode);
  writeChanged(SNAPSHOT_TS, snapshot);

  let css = readFileSync(STYLES_CSS, 'utf8');
  css = removeShellFoldCss(css, folds);
  const cssText = folds.map(fold => fold.css.trim()).filter(Boolean).join('\n');
  if (cssText) css = insertAfterShellRule(css, cssText);
  writeChanged(STYLES_CSS, css);

  if (!quiet) console.log(`synced ${folds.length} shell fold render seam(s) into ${changedFiles} changed source file(s)`);
}

// ---- concept brief: fuzzy-search the views by a phrase, for harness injection ----
const CONCEPT_STOP = new Set(['the', 'and', 'for', 'via', 'not', 'does', 'done', 'with', 'from',
  'into', 'this', 'that', 'out', 'off', 'are', 'way', 'back', 'once', 'mode', 'only', 'has',
  'have', 'its', 'but', 'all', 'any', 'new', 'add', 'make', 'when', 'then', 'now', 'should',
  'would', 'could', 'item', 'items', 'app', 'still', 'leaving', 'hidden']);

function conceptWords(query) {
  const words = new Set(String(query || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !CONCEPT_STOP.has(word)));
  if ([...words].some(word => ['collapse', 'collapsed', 'collapsible', 'fold', 'folded', 'hide', 'hidden'].includes(word))) {
    words.add('fold');
    words.add('folded');
    words.add('toggle');
  }
  if ([...words].some(word => ['escape', 'cancel', 'cancellable'].includes(word))) {
    words.add('cancel');
    words.add('cancellation');
  }
  return [...words];
}

/** Compact, harness-injectable brief for a concept phrase: the matching commands,
 *  the flow trace from the best-matching origin (origin→handlers→⟳ render leaf), and
 *  the data entity if one is named. This is the slice a weak model won't fetch itself. */
function renderConcept(query) {
  const words = conceptWords(query);
  if (!words.length) return 'concept: provide a phrase to search\n';
  const score = (text) => { const t = String(text || '').toLowerCase(); return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0); };
  const data = eventFlowData();
  const lines = [`concept "${words.join(' ')}" — auto-gathered from the views:`, ''];

  const commands = collectCommands()
    .map(command => ({ command, s: score(`${command.id} ${command.text}`) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  if (commands.length) {
    lines.push('commands:');
    for (const { command } of commands) {
      const shortcut = command.text.match(/\bshortcut\s*:\s*['"]([^'"]+)/)?.[1];
      lines.push(`  ${command.id}${shortcut ? ` [${shortcut}]` : ''}  ${command.rel}:${command.line}`);
    }
    lines.push('');
  }

  const commandIds = new Set(commands.map(({ command }) => command.id));
  const affordances = collectCommandUi()
    .map(item => ({ item, s: commandIds.has(item.id) ? 2 : score(`${item.id} ${item.body}`) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  if (affordances.length) {
    lines.push('ui affordances:');
    for (const { item } of affordances) {
      const surface = item.body.match(/\bsurface\s*:\s*['"]([^'"]+)/)?.[1] ?? '?';
      lines.push(`  ${item.id} on ${surface}  ${item.rel}:${item.line}`);
    }
    lines.push('');
  }

  const renderFolds = collectShellFolds()
    .map(fold => ({ fold, s: score(`${fold.field} ${fold.foldId} ${fold.attr} ${fold.css}`) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  if (renderFolds.length) {
    lines.push('render seams:');
    for (const { fold } of renderFolds) {
      lines.push(`  ${fold.field}: ${fold.foldId} -> ${fold.attr}  main.ts:${fold.line}, snapshot.ts, styles.css`);
    }
    lines.push('');
  }

  const cancellationRegistrations = collectCancellationRegistrations()
    .map(item => ({ item, s: score(`${item.rel} ${item.body}`) }))
    .filter(entry => entry.s > 0 || words.some(word => ['escape', 'cancel', 'cancellation', 'cancellable'].includes(word)))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  if (cancellationRegistrations.length) {
    lines.push('cancellables (Escape/app.cancel handlers):');
    for (const { item } of cancellationRegistrations) {
      const active = item.body.match(/\bactive\s*:\s*([^,\n}]+)/)?.[1]?.trim();
      const cancel = item.body.match(/\bcancel\s*:\s*([^,\n}]+)/)?.[1]?.trim();
      lines.push(`  ${item.rel}:${item.line}${active ? ` active=${active}` : ''}${cancel ? ` cancel=${cancel}` : ''}`);
    }
    lines.push('');
  }

  // Origins to trace: the matched commands' own events (so a command like view.zen
  // surfaces its fold.toggle cascade) plus any event whose name matches the concept.
  const commandEvents = commands.map(({ command }) =>
    command.text.match(/\bevent\s*:\s*['"]([^'"]+)/)?.[1] ?? command.id);
  const wordEvents = [...new Set([...data.handlersByEvent.keys(), ...data.commandsByEvent.keys()])]
    .map(event => ({ event, s: score(event) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(entry => entry.event);
  const origins = [...new Set([...commandEvents, ...wordEvents])]
    .filter(event => data.handlersByEvent.has(event))
    .slice(0, 2);
  if (origins.length) {
    lines.push('flow (origin → handlers → ⟳ render leaf):');
    for (const event of origins) renderFlowEvent(lines, data, event, 1, new Set());
    lines.push('');
  }

  const entity = DATA_ENTITIES.find(e => words.includes(e));
  if (entity) lines.push(`entity '${entity}' lifecycle: project show data ${entity}`);

  if (!commands.length && !origins.length && !entity) {
    return `concept "${words.join(' ')}": no command/flow match — discover with inspect or projection.\n`;
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function collectCommandUi() {
  const items = [];
  const re = /\bcontribute\s*\(/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (let m; (m = re.exec(source));) {
      const open = source.indexOf('(', m.index);
      const close = findMatching(source, open, '(', ')');
      if (close < 0) continue;
      let firstArg = open + 1;
      while (/\s/.test(source[firstArg] ?? '')) firstArg++;
      if (source[firstArg] !== '{') continue;
      const objectEnd = findMatching(source, firstArg, '{', '}');
      if (objectEnd < 0 || objectEnd > close) continue;
      let end = close + 1;
      while (/\s/.test(source[end] ?? '')) end++;
      if (source[end] === ';') end++;
      const text = source.slice(m.index, end);
      const command = text.match(/\bcommand\s*:\s*(['"`])([^'"`]+)\1/)?.[2];
      if (!command) continue;
      items.push({
        id: command,
        file,
        rel: rel(file),
        start: m.index,
        end,
        line: lineNumber(source, m.index),
        text,
        body: source.slice(firstArg, objectEnd + 1),
        prefix: source.slice(m.index, firstArg),
        suffix: source.slice(objectEnd + 1, end),
      });
      re.lastIndex = end;
    }
  }
  items.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.id.localeCompare(b.id));
  return items;
}

function collectCancellationRegistrations() {
  const items = [];
  const re = /\bcontexts\.cancellation\.register\s*\(/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (let m; (m = re.exec(source));) {
      const open = source.indexOf('(', m.index);
      const close = findMatching(source, open, '(', ')');
      if (close < 0) continue;
      let firstArg = open + 1;
      while (/\s/.test(source[firstArg] ?? '')) firstArg++;
      const objectEnd = source[firstArg] === '{' ? findMatching(source, firstArg, '{', '}') : close;
      const body = source.slice(firstArg, objectEnd + 1);
      if (!/\bactive\s*:/.test(body) || !/\bcancel\s*:/.test(body)) continue;
      items.push({ rel: rel(file), line: lineNumber(source, m.index), body });
      re.lastIndex = close + 1;
    }
  }
  return items;
}

function commandUiSourceFiles() {
  return [...new Set(collectCommandUi().map(item => item.file))];
}

function renderCommandUi(items) {
  let lastRel = null;
  const blocks = items.map(item => {
    const header = item.rel !== lastRel ? `  // ── ${item.rel} ──\n` : '';
    lastRel = item.rel;
    return `${header}  ${item.body.trimEnd()},`;
  });
  return [
    '// @ts-nocheck — @walker-projection command-ui v2.',
    '// Editable view over contribute({ surface, command, ... }) affordance objects.',
    '// Edit an object, then: node walker/projections.mjs sync command-ui  (routes by command).',
    "import type { SystemAffordance } from '../../v2/types';",
    '',
    'export const commandUi: SystemAffordance[] = [',
    ...blocks,
    '];',
    '',
  ].join('\n');
}

function generateCommandUi({ quiet = false } = {}) {
  const def = selectProjection('command-ui');
  writeProjection(def, def.render(), quiet);
}

function syncCommandUi({ quiet = false } = {}) {
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
    if (nextSource !== source) {
      writeFileSync(file, nextSource);
      changedFiles++;
    }
  }
  if (!quiet) console.log(`synced ${changedBlocks} command UI contribution(s)${added ? ` (+${added} new)` : ''} into ${changedFiles} source file(s)`);
}

function projectionStatus(def) {
  const outExists = existsSync(def.outFile);
  const stale = !outExists || readFileSync(def.outFile, 'utf8') !== def.render();
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

function filterProjectionText(text, filter) {
  const needle = String(filter ?? '').trim().toLowerCase();
  if (!needle) return text;
  const chunks = text.includes('\n// BEGIN ')
    ? text.split(/\n(?=\/\/ BEGIN )/)              // marker view (command-ui)
    : /\nexport const \w+/.test(text)
      ? text.split(/\n(?=  (?:\/\/|\{))/)          // compilable array view (commands): chunk per element / file header
      : /\ninterface \w+\s*\{/.test(text)
        ? text.split(/\n(?=\s*(?:\/\/ ──|['"]))/)  // compilable interface view (events): chunk per decl / file header
        : text.split(/\n(?=## )/);                 // markdown view (flows)
  const header = chunks.shift() ?? '';
  const hits = chunks.filter(chunk => chunk.toLowerCase().includes(needle));
  if (hits.length) return [header.trimEnd(), ...hits.map(hit => hit.trimEnd())].join('\n\n') + '\n';
  const lines = text.split('\n').filter(line => line.toLowerCase().includes(needle));
  return lines.length ? lines.join('\n') + '\n' : `no projection matches for: ${filter}\n`;
}

function showProjection(def, filter) {
  console.log(filterProjectionText(def.render(), filter).trimEnd());
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
  node walker/projections.mjs show [commands|events|flows|command-ui|data|render] [filter]
  node walker/projections.mjs generate [commands|events|flows|command-ui|data|render]
  node walker/projections.mjs sync [commands|events|command-ui|render]
  node walker/projections.mjs watch [commands|events|flows|command-ui|data|render]

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
  if (cmd === 'concept') return console.log(renderConcept(argv.slice(1).join(' ')));
  if (cmd === 'show') return showProjection(selectProjection(name ?? 'commands'), argv.slice(2).join(' '));
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
