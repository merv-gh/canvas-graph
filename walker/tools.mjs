// Tool implementations with TDD phase guards. Every tool returns a short string
// (pre-trimmed by the loop). Guards are mechanical: RED writes only under
// tests/commands/walker/, GREEN writes only under v2/. No shell tool exists.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { genTest, runProbe } from './probe-client.mjs';
import { graphQuery } from './graphdb.mjs';
import { repairJson } from './ollama.mjs';

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
  }

  tool_search({ pattern, dir = '' }) {
    const { rel } = dir ? this.safePath(dir) : { rel: '.' };
    // git grep: always available, tracked files only (no node_modules), ERE.
    const res = this.ws.run('git', ['grep', '-nE', '-I', pattern, '--', rel || '.'], 20000);
    if (!res.output.trim()) return `no matches for: ${pattern}`;
    const lines = res.output.split('\n').filter(Boolean).map(l => l.slice(0, 180));
    return lines.slice(0, 14).join('\n') + (lines.length > 14 ? `\n…${lines.length - 14} more` : '');
  }

  /** Anchor finder: grep + verbatim numbered context, ready for patch/edit.
   *  Closes the "model paraphrases text it never saw" failure mode. */
  tool_locate({ anchor, dir = 'v2' }) {
    const { rel } = this.safePath(dir);
    const res = this.ws.run('git', ['grep', '-nE', '-I', anchor, '--', rel], 20000);
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
  }

  /** Domain constructor: inject plain-data props (shortcut, input, group, hidden,
   *  event) into an existing command spec, located by id. Commands are data in
   *  this codebase, so the literal is greppable and the injection is mechanical —
   *  the model supplies intent, not file surgery. */
  tool_set_command({ id, props }) {
    if (this.phase !== 'green') return 'set_command is GREEN-phase only (it edits v2/)';
    const parsed = this.parseSpec(props);
    if (!parsed || typeof parsed !== 'object') return 'set_command: props must be JSON, e.g. {"shortcut":"I","input":{"on":"keydown","key":"i","prevent":true}}';
    const ALLOWED = new Set(['shortcut', 'input', 'group', 'hidden', 'event']);
    const bad = Object.keys(parsed).filter(k => !ALLOWED.has(k));
    if (bad.length) return `set_command: unsupported props ${bad.join(', ')} (allowed: shortcut, input, group, hidden, event). Functions (available/payload) need edit/patch.`;
    const res = this.ws.run('git', ['grep', '-n', `id: '${id}'`, '--', 'v2'], 20000);
    const hit = res.output.split('\n').filter(Boolean)[0];
    if (!hit) return `set_command: no command literal with id '${id}' found under v2/`;
    const m = hit.match(/^([^:]+):(\d+):/);
    const file = m[1], lineNo = Number(m[2]);
    const abs = join(this.ws.dir, file);
    const all = readFileSync(abs, 'utf8').split('\n');
    const line = all[lineNo - 1];
    const already = Object.keys(parsed).filter(k => new RegExp(`\\b${k}\\s*:`).test(line));
    if (already.length) return `set_command: '${id}' already sets ${already.join(', ')} on line ${lineNo}: ${line.trim()}`;
    const js = (v) => {
      if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`;
      if (v && typeof v === 'object' && !Array.isArray(v)) return `{ ${Object.entries(v).map(([k, val]) => `${k}: ${js(val)}`).join(', ')} }`;
      return JSON.stringify(v);
    };
    const propsCode = Object.entries(parsed).map(([k, v]) => `${k}: ${js(v)}`).join(', ');
    const closing = line.match(/^(.*?)(\s*\}\s*,?\s*\)?;?\s*)$/);
    if (closing && line.includes('{')) {
      // Single-line spec: …, <props> }
      const head = closing[1].replace(/,\s*$/, '');
      all[lineNo - 1] = `${head}, ${propsCode}${closing[2]}`;
    } else {
      // Multi-line spec: add an indented property line right after the id line.
      const indent = (line.match(/^\s*/) ?? [''])[0];
      all.splice(lineNo, 0, `${indent}${propsCode},`);
    }
    writeFileSync(abs, all.join('\n'));
    this.log(`[tool] set_command ${id} += ${Object.keys(parsed).join(',')}`);
    const from = Math.max(0, lineNo - 2);
    return `updated ${file}:\n${all.slice(from, lineNo + 1).map((l, i) => `${from + 1 + i}|${l}`).join('\n')}\nNow run_test to confirm.`;
  }

  /** Serialize a JSON object to a TS object literal. String values that look
   *  like arrow functions are emitted RAW (so `available: "() => !!sel()"` becomes
   *  real code); everything else is quoted/recursed. */
  serializeObject(obj) {
    const val = (v) => {
      if (typeof v === 'string') return /=>/.test(v) || /^\(.*\)\s*=>/.test(v) ? v : `'${v.replace(/'/g, "\\'")}'`;
      if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
      if (v && typeof v === 'object') return this.serializeObject(v);
      return JSON.stringify(v);
    };
    return `{ ${Object.entries(obj).map(([k, v]) => `${k}: ${val(v)}`).join(', ')} }`;
  }

  /** Constructor for a NEW command (the missing half of new-verb feature tasks):
   *  splice a command spec into a system's `commands.register([...])` array and,
   *  if given, an `on(event, handler)` right after it. Mechanical placement; the
   *  model supplies the handler logic (or omits it and patches separately). */
  tool_add_command({ system, spec, handler }) {
    if (this.phase !== 'green') return 'add_command is GREEN-phase only (it edits v2/)';
    const parsedSpec = this.parseSpec(spec);
    if (!parsedSpec || !parsedSpec.id) return 'add_command: spec must include at least {id, label}, e.g. {"id":"graph.edge.reverse","label":"Reverse edge","group":"edge"}';
    const { abs, rel } = this.safePath(system);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${system}`;
    const src = readFileSync(abs, 'utf8');
    if (new RegExp(`id:\\s*['"]${parsedSpec.id.replace(/[.]/g, '\\.')}['"]`).test(src)) {
      return `add_command: '${parsedSpec.id}' already exists — use set_command to modify it`;
    }
    const event = parsedSpec.event || parsedSpec.id;
    let lines = src.split('\n');
    const findReg = (ls) => ls.findIndex(l => /commands\.register\(\[/.test(l));
    if (findReg(lines) < 0) return `add_command: no 'commands.register([' in ${rel} — register manually with patch`;

    // Pass 1: a new verb's request event must be typed, or the on(...) handler
    // won't compile. Auto-declare it (no-op if already declared anywhere here).
    const notes = [];
    if (handler && !new RegExp(`['"]${event.replace(/[.]/g, '\\.')}['"]\\s*:`).test(src)) {
      this._declareEventInLines(lines, event, 'void');
      notes.push(`declared event '${event}'`);
    }
    // Pass 2: insert the spec as the first element of register([…]).
    const regIdx = findReg(lines);
    const baseIndent = (lines[regIdx].match(/^\s*/) ?? [''])[0];
    lines.splice(regIdx + 1, 0, `${baseIndent}  ${this.serializeObject(parsedSpec)},`);
    // Pass 3: place the handler right after the register([…]) closes.
    if (handler) {
      const body = typeof this.parseSpec(handler) === 'string' ? this.parseSpec(handler) : String(handler);
      const start = findReg(lines);
      let closeIdx = -1;
      for (let i = start + 1; i < lines.length; i++) { if (/\]\);/.test(lines[i])) { closeIdx = i; break; } }
      if (closeIdx >= 0 && body) {
        lines.splice(closeIdx + 1, 0, '', `${baseIndent}on('${event}', (data) => {`, `${baseIndent}  ${body}`, `${baseIndent}});`);
        notes.push(`handler on '${event}'`);
      } else notes.push('handler NOT placed — add it with patch');
    } else notes.push('no handler');
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] add_command ${parsedSpec.id} → ${rel} (${notes.join('; ')})`);
    const at = findReg(lines);
    return `registered '${parsedSpec.id}' in ${rel} — ${notes.join('; ')}.\n${lines.slice(at, at + 3).map((l, i) => `${at + 1 + i}|${l}`).join('\n')}\nrun_test to confirm; refine logic with patch.`;
  }

  /** Splice `'event': type;` into a file's CustomEvents interface, creating the
   *  declare-module block after imports if absent. Mutates `lines` in place. */
  _declareEventInLines(lines, event, type) {
    if (new RegExp(`['"]${event.replace(/[.]/g, '\\.')}['"]\\s*:`).test(lines.join('\n'))) return false;
    const ifaceIdx = lines.findIndex(l => /interface CustomEvents\s*\{/.test(l));
    if (ifaceIdx >= 0) {
      const indent = (lines[ifaceIdx].match(/^\s*/) ?? [''])[0] + '  ';
      lines.splice(ifaceIdx + 1, 0, `${indent}'${event}': ${type};`);
    } else {
      let lastImport = -1;
      for (let i = 0; i < lines.length; i++) if (/^\s*import\b/.test(lines[i])) lastImport = i;
      lines.splice(lastImport + 1, 0, '', "declare module '../types' {", '  interface CustomEvents {', `    '${event}': ${type};`, '  }', '}');
    }
    return true;
  }

  /** Constructor for a new typed bus event: splice `'name': type;` into the
   *  system's `interface CustomEvents { … }`, creating the `declare module
   *  '../types'` block after the imports if the file has none. Covers the
   *  "emit a new fact" half of feature tasks (export, etc.). */
  tool_declare_event({ system, event, type = 'void' }) {
    if (this.phase !== 'green') return 'declare_event is GREEN-phase only (it edits v2/)';
    if (!event) return 'declare_event needs {system, event, type?}';
    const { abs, rel } = this.safePath(system);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${system}`;
    const lines = readFileSync(abs, 'utf8').split('\n');
    if (!this._declareEventInLines(lines, event, type)) return `declare_event: '${event}' already declared in ${rel}`;
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] declare_event '${event}' → ${rel}`);
    return `declared '${event}': ${type} in ${rel}. emit('${event}', …) is now typed; add the emit with patch/add_command.`;
  }

  phaseDenied(rel) {
    if (this.phase === 'red') return `phase red: writing ${rel} not allowed — RED only writes tests/commands/walker/. If your red test already FAILS, just run_test it; the harness advances you to GREEN automatically.`;
    return `phase ${this.phase}: writing ${rel} is not allowed (green→v2/ only)`;
  }

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
  }

  tool_patch({ path, op, line, count = 1, text }) {
    if (text == null) return 'patch needs text: send the JSON head, then the new line(s) in ONE fenced code block';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${path}`;
    const all = readFileSync(abs, 'utf8').split('\n');
    const at = (line | 0) - 1;
    if (at < 0 || at >= all.length) return `line ${line} out of range (file has ${all.length} lines)`;
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
  }

  tool_write({ path, content }) {
    if (content == null) return 'write needs content: send the JSON head, then the ENTIRE file in one fenced code block';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
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
    // The loop reads this to auto-advance phases on evidence (models forget done()).
    this.lastRun = { rel, ok: res.ok, ran: res.ran, testsRan: res.testsRan };
    if (!res.ran || !res.testsRan) return `CRASH (no test executed — fix syntax/imports)\n${res.output}`;
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

  /** Accept spec as object OR JSON string (small models send either). */
  parseSpec(spec) {
    if (spec && typeof spec === 'object') return spec;
    for (const candidate of [spec, repairJson(String(spec ?? ''))]) {
      try { return JSON.parse(candidate); } catch { /* next */ }
    }
    return null;
  }

  tool_inspect({ what, filter }) {
    const mode = what === 'flows' ? 'flows' : what;
    const answer = runProbe(this.ws.dir, { mode, filter, event: filter });
    if (answer.error) return `inspect failed: ${answer.error}`;
    if (mode === 'commands') {
      const rows = answer.commands.map(c => `${c.id}  key=${c.key ?? '-'}  shortcut=${c.shortcut ?? '-'}  group=${c.group ?? '-'}${c.hidden ? '  hidden' : ''}  origin=${c.origin}`);
      return `${answer.count} commands\n${rows.slice(0, filter ? 40 : 80).join('\n')}`;
    }
    if (mode === 'events') {
      if (!filter) return `${answer.count} events\n${answer.events.map(e => e.event).join('\n')}`;
      return answer.events.map(e => `${e.event}\n  firedByCommands: ${e.firedByCommands.join(', ') || '-'}\n  emittedBy: ${e.emittedBy.join(', ') || '-'}\n  subscribedBy: ${e.subscribedBy.join(', ') || '-'}`).join('\n');
    }
    return JSON.stringify(answer, null, 1);
  }

  tool_scenario({ spec }) {
    const parsed = this.parseSpec(spec);
    if (!parsed) return 'scenario: spec is not valid JSON — send {steps:[…],asserts:[…]}';
    const answer = runProbe(this.ws.dir, { mode: 'scenario', steps: parsed.steps ?? [], asserts: parsed.asserts ?? [] });
    if (answer.error) return `scenario failed: ${answer.error}`;
    const failedSteps = answer.steps.filter(s => !s.ok).map(s => `STEP FAILED: ${s.step} (${s.detail})`);
    const assertLines = answer.asserts.map(a => `${a.pass ? 'PASS' : 'FAIL'}: ${a.desc}${a.pass ? '' : ` — actual: ${JSON.stringify(a.actual)}`}`);
    return [
      answer.ok ? 'OK — all steps + asserts pass' : 'NOT OK',
      ...failedSteps,
      ...assertLines,
      `events fired: ${(answer.eventsFired ?? []).join(' ') || '-'}`,
      `state: ${JSON.stringify(answer.state)}`,
    ].join('\n');
  }

  tool_gen_test({ title, spec }) {
    if (this.phase !== 'red') return 'gen_test is RED-phase only (it writes a test file)';
    const parsed = this.parseSpec(spec);
    if (!parsed) return 'gen_test: spec is not valid JSON';
    const validation = runProbe(this.ws.dir, { mode: 'scenario', steps: parsed.steps ?? [], asserts: [] });
    if (validation.error) return `gen_test: scenario validation failed: ${validation.error}`;
    // UNAVAILABLE = broken preconditions (a spec bug) — block. UNKNOWN commands
    // are allowed: for feature tasks the not-yet-existing command IS the red
    // (generated steps assert runCommand(...) === true, failing until GREEN).
    const blocked = validation.steps?.find(s => !s.ok && (s.detail ?? '').includes('UNAVAILABLE'));
    if (blocked) return `gen_test: step has broken preconditions: ${blocked.step} (${blocked.detail}) — fix the steps first via scenario`;
    const unknownNotes = (validation.steps ?? []).filter(s => !s.ok).map(s => `note: ${s.step} — ${s.detail} (fine if this is the feature under test; the generated test asserts it runs)`);
    const source = genTest({ title: title ?? 'walker case', steps: parsed.steps ?? [], asserts: parsed.asserts ?? [] });
    const target = this.defaultTestPath;
    const { abs, rel } = this.safePath(target);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, source);
    this.log(`[tool] gen_test → ${rel}`);
    return [`wrote ${rel} (${source.split('\n').length} lines).`, ...unknownNotes, 'Now run_test it — it should FAIL to be a valid red test.'].join('\n');
  }

  tool_graph({ mode, query }) {
    const answer = graphQuery(this.ws.repoRoot, mode, query ?? '');
    if (answer.error) return `graph: ${answer.error}`;
    if (!Array.isArray(answer) || !answer.length) return `graph ${mode}: no results for "${query}"`;
    return answer.map(r =>
      r.file ? `${r.kind ?? ''} ${r.name ?? r.qualified ?? r.test} — ${r.file}:${r.line ?? '?'}` : JSON.stringify(r),
    ).join('\n');
  }

  tool_note() { return 'noted'; }       // loop persists notes; this is just the ack
  tool_done() { return 'phase check running…'; }
  tool_give_up() { return 'giving up'; }
}
