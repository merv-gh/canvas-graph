#!/usr/bin/env node
/**
 * loc-tree — pretty-print a tree of lines-of-code and size, ordered by share.
 *
 * - Counts every file (code, docs, data, media — binaries contribute KB only).
 * - Respects .gitignore by default (via `git ls-files --exclude-standard`;
 *   outside a git repo, walks everything). `--all` includes ignored files.
 * - Directories and files below --threshold percent of the total are omitted
 *   (their bytes/lines still roll up into parent totals).
 *
 * Usage: node loc-tree.mjs [root] [--all] [--threshold=1] [--depth=6]
 *
 * Zero dependencies. Requires git for ignore semantics (optional).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const INCLUDE_IGNORED = args.includes('--all');
const THRESHOLD = Number(flag('threshold', 1));
const DEPTH = Number(flag('depth', 6));
const ROOT = args.find(a => !a.startsWith('--')) || '.';

function listFiles() {
  if (!INCLUDE_IGNORED) {
    try {
      const out = execFileSync(
        'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      );
      return out.split('\n').filter(Boolean);
    } catch { /* not a git repo — fall through to plain walk */ }
  }
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(ROOT, path));
    }
  })(ROOT);
  return files;
}

function measure(path) {
  const buffer = readFileSync(path);
  const probe = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (probe.includes(0)) return { lines: 0, bytes: buffer.length, binary: true };
  let lines = 1;
  for (let i = 0; i < buffer.length; i++) if (buffer[i] === 10) lines++;
  if (buffer.length && buffer[buffer.length - 1] === 10) lines--;
  return { lines, bytes: buffer.length, binary: false };
}

const tree = { name: '.', lines: 0, bytes: 0, files: 0, dirs: new Map(), leafs: [] };
for (const rel of listFiles()) {
  let measured;
  try { measured = measure(join(ROOT, rel)); } catch { continue; }
  const parts = rel.split(sep);
  let node = tree;
  node.lines += measured.lines; node.bytes += measured.bytes; node.files++;
  for (const dir of parts.slice(0, -1)) {
    if (!node.dirs.has(dir)) node.dirs.set(dir, { name: dir, lines: 0, bytes: 0, files: 0, dirs: new Map(), leafs: [] });
    node = node.dirs.get(dir);
    node.lines += measured.lines; node.bytes += measured.bytes; node.files++;
  }
  node.leafs.push({ name: parts.at(-1), ...measured });
}

const totalLines = tree.lines || 1;
const totalBytes = tree.bytes || 1;
const formatInteger = number => number.toLocaleString('en-US');
const formatSize = bytes => bytes >= 1024 * 1024
  ? `${(bytes / 1048576).toFixed(1)} MB`
  : `${(bytes / 1024).toFixed(1)} KB`;
const percentage = node => Math.max(
  (node.lines / totalLines) * 100,
  (node.bytes / totalBytes) * 100,
);
const isVisible = node => percentage(node) >= THRESHOLD;

function entries(node) {
  return [
    ...[...node.dirs.values()].map(child => ({ node: child, dir: true })),
    ...node.leafs.map(child => ({ node: child, dir: false })),
  ]
    .map(entry => ({ ...entry, shown: entry.dir ? isVisible(entry.node) : percentage(entry.node) >= THRESHOLD }))
    .sort((a, b) => percentage(b.node) - percentage(a.node));
}

const output = [];
function label(entry) {
  const node = entry.node;
  const share = percentage(node).toFixed(1).padStart(5);
  const loc = node.binary ? '     —' : formatInteger(node.lines).padStart(7);
  const suffix = entry.dir ? `${formatInteger(node.files)} files` : (node.binary ? 'binary' : '');
  return `${share}%  ${loc} LOC  ${formatSize(node.bytes).padStart(9)}  ${suffix}`;
}

function render(node, prefix, depth) {
  if (depth > DEPTH) return;
  const children = entries(node);
  const shown = children.filter(child => child.shown);
  const hidden = children.filter(child => !child.shown);
  const rows = [...shown];
  if (hidden.length) {
    const lines = hidden.reduce((sum, child) => sum + child.node.lines, 0);
    const bytes = hidden.reduce((sum, child) => sum + child.node.bytes, 0);
    const files = hidden.reduce((sum, child) => sum + (child.dir ? child.node.files : 1), 0);
    rows.push({
      node: { name: `… ${hidden.length} entr${hidden.length === 1 ? 'y' : 'ies'} < ${THRESHOLD}% (${files} file${files === 1 ? '' : 's'})`, lines, bytes },
      dir: false,
      ellipsis: true,
    });
  }
  rows.forEach((entry, index) => {
    const last = index === rows.length - 1;
    const name = entry.dir ? `${entry.node.name}/` : entry.node.name;
    output.push(`${prefix}${last ? '└── ' : '├── '}${entry.ellipsis ? name : name.padEnd(38)}${entry.ellipsis ? '' : label(entry)}`);
    if (entry.dir) render(entry.node, prefix + (last ? '    ' : '│   '), depth + 1);
  });
}

output.push(`${ROOT === '.' ? '.' : ROOT}  100.0%  ${formatInteger(tree.lines)} LOC  ${formatSize(tree.bytes)}  ${formatInteger(tree.files)} files${INCLUDE_IGNORED ? '  (including gitignored)' : ''}`);
render(tree, '', 1);
console.log(output.join('\n'));
