import { existsSync, readFileSync } from 'node:fs';
import {
  MAIN_TS,
  RENDER_VIEW,
  STYLES_CSS,
  findMatching,
  lineNumber,
  writeProjection,
} from '../shared.mjs';

export function kebab(value) {
  return String(value).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

export function quoteString(value) {
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

export function cssRuleRanges(source) {
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

export function collectShellFolds() {
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

export function renderRender(folds) {
  const lines = [
    '# @dx-projection render frontend',
    '',
    'Editable shell fold render wiring. Each block syncs:',
    '- frontend/systems/main.ts dataset mirror + fold.changed guard',
    '- frontend/core/snapshot.ts ui.shell mirror',
    '- frontend/styles.css shell CSS rules',
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

export function generateRender({ quiet = false } = {}) {
  const def = {
    name: 'render',
    outFile: RENDER_VIEW,
    render: () => renderRender(collectShellFolds()),
    count: () => collectShellFolds().length,
  };
  writeProjection(def, def.render(), quiet);
}
