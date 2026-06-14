import { readFileSync } from 'node:fs';
import {
  COMMAND_UI_VIEW,
  findMatching,
  lineNumber,
  listSourceFiles,
  rel,
  writeProjection,
} from '../shared.mjs';

export function collectCommandUi() {
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

export function collectCancellationRegistrations() {
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

export function commandUiSourceFiles() {
  return [...new Set(collectCommandUi().map(item => item.file))];
}

export function renderCommandUi(items) {
  let lastRel = null;
  const blocks = items.map(item => {
    const header = item.rel !== lastRel ? `  // ── ${item.rel} ──\n` : '';
    lastRel = item.rel;
    return `${header}  ${item.body.trimEnd()},`;
  });
  return [
    '// @ts-nocheck — @dx-projection command-ui frontend.',
    '// Editable view over contribute({ surface, command, ... }) affordance objects.',
    '// Edit an object, then: node dx/projections/projections.mjs sync command-ui  (routes by command).',
    "import type { SystemAffordance } from '../frontend/types';",
    '',
    'export const commandUi: SystemAffordance[] = [',
    ...blocks,
    '];',
    '',
  ].join('\n');
}

export function generateCommandUi({ quiet = false } = {}) {
  const def = {
    name: 'command-ui',
    outFile: COMMAND_UI_VIEW,
    render: () => renderCommandUi(collectCommandUi()),
    count: () => collectCommandUi().length,
  };
  writeProjection(def, def.render(), quiet);
}
