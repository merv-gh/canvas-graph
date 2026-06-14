import { readFileSync } from 'node:fs';
import {
  EVENTS_VIEW,
  findMatching,
  lineBounds,
  lineNumber,
  listSourceFiles,
  rel,
  writeProjection,
} from '../shared.mjs';

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

export function collectEventDecls() {
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

export function eventSourceFiles() {
  return [...new Set(collectEventDecls().map(decl => decl.file))];
}

export function renderEvents(decls) {
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
    "// @ts-nocheck — @dx-projection events frontend. Source declares these in `declare module '../types'`.",
    '// Edit a type below, then: node dx/projections/projections.mjs sync events  (routes by event name).',
    '',
    ...blocks,
  ].join('\n');
}

export function generateEvents({ quiet = false } = {}) {
  const def = {
    name: 'events',
    outFile: EVENTS_VIEW,
    render: () => renderEvents(collectEventDecls()),
    count: () => collectEventDecls().length,
  };
  writeProjection(def, def.render(), quiet);
}
