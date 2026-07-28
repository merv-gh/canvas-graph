import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const readTools = {
tool_read({ path, from = 1, lines = 60 }) {
    const { abs } = this.safePath(path);
    if (!existsSync(abs)) return `no such file: ${path}`;
    const all = readFileSync(abs, 'utf8').split('\n');
    const start = Math.max(1, from | 0);
    const want = Math.min(lines, 120);
    // Trim at LINE boundaries within the char budget, and say exactly how to
    // continue — mid-file truncation made models edit text they never saw.
    const budget = 2400;
    const out = [];
    let used = 0, i = start - 1;
    for (; i < all.length && out.length < want; i++) {
      const line = `${i + 1}|${all[i]}`;
      if (used + line.length > budget && out.length) break;
      out.push(line); used += line.length + 1;
    }
    const shownTo = start - 1 + out.length;
    const more = shownTo < all.length ? `\n…continue with read {"path":"${path}","from":${shownTo + 1}}` : '';
    return `${path} lines ${start}-${shownTo} of ${all.length}\n${out.join('\n')}${more}`;
  },

tool_search({ pattern, dir = '' }) {
    const { rel } = dir ? this.safePath(dir) : { rel: '.' };
    // git grep: always available, tracked files only (no node_modules), ERE.
    const res = this.ws.run('git', ['grep', '-nE', '-I', pattern, '--', rel || '.'], 20000);
    if (!res.output.trim()) return `no matches for: ${pattern}`;
    const lines = res.output.split('\n').filter(Boolean).map(l => l.slice(0, 180));
    return lines.slice(0, 14).join('\n') + (lines.length > 14 ? `\n…${lines.length - 14} more` : '');
  },

tool_locate({ anchor, dir = 'frontend' }) {
    const { rel } = this.safePath(dir);
    const res = this.ws.run('git', ['grep', '-nF', '-I', anchor, '--', rel], 20000);
    if (!res.output.trim()) return `no matches for: ${anchor}`;
    const hits = res.output.split('\n').filter(Boolean).slice(0, 4);
    const blocks = hits.map(hit => {
      const m = hit.match(/^([^:]+):(\d+):/);
      if (!m) return hit.slice(0, 160);
      const [, file, lineStr] = m;
      const n = Number(lineStr);
      const all = readFileSync(join(this.ws.dir, file), 'utf8').split('\n');
      const from = Math.max(0, n - 2);
      const ctx = all.slice(from, n + 1).map((l, i) => `${from + 1 + i}|${l}`).join('\n');
      return `${file}:\n${ctx}`;
    });
    return blocks.join('\n---\n') + '\n(use these LINE NUMBERS with patch, or copy text EXACTLY for edit)';
  },

tool_projection({ name = 'commands', filter = '' }) {
    const script = join(this.ws.repoRoot, 'dx/projections/projections.mjs');
    try {
      const output = execFileSync(process.execPath, [script, 'show', name, filter].filter(Boolean), {
        cwd: this.ws.dir,
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, DX_PROJECTION_ROOT: this.ws.dir },
        maxBuffer: 1024 * 1024,
      });
      const lines = output.trimEnd().split('\n');
      const capped = lines.slice(0, 120).join('\n');
      const more = lines.length > 120 ? `\n…${lines.length - 120} more lines; call projection with a narrower filter` : '';
      const hint = name === 'commands'
        ? '\nHint: for event-driven behavior, call projection {"name":"flows","filter":"<event or domain>"} to see handlers and downstream emits.'
        : name === 'flows'
          ? '\nHint: next read/patch the handler file:line shown above; do not call more projections unless the event is missing.'
          : name === 'render'
            ? '\nHint: render owns shell fold dataset mirrors, ui.shell snapshot fields, and CSS rules. Use it for panel collapse visibility wiring.'
        : '';
      return `${name} projection${filter ? ` filtered by '${filter}'` : ''}:\n${capped}${more}${hint}`;
    } catch (err) {
      return `projection failed: ${err.stderr || err.message}`;
    }
  }
};

