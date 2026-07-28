import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const workspaceTools = {
phaseDenied(rel) {
    if (this.phase === 'red') return `phase red: writing ${rel} not allowed — RED only writes tests/commands/dx/. If your red test already FAILS, just run_test it; the harness advances you to GREEN automatically.`;
    return `phase ${this.phase}: writing ${rel} is not allowed (green→frontend/ only)`;
  },

tool_edit({ path, old, new: next }) {
    if (old == null || next == null) return 'edit needs OLD and NEW: send the JSON head, then TWO fenced code blocks (first = exact old text, second = new text)';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${path}`;
    const src = readFileSync(abs, 'utf8');
    const count = src.split(old).length - 1;
    if (count === 0) {
      // Fuzzy hint: small models paraphrase the old text from memory. Point
      // them at the closest real line so the next edit converges.
      const want = old.split('\n').find(l => l.trim()) ?? '';
      const tokens = new Set(want.split(/\W+/).filter(t => t.length > 2));
      const srcLines = src.split('\n');
      let bestScore = 0, bestLine = 0;
      srcLines.forEach((line, i) => {
        const score = line.split(/\W+/).filter(t => tokens.has(t)).length;
        if (score > bestScore) { bestScore = score; bestLine = i; }
      });
      if (bestScore <= 1) return `old text not found in ${path}. read() the file and copy the exact text, or use patch with line numbers.`;
      // Hand back verbatim, copy-paste-ready context so the next edit converges.
      const ctxLines = srcLines.slice(Math.max(0, bestLine - 1), bestLine + 2).join('\n');
      return `old text not found in ${path} — the file's ACTUAL line ${bestLine + 1} area is:\n\`\`\`\n${ctxLines}\n\`\`\`\nEasier: patch {"path":"${path}","op":"replace","line":${bestLine + 1}} + fenced new text (no old text needed).`;
    }
    if (count > 1) return `old text matches ${count} times in ${path} — include more surrounding lines`;
    writeFileSync(abs, src.replace(old, next));
    this.log(`[tool] edit ${rel} (${old.length}→${next.length} chars)`);
    return `edited ${rel}`;
  },

tool_patch({ path, op, line, count = 1, text }) {
    if (text == null) return 'patch needs text: send the JSON head, then the new line(s) in ONE fenced code block';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${path}`;
    const all = readFileSync(abs, 'utf8').split('\n');
    const at = (line | 0) - 1;
    if (at < 0 || at >= all.length) return `line ${line} out of range (file has ${all.length} lines)`;
    if (rel.endsWith('.css') && op === 'insert_after' && /\{/.test(String(text))) {
      const before = all.slice(0, at + 1).join('\n');
      const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      if (depth > 0) {
        return `line ${line} is inside an open CSS block. Inserting a selector there creates nested/invalid CSS. For styling tasks use add_css_rule {"selector":"...","declarations":{...},"after":"..."} or locate an existing selector and patch outside the block.`;
      }
    }
    if (this.phase === 'green' && /\bid\s*:\s*['"][\w.]+['"]/.test(String(text)) && /\b(shortcut|input|group|hidden|event|label)\b/.test(String(text))) {
      const ids = [...String(text).matchAll(/\bid\s*:\s*['"]([\w.]+)['"]/g)].map(m => m[1]);
      const unique = [...new Set(ids)];
      return [
        `This patch payload looks like command specs (${unique.join(', ') || 'unknown id'}).`,
        'Do not patch command register arrays by hand; it often breaks the wrapper syntax.',
        unique.length === 1
          ? `Existing command props: use set_command {"id":"${unique[0]}","props":{...}}. New command: use add_command.`
          : `For existing command props, call set_command once per id. New command: use add_command.`,
      ].join('\n');
    }
    // Teach tool-selection at the point of the mistake: patching command props
    // into a command-spec line is the wrong move — set_command does it cleanly
    // and keeps the array valid. (Observed: weak models reach for insert_after here.)
    const idMatch = all[at]?.match(/id:\s*['"]([\w.]+)['"]/);
    if (idMatch && /\b(shortcut|input|group|hidden)\b/.test(String(text)) && this.phase === 'green') {
      return `line ${line} is the command spec for '${idMatch[1]}'. Don't patch props into the register array — use set_command {"id":"${idMatch[1]}","props":{…}} (it injects shortcut/input/group correctly).`;
    }
    const newLines = String(text).replace(/\n$/, '').split('\n');
    if (op === 'replace') all.splice(at, Math.max(1, count | 0), ...newLines);
    else if (op === 'insert_after') all.splice(at + 1, 0, ...newLines);
    else return `unknown op ${op} (replace | insert_after)`;
    writeFileSync(abs, all.join('\n'));
    const from = Math.max(0, at - 1);
    const ctx = all.slice(from, at + newLines.length + 1).map((l, i) => `${from + 1 + i}|${l}`).join('\n');
    this.log(`[tool] patch ${rel} ${op}@${line}`);
    return `patched ${rel}. Result around line ${line}:\n${ctx}`;
  },

tool_write({ path, content }) {
    if (content == null) return 'write needs content: send the JSON head, then the ENTIRE file in one fenced code block';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    this.log(`[tool] write ${rel} (${content.length} chars)`);
    return `wrote ${rel} (${content.split('\n').length} lines)`;
  },

async tool_run_test({ path }) {
    // No path = "my task test". The full suite is the harness's job (VERIFY);
    // letting the model run it in RED only misleads it — a green suite says
    // nothing about an untested bug.
    const target = path ?? this.taskTestPath ?? this.defaultTestPath;
    if (!target) return 'no test path: write your test first, then run_test it';
    const { rel } = this.safePath(target);
    if (!existsSync(join(this.ws.dir, rel))) return `no test at ${rel} — write it first`;
    // Layout/focus specs run through the live browser oracle, not vitest.
    if (rel.endsWith('.layout.json')) return this.runLayoutSpec(rel);
    const res = this.ws.vitest(rel);
    // The loop reads this to auto-advance phases on evidence (models forget done()).
    this.lastRun = { rel, ok: res.ok, ran: res.ran, testsRan: res.testsRan };
    if (!res.ran || !res.testsRan) return `CRASH (no test executed — fix syntax/imports)\n${res.output}`;
    return `${res.ok ? 'PASS' : 'FAIL'}\n${res.output}`;
  },

async runLayoutSpec(rel) {
    if (!this.browser) { this.lastRun = { rel, ok: false, ran: false, testsRan: false }; return 'layout oracle unavailable (no browser session)'; }
    let spec;
    try { spec = JSON.parse(readFileSync(join(this.ws.dir, rel), 'utf8')); }
    catch (err) { this.lastRun = { rel, ok: false, ran: false, testsRan: false }; return `layout spec is not valid JSON: ${err.message}`; }
    await this.browser.fresh();
    const { pass, results } = await this.browser.probe(spec);
    this.lastRun = { rel, ok: pass, ran: true, testsRan: true };
    const lines = results.map(r => `${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.ok ? '' : ` — actual: ${JSON.stringify(r.actual)}`}`);
    return `${pass ? 'PASS' : 'FAIL'} (layout oracle)\n${lines.join('\n')}`;
  }
};

