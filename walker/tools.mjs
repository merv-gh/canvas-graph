// Tool implementations with TDD phase guards. Every tool returns a short string
// (pre-trimmed by the loop). Guards are mechanical: RED writes only under
// tests/commands/walker/, GREEN writes only under v2/. No shell tool exists.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

const DENY = /node_modules|\.git\//;

export class Tools {
  constructor({ ws, browser, log }) {
    this.ws = ws;
    this.browser = browser;
    this.log = log;
    this.phase = 'red';
    this.taskTestPath = null;   // pinned after RED accepts
  }

  safePath(p) {
    const abs = resolve(this.ws.dir, p);
    const rel = relative(this.ws.dir, abs);
    if (rel.startsWith('..') || DENY.test(rel)) throw new Error(`path not allowed: ${p}`);
    return { abs, rel };
  }

  writeAllowed(rel) {
    if (this.phase === 'red') return rel.startsWith('tests/commands/walker/');
    if (this.phase === 'green') return rel.startsWith('v2/');
    return false;
  }

  async dispatch(name, args) {
    const fn = this[`tool_${name}`];
    if (!fn) return `unknown tool: ${name}`;
    try { return await fn.call(this, args ?? {}); }
    catch (err) { return `error: ${err.message}`; }
  }

  tool_read({ path, from = 1, lines = 60 }) {
    const { abs } = this.safePath(path);
    if (!existsSync(abs)) return `no such file: ${path}`;
    const all = readFileSync(abs, 'utf8').split('\n');
    const start = Math.max(1, from | 0);
    const slice = all.slice(start - 1, start - 1 + Math.min(lines, 120));
    const body = slice.map((l, i) => `${start + i}|${l}`).join('\n');
    return `${path} (${all.length} lines total)\n${body}`;
  }

  tool_search({ pattern, dir = '' }) {
    const { rel } = dir ? this.safePath(dir) : { rel: '.' };
    // git grep: always available, tracked files only (no node_modules), ERE.
    const res = this.ws.run('git', ['grep', '-nE', '-I', pattern, '--', rel || '.'], 20000);
    if (!res.output.trim()) return `no matches for: ${pattern}`;
    const lines = res.output.split('\n').filter(Boolean).map(l => l.slice(0, 180));
    return lines.slice(0, 14).join('\n') + (lines.length > 14 ? `\n…${lines.length - 14} more` : '');
  }

  tool_edit({ path, old, new: next }) {
    if (old == null || next == null) return 'edit needs OLD and NEW: send the JSON head, then TWO fenced code blocks (first = exact old text, second = new text)';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return `phase ${this.phase}: writing ${rel} is not allowed (red→tests/commands/walker/, green→v2/)`;
    if (!existsSync(abs)) return `no such file: ${path}`;
    const src = readFileSync(abs, 'utf8');
    const count = src.split(old).length - 1;
    if (count === 0) {
      // Fuzzy hint: small models paraphrase the old text from memory. Point
      // them at the closest real line so the next edit converges.
      const want = old.split('\n').find(l => l.trim()) ?? '';
      const tokens = new Set(want.split(/\W+/).filter(t => t.length > 2));
      let best = '', bestScore = 0, bestLine = 0;
      src.split('\n').forEach((line, i) => {
        const score = line.split(/\W+/).filter(t => tokens.has(t)).length;
        if (score > bestScore) { bestScore = score; best = line; bestLine = i + 1; }
      });
      const hint = bestScore > 1 ? ` Closest actual line ${bestLine}: \`${best.trim().slice(0, 140)}\` — copy text EXACTLY from read().` : ' Use read() and copy the exact text.';
      return `old text not found in ${path}.${hint}`;
    }
    if (count > 1) return `old text matches ${count} times in ${path} — include more surrounding lines`;
    writeFileSync(abs, src.replace(old, next));
    this.log(`[tool] edit ${rel} (${old.length}→${next.length} chars)`);
    return `edited ${rel}`;
  }

  tool_write({ path, content }) {
    if (content == null) return 'write needs content: send the JSON head, then the ENTIRE file in one fenced code block';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return `phase ${this.phase}: writing ${rel} is not allowed (red→tests/commands/walker/, green→v2/)`;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    this.log(`[tool] write ${rel} (${content.length} chars)`);
    return `wrote ${rel} (${content.split('\n').length} lines)`;
  }

  tool_run_test({ path }) {
    // No path = "my task test". The full suite is the harness's job (VERIFY);
    // letting the model run it in RED only misleads it — a green suite says
    // nothing about an untested bug.
    const target = path ?? this.taskTestPath ?? this.defaultTestPath;
    if (!target) return 'no test path: write your test first, then run_test it';
    const { rel } = this.safePath(target);
    if (!existsSync(join(this.ws.dir, rel))) return `no test at ${rel} — write it first`;
    const res = this.ws.vitest(rel);
    if (!res.ran) return `CRASH (test never ran — fix syntax/imports)\n${res.output}`;
    return `${res.ok ? 'PASS' : 'FAIL'}\n${res.output}`;
  }

  async tool_app({ action, arg = '' }) {
    if (!this.browser) return 'app tools unavailable (no browser session)';
    await this.browser.fresh();
    if (action === 'command') {
      const r = await this.browser.runCommand(arg);
      const snap = await this.browser.snapshot('ui');
      return `ran=${r.ran}\nui after: ${JSON.stringify(snap).slice(0, 700)}`;
    }
    if (action === 'snapshot') return JSON.stringify(await this.browser.snapshot(arg), null, 1);
    if (action === 'eval') return String(await this.browser.evalJs(arg));
    if (action === 'screenshot') {
      const { summary } = await this.browser.screenshot(this.phase);
      return summary;
    }
    return `unknown app action: ${action}`;
  }

  tool_note() { return 'noted'; }       // loop persists notes; this is just the ack
  tool_done() { return 'phase check running…'; }
  tool_give_up() { return 'giving up'; }
}
