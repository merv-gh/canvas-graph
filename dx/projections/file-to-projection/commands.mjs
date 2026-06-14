import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  COMMANDS_VIEW,
  ensureViewDir,
  findMatching,
  includeTrailingComma,
  lineNumber,
  listSourceFiles,
  rel,
} from '../shared.mjs';

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

export function collectCommands() {
  const commands = [];
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    commands.push(...extractCommandsFromSource(source, file));
  }
  commands.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.id.localeCompare(b.id));
  return commands;
}

export function commandSourceFiles() {
  return [...new Set(collectCommands().map(command => command.file))];
}

export function renderCommands(commands) {
  let lastRel = null;
  const elements = commands.map(command => {
    const body = `${command.text.trimEnd().replace(/,\s*$/, '')},`;
    const header = command.rel !== lastRel ? `  // ── ${command.rel} ──\n` : '';
    lastRel = command.rel;
    return `${header}  ${body}`;
  });
  return [
    '// @ts-nocheck — @dx-projection commands frontend. Source files still own these slices.',
    '// Edit a field below, then: node dx/projections/projections.mjs sync commands  (routes by id).',
    "import type { CommandSpec } from '../frontend/types';",
    '',
    'export const commands: CommandSpec[] = [',
    ...elements,
    '];',
    '',
  ].join('\n');
}

export function generateCommands({ quiet = false } = {}) {
  ensureViewDir();
  const commands = collectCommands();
  const next = renderCommands(commands);
  if (!existsSync(COMMANDS_VIEW) || readFileSync(COMMANDS_VIEW, 'utf8') !== next) {
    writeFileSync(COMMANDS_VIEW, next);
  }
  if (!quiet) console.log(`generated ${rel(COMMANDS_VIEW)} (${commands.length} command slices)`);
  return commands.length;
}
