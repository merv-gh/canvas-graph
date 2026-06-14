import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DX_ROOT = resolve(HERE, '..');
export const REPO = resolve(process.env.DX_PROJECTION_ROOT ?? resolve(DX_ROOT, '..'));
export const SOURCE_ROOT = join(REPO, 'frontend');
export const VIEWS_DIR = join(REPO, 'views');

export const COMMANDS_VIEW = join(VIEWS_DIR, 'commands.proj.ts');
export const EVENTS_VIEW = join(VIEWS_DIR, 'events.proj.ts');
export const FLOWS_VIEW = join(VIEWS_DIR, 'flows.proj.md');
export const COMMAND_UI_VIEW = join(VIEWS_DIR, 'command-ui.proj.ts');
export const DATA_VIEW = join(VIEWS_DIR, 'data.proj.md');
export const RENDER_VIEW = join(VIEWS_DIR, 'render.proj.md');

export const MAIN_TS = join(SOURCE_ROOT, 'systems/main.ts');
export const SNAPSHOT_TS = join(SOURCE_ROOT, 'core/snapshot.ts');
export const STYLES_CSS = join(SOURCE_ROOT, 'styles.css');

export function rel(path) {
  return relative(REPO, path).replaceAll('\\', '/');
}

export function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path && !path.startsWith('..') && !path.startsWith('/'));
}

export function sourcePathFromMarker(file) {
  const path = resolve(REPO, file);
  if (!isInside(SOURCE_ROOT, path)) throw new Error(`projection marker points outside frontend/: ${file}`);
  if (!existsSync(path)) throw new Error(`projection marker points at missing file: ${file}`);
  return path;
}

export function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

export function listSourceFiles(dir = SOURCE_ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

export function findMatching(source, openIndex, openChar, closeChar) {
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

export function includeTrailingComma(source, endBrace) {
  let i = endBrace + 1;
  while (/\s/.test(source[i] ?? '')) i++;
  return source[i] === ',' ? i + 1 : endBrace + 1;
}

export function lineBounds(source, index) {
  const start = source.lastIndexOf('\n', index) + 1;
  const endRaw = source.indexOf('\n', index);
  const end = endRaw < 0 ? source.length : endRaw;
  return { start, end };
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function ensureViewDir() {
  mkdirSync(VIEWS_DIR, { recursive: true });
}

export function writeProjection(def, text, quiet) {
  ensureViewDir();
  if (!existsSync(def.outFile) || readFileSync(def.outFile, 'utf8') !== text) {
    writeFileSync(def.outFile, text);
  }
  if (!quiet) console.log(`generated ${rel(def.outFile)} (${def.count()} slice(s))`);
}

// Dry-run write guard for the views-only dogfood. With it on, sync computes the
// source edits exactly as usual but writes NOTHING — every would-be write is
// recorded instead. That lets a big model (or human) edit only views/ and see
// whether a whole feature is expressible as view edits (clean source diff) or
// hits a wall (a routing error = the view layer can't yet express it). All four
// editable sync modules route their final write through writeChanged().
let DRY_RUN = false;
const dryRunLedger = [];

export function setDryRun(on) {
  DRY_RUN = Boolean(on);
  if (DRY_RUN) dryRunLedger.length = 0;
}

export function isDryRun() {
  return DRY_RUN;
}

export function takeDryRunLedger() {
  return dryRunLedger.splice(0);
}

export function writeChanged(file, next) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current === next) return false;
  if (DRY_RUN) {
    dryRunLedger.push({ file, before: current, after: next });
    return true;
  }
  writeFileSync(file, next);
  return true;
}
