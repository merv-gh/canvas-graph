// Tool implementations with TDD phase guards. Every tool returns a short string
// (pre-trimmed by the loop). Guards are mechanical: RED writes only under
// tests/commands/walker/, GREEN writes only under v2/. No shell tool exists.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { genTest, normalizeScenarioSpec, runProbe } from './probe-client.mjs';
import { graphQuery } from './graphdb.mjs';
import { repairJson } from './ollama.mjs';

const DENY = /node_modules|\.git\//;

function lineStartIndex(source, lineNo) {
  let index = 0;
  for (let line = 1; line < lineNo; line++) {
    const next = source.indexOf('\n', index);
    if (next < 0) return source.length;
    index = next + 1;
  }
  return index;
}

function lineNumber(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function findMatching(source, openIndex, openChar, closeChar) {
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
  }

  tool_projection({ name = 'commands', filter = '' }) {
    const script = join(this.ws.repoRoot, 'walker/projections.mjs');
    try {
      const output = execFileSync(process.execPath, [script, 'show', name, filter].filter(Boolean), {
        cwd: this.ws.dir,
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, WALKER_PROJECTION_ROOT: this.ws.dir },
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
    const source = readFileSync(abs, 'utf8');
    const all = source.split('\n');
    const line = all[lineNo - 1];
    const idIndex = lineStartIndex(source, lineNo) + line.indexOf(`id: '${id}'`);
    const objectStart = source.lastIndexOf('{', idIndex);
    const objectEnd = objectStart >= 0 ? findMatching(source, objectStart, '{', '}') : -1;
    const objectText = objectEnd >= 0 ? source.slice(objectStart, objectEnd + 1) : line;
    const startLine = objectStart >= 0 ? lineNumber(source, objectStart) : lineNo;
    const endLine = objectEnd >= 0 ? lineNumber(source, objectEnd) : lineNo;
    const already = Object.keys(parsed).filter(k => new RegExp(`\\b${k}\\s*:`).test(objectText));
    const missingEntries = Object.entries(parsed).filter(([k]) => !already.includes(k));
    if (!missingEntries.length) {
      const taskText = `${this.task?.title ?? ''}\n${this.task?.prompt ?? ''}`;
      const siblingIds = [...new Set([...taskText.matchAll(/['"`]([a-z][\w-]*(?:\.[\w-]+)+)['"`]/g)].map(m => m[1]).filter(other => other !== id))];
      const siblingHint = siblingIds.length ? `\nOther command ids in this task: ${siblingIds.slice(0, 6).join(', ')}. If the test still fails, update the remaining id.` : '';
      return `set_command: '${id}' already sets ${already.join(', ')} in ${file}:${startLine}-${endLine}.${siblingHint}`;
    }
    const js = (v) => {
      if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`;
      if (v && typeof v === 'object' && !Array.isArray(v)) return `{ ${Object.entries(v).map(([k, val]) => `${k}: ${js(val)}`).join(', ')} }`;
      return JSON.stringify(v);
    };
    const propsCode = missingEntries.map(([k, v]) => `${k}: ${js(v)}`).join(', ');
    const closing = line.match(/^(.*?)(\s*\}\s*,?\s*\)?;?\s*)$/);
    if (startLine === endLine && closing && line.includes('{')) {
      // Single-line spec: …, <props> }
      const head = closing[1].replace(/,\s*$/, '');
      all[lineNo - 1] = `${head}, ${propsCode}${closing[2]}`;
    } else {
      // Multi-line spec: add an indented property line right after the id line.
      const indent = (line.match(/^\s*/) ?? [''])[0];
      all.splice(lineNo, 0, `${indent}${propsCode},`);
    }
    writeFileSync(abs, all.join('\n'));
    const skipped = already.length ? ` (already had ${already.join(',')})` : '';
    this.log(`[tool] set_command ${id} += ${missingEntries.map(([k]) => k).join(',')}${skipped}`);
    const from = Math.max(0, lineNo - 2);
    return `updated ${file}: added ${missingEntries.map(([k]) => k).join(', ')}${skipped}.\n${all.slice(from, lineNo + 1).map((l, i) => `${from + 1 + i}|${l}`).join('\n')}\nNow run_test to confirm.`;
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
      this._declareEventInLines(lines, event, parsedSpec.payload ? 'any' : 'void');
      notes.push(`declared event '${event}'`);
    }
    // Pass 2: insert the spec as the FIRST array element. Handle BOTH the
    // multi-line `register([` form and the compact `register([{ …` form (the
    // first object's `{` shares the line with `[`). For the compact form, keep
    // the `[` and push the trailing content to its own line, so the new element
    // slots in as a sibling instead of merging INTO the existing object literal
    // (that produced a syntax error on every compact-array system).
    const regIdx = findReg(lines);
    const regLine = lines[regIdx];
    const baseIndent = (regLine.match(/^\s*/) ?? [''])[0];
    const elem = `${baseIndent}  ${this.serializeObject(parsedSpec)},`;
    const bracket = regLine.indexOf('[', regLine.indexOf('register'));
    const trailing = regLine.slice(bracket + 1);
    if (trailing.trim() === '') {
      lines.splice(regIdx + 1, 0, elem);
    } else {
      lines[regIdx] = regLine.slice(0, bracket + 1);
      lines.splice(regIdx + 1, 0, elem, `${baseIndent}  ${trailing}`);
    }
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

  /** Constructor for the "collapse / fold a panel or region" task shape (left
   *  panel, top bar, event log, zen — the user's panel-collapse family). Fold is
   *  ONE generic store (core/fold.ts) keyed by a string id; a toggle is just a
   *  command whose `event` is the already-declared `fold.toggle` fact carrying
   *  that id (types.ts declares it; foldable.ts handles it). This encodes the
   *  wiring a weak model fumbles — the fold.toggle event name + the `() => ({id})`
   *  payload arrow — so the model supplies only {foldId, key}. Reuses
   *  add_command's boot-proven register-array placement, then optionally
   *  contributes a toolbar button when the target system exposes `contribute`. */
  tool_add_fold_toggle({ system, id, foldId, key, shortcut, label, group, surface, glyph, order }) {
    if (this.phase !== 'green') return 'add_fold_toggle is GREEN-phase only (it edits v2/)';
    if (!system || !id || !foldId || !key) {
      return 'add_fold_toggle needs {system, id, foldId, key, shortcut?, surface?, glyph?}, e.g. {"system":"v2/systems/main.ts","id":"view.left.toggle","foldId":"outline.panel","key":"b","shortcut":"B"}. The fold.toggle event + payload are wired for you.';
    }
    const spec = {
      id,
      label: label || `Toggle ${foldId}`,
      group: group || 'view',
      event: 'fold.toggle',
      ...(shortcut ? { shortcut } : {}),
      input: { on: 'keydown', key, prevent: true },
      // Emitted RAW by serializeObject (it detects `=>`), so this becomes real code.
      payload: `() => ({ id: '${foldId}' })`,
    };
    // No handler: fold.toggle is already declared (types.ts) and handled
    // (foldable.ts). The new command just emits it with this region's id.
    const cmdResult = this.tool_add_command({ system, spec });
    if (!/registered '/.test(cmdResult)) return cmdResult;

    let affordanceNote = 'no affordance requested (a [data-fold-id] chevron in the region\'s view is the mouse half — see the hamburger in systems/main.ts)';
    if (surface) {
      const { abs, rel } = this.safePath(system);
      const lines = readFileSync(abs, 'utf8').split('\n');
      if (!/\bcontribute\b/.test(lines.join('\n'))) {
        affordanceNote = `affordance NOT added: ${rel} doesn't destructure \`contribute\` in its system(...) args. Add it there, or render a [data-fold-id="${foldId}"] chevron in the region's view (hamburger pattern in systems/main.ts).`;
      } else {
        const regIdx = lines.findIndex(l => /commands\.register\(\[/.test(l));
        let closeIdx = -1;
        for (let i = regIdx + 1; i < lines.length; i++) { if (/\]\);/.test(lines[i])) { closeIdx = i; break; } }
        const indent = (lines[regIdx]?.match(/^\s*/) ?? [''])[0];
        const text = (glyph || '▾').replace(/'/g, "\\'");
        if (closeIdx >= 0) {
          lines.splice(closeIdx + 1, 0, `${indent}contribute({ surface: '${surface}', command: '${id}', kind: 'button', text: '${text}', order: ${Number(order) || 50} });`);
          writeFileSync(abs, lines.join('\n'));
          affordanceNote = `contributed a '${surface}' button (${text})`;
        } else {
          affordanceNote = 'affordance NOT added: could not find the register array close; add contribute(...) with patch.';
        }
      }
    }
    this.log(`[tool] add_fold_toggle ${id} → fold '${foldId}'${surface ? ` + ${surface} button` : ''}`);
    return `added fold toggle '${id}' — emits fold.toggle {id:'${foldId}'} in ${system}. ${affordanceNote}.\nrun_test to confirm.`;
  }

  /** Constructor for "make Escape exit a folded region" (zen, and any future
   *  full-screen/overlay fold). Cancellation is one generic stack
   *  (core/cancellation.ts): a system registers `{origin, active, cancel}` and
   *  Escape peels the topmost active one (editable.ts / jump.ts are the exemplars).
   *  This encodes the fold-specific active/cancel and ensures `contexts`+`origin`
   *  are destructured, so the model supplies only {system, foldId}. Composes with
   *  add_fold_toggle: toggle creates the fold, this makes Escape close it. */
  tool_add_fold_cancellable({ system, foldId }) {
    if (this.phase !== 'green') return 'add_fold_cancellable is GREEN-phase only (it edits v2/)';
    if (!system || !foldId) return 'add_fold_cancellable needs {system, foldId}, e.g. {"system":"v2/systems/main.ts","foldId":"shell.zen"} — makes Escape exit that folded region.';
    const { abs, rel } = this.safePath(system);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${system}`;
    const lines = readFileSync(abs, 'utf8').split('\n');
    const whole = lines.join('\n');
    if (/cancellation\.register/.test(whole) && whole.includes(`folded('${foldId}')`)) {
      return `add_fold_cancellable: ${rel} already registers a cancellable for '${foldId}'`;
    }
    const sysIdx = lines.findIndex(l => /\bsystem\(\s*['"][^'"]+['"]/.test(l));
    if (sysIdx < 0) return `add_fold_cancellable: no system('…', …) registration in ${rel}`;
    const sysLine = lines[sysIdx];
    const m = sysLine.match(/\(\s*\{([^}]*)\}\s*\)\s*=>/);
    if (!m) {
      return `add_fold_cancellable: the system in ${rel} doesn't use a single-line ({ … }) => ctx destructure, so I can't safely add origin/contexts. Add it by hand (see jump.ts): contexts.cancellation.register({ origin, active: () => contexts.fold.folded('${foldId}'), cancel: () => contexts.fold.set('${foldId}', true) });`;
    }
    const current = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const missing = ['contexts', 'origin'].filter(n => !current.includes(n));
    if (missing.length) {
      lines[sysIdx] = sysLine.replace(/\(\s*\{[^}]*\}\s*\)\s*=>/, `({ ${[...current, ...missing].join(', ')} }) =>`);
    }
    const indent = (sysLine.match(/^\s*/) ?? [''])[0] + '  ';
    lines.splice(sysIdx + 1, 0,
      `${indent}// Escape exits this folded region — cancellation peels the topmost active layer.`,
      `${indent}contexts.cancellation.register({`,
      `${indent}  origin,`,
      `${indent}  active: () => contexts.fold.folded('${foldId}'),`,
      `${indent}  cancel: () => contexts.fold.set('${foldId}', true),`,
      `${indent}});`,
    );
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] add_fold_cancellable ${foldId} → ${rel}${missing.length ? ` (+${missing.join(',')})` : ''}`);
    return `added Escape-to-exit cancellable for fold '${foldId}' in ${rel}${missing.length ? ` (added ${missing.join(', ')} to the ctx destructure)` : ''}.\nrun_test to confirm.`;
  }

  tool_add_css_rule({ path = 'v2/styles.css', selector, declarations, after }) {
    if (this.phase !== 'green') return 'add_css_rule is GREEN-phase only (it edits v2/)';
    if (!selector || !declarations) return 'add_css_rule needs {selector, declarations, after?}';
    const { abs, rel } = this.safePath(path);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${path}`;
    if (!rel.endsWith('.css')) return `add_css_rule only edits CSS files, got ${rel}`;

    const lines = readFileSync(abs, 'utf8').split('\n');
    const text = lines.join('\n');
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|\\n)\\s*${escape(selector)}\\s*\\{`).test(text)) {
      return `add_css_rule: selector '${selector}' already exists in ${rel}; use patch to adjust that existing block.`;
    }
    const declText = typeof declarations === 'string'
      ? declarations.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.endsWith(';') ? l : `${l};`).join('\n')
      : Object.entries(this.parseSpec(declarations) ?? declarations)
        .map(([k, v]) => `${k}: ${v};`).join('\n');
    if (!declText.trim()) return 'add_css_rule: declarations are empty';

    const findRuleEnd = (needle) => {
      if (!needle) return -1;
      const start = lines.findIndex(l => l.trim().startsWith(needle) && l.includes('{'));
      if (start < 0) return -1;
      let depth = 0;
      for (let i = start; i < lines.length; i++) {
        depth += (lines[i].match(/\{/g) ?? []).length;
        depth -= (lines[i].match(/\}/g) ?? []).length;
        if (i > start && depth <= 0) return i;
      }
      return start;
    };
    let insertAfter = findRuleEnd(after) >= 0 ? findRuleEnd(after) : -1;
    if (insertAfter < 0) insertAfter = findRuleEnd('.properties input');
    if (insertAfter < 0) insertAfter = lines.length - 1;

    const rule = [
      `${selector} {`,
      ...declText.split('\n').map(l => `  ${l.trim()}`),
      '}',
    ];
    lines.splice(insertAfter + 1, 0, '', ...rule);
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] add_css_rule ${selector} → ${rel}`);
    const from = Math.max(0, insertAfter - 2);
    return `added CSS rule in ${rel} after line ${insertAfter + 1}:\n${lines.slice(from, insertAfter + rule.length + 4).map((l, i) => `${from + 1 + i}|${l}`).join('\n')}\nNow run_test to confirm.`;
  }

  tool_add_edge_reverse() {
    if (this.phase !== 'green') return 'add_edge_reverse is GREEN-phase only (it edits v2/)';

    const graphModel = this.safePath('v2/model/graph.ts');
    const graphSystem = this.safePath('v2/systems/graph.ts');
    let modelSrc = readFileSync(graphModel.abs, 'utf8');
    if (modelSrc.includes("export type EdgePatch = Partial<Pick<EdgeEntity, 'Label'>>;")) {
      modelSrc = modelSrc.replace(
        "export type EdgePatch = Partial<Pick<EdgeEntity, 'Label'>>;",
        "export type EdgePatch = Partial<Pick<EdgeEntity, 'Label' | 'From' | 'To'>>;",
      );
      writeFileSync(graphModel.abs, modelSrc);
    }

    let lines = readFileSync(graphSystem.abs, 'utf8').split('\n');
    this._declareEventInLines(lines, 'graph.edge.reverse', '{ id: Id }');
    const src = () => lines.join('\n');
    if (!/id:\s*['"]graph\.edge\.reverse['"]/.test(src())) {
      const regIdx = lines.findIndex(l => /contexts\.commands\.register\(\[/.test(l));
      if (regIdx < 0) return 'add_edge_reverse: no contexts.commands.register([ found in v2/systems/graph.ts';
      lines.splice(regIdx + 1, 0,
        "      { id: 'graph.edge.reverse', label: 'Reverse edge', group: 'edge', shortcut: 'Shift+E', available: () => !!selectedEdgeId(), payload: () => ({ id: selectedEdgeId() }) },",
      );
    }
    if (!/on\('graph\.edge\.reverse'/.test(src())) {
      const closeIdx = lines.findIndex(l => /\]\);/.test(l));
      if (closeIdx < 0) return 'add_edge_reverse: could not find command register closing line';
      lines.splice(closeIdx + 1, 0,
        '',
        "    on('graph.edge.reverse', ({ id }) => {",
        '      const edge = graphs.current.getEdge(id);',
        '      if (!edge) return;',
        '      if (graphs.current.updateEdge(id, { From: edge.To, To: edge.From })) {',
        "        emit('graph.edge.updated', { graphId: graphs.current.id, id });",
        '      }',
        '    });',
      );
    }
    writeFileSync(graphSystem.abs, lines.join('\n'));
    this.log('[tool] add_edge_reverse');
    return [
      'added graph.edge.reverse command, handler, and EdgePatch From/To typing.',
      'Files: v2/systems/graph.ts, v2/model/graph.ts.',
      'Now run_test to confirm.',
    ].join('\n');
  }

  tool_add_graph_export_json() {
    if (this.phase !== 'green') return 'add_graph_export_json is GREEN-phase only (it edits v2/)';

    const graphSystem = this.safePath('v2/systems/graph.ts');
    if (!this.writeAllowed(graphSystem.rel)) return this.phaseDenied(graphSystem.rel);
    let lines = readFileSync(graphSystem.abs, 'utf8').split('\n');
    const src = () => lines.join('\n');

    this._declareEventInLines(lines, 'graph.export.json', 'void');
    this._declareEventInLines(lines, 'graph.exported', '{ json: string }');

    if (!/id:\s*['"]graph\.export\.json['"]/.test(src())) {
      const regIdx = lines.findIndex(l => /contexts\.commands\.register\(\[/.test(l));
      if (regIdx < 0) return 'add_graph_export_json: no contexts.commands.register([ found in v2/systems/graph.ts';
      lines.splice(regIdx + 1, 0,
        "      { id: 'graph.export.json', label: 'Export graph JSON', group: 'graph' },",
      );
    }

    if (!/on\('graph\.export\.json'/.test(src())) {
      const closeIdx = lines.findIndex(l => /\]\);/.test(l));
      if (closeIdx < 0) return 'add_graph_export_json: could not find command register closing line';
      lines.splice(closeIdx + 1, 0,
        '',
        "    on('graph.export.json', () => {",
        '      const json = JSON.stringify({',
        '        nodes: graphs.current.nodes().map(({ id, Label, Position, Size }) => ({ id, Label, Position, Size })),',
        '        edges: graphs.current.edges().map(({ id, From, To, Label }) => ({ id, From, To, Label })),',
        '      });',
        '      const clipboard = globalThis.navigator?.clipboard;',
        '      void clipboard?.writeText?.(json)?.catch?.(() => {});',
        "      emit('graph.exported', { json });",
        '    });',
      );
    }

    writeFileSync(graphSystem.abs, lines.join('\n'));
    this.log('[tool] add_graph_export_json');
    return [
      'added graph.export.json command, graph.exported event, serializer, and guarded clipboard write.',
      'File: v2/systems/graph.ts.',
      'Now run_test to confirm.',
    ].join('\n');
  }

  tool_add_container_delete_cascade() {
    if (this.phase !== 'green') return 'add_container_delete_cascade is GREEN-phase only (it edits v2/)';

    const containersSystem = this.safePath('v2/systems/containers.ts');
    if (!this.writeAllowed(containersSystem.rel)) return this.phaseDenied(containersSystem.rel);
    const source = readFileSync(containersSystem.abs, 'utf8');
    if (/emit\('graph\.node\.delete', \{ id: childRef\.id \}\)/.test(source)) {
      return 'add_container_delete_cascade: v2/systems/containers.ts already cascades child node deletes';
    }
    const oldText = [
      '      // Release children (they keep position; lose parent link).',
      '      [...c.Children].forEach(childRef => nest.remove(childRef));',
      '      // If this container was nested, detach from its own parent.',
    ].join('\n');
    const nextText = [
      '      // Delete owned children before deleting this container. Nested containers',
      '      // recurse through the same owner event; nodes use graph.node.delete so',
      '      // graph.ts still owns node/incident-edge cleanup.',
      '      [...c.Children].forEach(childRef => {',
      "        if (childRef.kind === 'container') emit('graph.container.delete', { id: childRef.id });",
      "        else if (childRef.kind === 'node') emit('graph.node.delete', { id: childRef.id });",
      '        else nest.remove(childRef);',
      '      });',
      '      // If this container was nested, detach from its own parent.',
    ].join('\n');
    if (!source.includes(oldText)) return 'add_container_delete_cascade: expected child-release block not found in v2/systems/containers.ts';
    writeFileSync(containersSystem.abs, source.replace(oldText, nextText));
    this.log('[tool] add_container_delete_cascade');
    return [
      'added recursive container child deletion in v2/systems/containers.ts.',
      'Child containers emit graph.container.delete; child nodes emit graph.node.delete.',
      'Now run_test to confirm.',
    ].join('\n');
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
  }

  /** Run a {steps,asserts} layout spec via the browser oracle; set lastRun like vitest. */
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

  /** Observe layout/focus/style facts live in the real browser — read-only, any phase. */
  async tool_app_probe({ spec }) {
    if (!this.browser) return 'app_probe: layout oracle unavailable (no browser session)';
    const parsed = this.parseSpec(spec);
    if (!parsed) return 'app_probe: send {steps:[…], asserts:[…]} — asserts use focus / rect / style / path';
    await this.browser.fresh();
    const { pass, results } = await this.browser.probe(parsed);
    return [
      pass ? 'OK — all asserts pass' : 'NOT OK',
      ...results.map(r => `${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.ok ? '' : ` — actual: ${JSON.stringify(r.actual)}`}`),
    ].join('\n');
  }

  /** RED-phase: write the failing layout spec after the oracle confirms it fails now. */
  async tool_gen_layout_test({ title, spec }) {
    if (this.phase !== 'red') return 'gen_layout_test is RED-phase only. GREEN edits v2/ and re-runs run_test.';
    if (!this.browser) return 'gen_layout_test: layout oracle unavailable (no browser session)';
    const parsed = this.parseSpec(spec);
    if (!parsed || !Array.isArray(parsed.asserts) || !parsed.asserts.length) {
      return 'gen_layout_test: send {steps:[…], asserts:[…]} with focus/rect/style/path asserts stating the DESIRED behavior.';
    }
    await this.browser.fresh();
    const { pass, results } = await this.browser.probe(parsed);
    const lines = results.map(r => `${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.ok ? '' : ` — actual: ${JSON.stringify(r.actual)}`}`);
    if (pass) return `These asserts already PASS on current code — not a red test. Choose asserts for the currently-broken behavior.\n${lines.join('\n')}`;
    const rel = `tests/commands/walker/${this.task.id}.layout.json`;
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    const { abs } = this.safePath(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify({ title: title ?? this.task.id, steps: parsed.steps ?? [], asserts: parsed.asserts }, null, 2)}\n`);
    return `wrote ${rel} — layout oracle is RED (${results.filter(r => !r.ok).length}/${results.length} asserts fail):\n${lines.join('\n')}\nNow run_test it to advance to GREEN, then edit v2/.`;
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
    const parsed = normalizeScenarioSpec(this.parseSpec(spec));
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
    if (this.phase !== 'red') {
      return [
        'gen_test is RED-phase only. GREEN keeps the existing failing test; do not rewrite it.',
        `Current test: ${this.taskTestPath ?? this.defaultTestPath ?? 'tests/commands/walker/<task>.test.ts'}.`,
        'Use projection/inspect/scenario to identify the remaining failed assertion, then edit v2/ with the constructor tool (set_command/add_command/etc.) and run_test again.',
      ].join('\n');
    }
    const parsed = normalizeScenarioSpec(this.parseSpec(spec));
    if (!parsed) return 'gen_test: spec is not valid JSON';
    const requiredEvent = this.task?.meta?.event;
    if (requiredEvent && !(parsed.asserts ?? []).some(a => a.event === requiredEvent)) {
      return `gen_test: this task requires an event assert for '${requiredEvent}'. Add {"event":"${requiredEvent}", ...} to asserts.`;
    }
    const requiredTokens = String(this.task?.meta?.['test-requires'] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (requiredTokens.length) {
      const scenarioText = JSON.stringify({ steps: parsed.steps ?? [], asserts: parsed.asserts ?? [] });
      const missing = requiredTokens.filter(token => !scenarioText.includes(token));
      if (missing.length) return `gen_test: this task requires scenario token(s): ${missing.join(', ')}. Include them in steps/asserts.`;
    }
    const badCss = (parsed.asserts ?? []).find(a => a.css && a.op && !['count', 'exists', 'textContains'].includes(a.op));
    if (badCss) return `gen_test: css asserts support op=count|exists|textContains only. To assert CSS source text (rules like dashed border), use {"file":"v2/styles.css","matches":"..."} with no steps.`;
    const validation = runProbe(this.ws.dir, { mode: 'scenario', steps: parsed.steps ?? [], asserts: [] });
    if (validation.error) return `gen_test: scenario validation failed: ${validation.error}`;
    // UNAVAILABLE = broken preconditions (a spec bug) — block. UNKNOWN commands
    // are allowed: for feature tasks the not-yet-existing command IS the red
    // (generated steps assert runCommand(...) === true, failing until GREEN).
    const blocked = validation.steps?.find(s => !s.ok && (s.detail ?? '').includes('UNAVAILABLE'));
    if (blocked) return `gen_test: step has broken preconditions: ${blocked.step} (${blocked.detail}) — fix the steps first via scenario`;
    const unknown = (validation.steps ?? []).filter(s => !s.ok && (s.detail ?? '').includes('unknown command'));
    const allowedUnknown = (s) => {
      const id = String(s.step ?? '').replace(/^command\s+/, '');
      return this.task?.kind === 'feature' && id === this.task?.meta?.command;
    };
    const badUnknown = unknown.filter(s => !allowedUnknown(s));
    if (badUnknown.length) {
      return `gen_test: unknown command step: ${badUnknown.map(s => `${s.step} (${s.detail})`).join('; ')}. Do not invent helper commands; use existing commands from inspect, bus events like selection.item.select, or make the NEW feature command itself the unknown step.`;
    }
    const redCheck = runProbe(this.ws.dir, { mode: 'scenario', steps: parsed.steps ?? [], asserts: parsed.asserts ?? [] });
    if (redCheck.error) return `gen_test: scenario red-check failed: ${redCheck.error}`;
    if (redCheck.ok) {
      return [
        'gen_test: this scenario already PASSES, so it is not a valid red test.',
        `asserts: ${JSON.stringify(redCheck.asserts ?? [])}`,
        'Use asserts for the desired behavior that is currently broken, then call gen_test again.',
      ].join('\n');
    }
    const unknownNotes = unknown.map(s => `note: ${s.step} — ${s.detail} (allowed because this new feature command is named in the task card; the generated test asserts it runs)`);
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
