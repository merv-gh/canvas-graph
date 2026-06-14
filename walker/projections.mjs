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

  const byFile = new Map();
  for (const block of blocks) {
    const found = index.get(block.id);
    if (!found) {
      // Likely a rename: the id was edited, so its old slice is now un-projected.
      const orphans = [...index.keys()].filter(id => !projectionIds.has(id));
      const hint = orphans.length
        ? ` Source still has un-projected command(s): ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ', …' : ''}. If you renamed an id, sync won't auto-rename (other references — events, tests, paletteCommand — would dangle); do renames with refactor_tool, then regenerate.`
        : '';
      throw new Error(`command '${block.id}' is not in any source file. Add new commands with the add_command tool (it splices into the right register([…]) and declares the event); the projection only edits existing slices.${hint}`);
    }
    let next = block.body.trimEnd();
    if (found.text.trimEnd().endsWith(',') && !next.endsWith(',')) next += ',';
    if (!byFile.has(found.file)) byFile.set(found.file, []);
    byFile.get(found.file).push({ ...found, next });
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

  if (!quiet) console.log(`synced ${changedBlocks} command slice(s) into ${changedFiles} source file(s)`);
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

function extractEmits(text) {
  const emits = [];
  const re = /\b(?:emit|bus\.emit)\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (let m; (m = re.exec(text));) emits.push(m[2]);
  // The fold context owns the actual fact emit in v2/core/fold.ts. Most systems
  // call the context, not `emit('fold.changed')`, so bridge that known seam.
  if (/\bcontexts\.fold\.(?:toggle|set)\s*\(/.test(text)) emits.push('fold.changed');
  return unique(emits);
}

function collectEventHandlers() {
  const handlers = [];
  const re = /\bon\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (let m; (m = re.exec(source));) {
      const open = source.indexOf('(', m.index);
      const close = findMatching(source, open, '(', ')');
      if (close < 0) continue;
      const text = source.slice(m.index, close + 1);
      handlers.push({
        event: m[2],
        file,
        rel: rel(file),
        line: lineNumber(source, m.index),
        emits: extractEmits(text),
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

function renderFlowEvent(lines, data, event, depth, seen) {
  const pad = '  '.repeat(depth);
  const handlers = data.handlersByEvent.get(event) ?? [];
  if (!handlers.length) {
    lines.push(`${pad}- ${event} -> no static handlers`);
    return;
  }
  lines.push(`${pad}- ${event}`);
  for (const handler of handlers) {
    const emits = handler.emits.length ? handler.emits.join(', ') : '-';
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
    'Read-only static streams: origin event -> listeners in source order -> emitted downstream events.',
    'Use this to see cross-system behavior without opening every handler.',
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
  const byFile = new Map();
  for (const block of blocks) {
    const found = collectCommandUi().find(item => item.id === block.id);
    if (!found) throw new Error(`could not find command UI contribution ${block.id} in source`);
    if (!byFile.has(found.file)) byFile.set(found.file, []);
    byFile.get(found.file).push({ ...found, next: `${found.prefix}${block.body.trimEnd()}${found.suffix}` });
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
  if (!quiet) console.log(`synced ${changedBlocks} command UI contribution(s) into ${changedFiles} source file(s)`);
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
  node walker/projections.mjs show [commands|events|flows|command-ui] [filter]
  node walker/projections.mjs generate [commands|events|flows|command-ui]
  node walker/projections.mjs sync [commands|events|command-ui]
  node walker/projections.mjs watch [commands|events|flows|command-ui]

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
