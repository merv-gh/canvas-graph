import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  MAIN_TS,
  RENDER_VIEW,
  SNAPSHOT_TS,
  STYLES_CSS,
  findMatching,
  rel,
} from '../shared.mjs';
import { cssRuleRanges, kebab, quoteString } from '../file-to-projection/render.mjs';

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

export function syncRender({ quiet = false } = {}) {
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
