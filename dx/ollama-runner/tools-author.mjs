import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineNumber, lineStartIndex, findMatching } from './tool-source.mjs';

export const authorTools = {
tool_set_command({ id, props }) {
    if (this.phase !== 'green') return 'set_command is GREEN-phase only (it edits frontend/)';
    const parsed = this.parseSpec(props);
    if (!parsed || typeof parsed !== 'object') return 'set_command: props must be JSON, e.g. {"shortcut":"I","input":{"on":"keydown","key":"i","prevent":true}}';
    const ALLOWED = new Set(['shortcut', 'input', 'group', 'hidden', 'event']);
    const bad = Object.keys(parsed).filter(k => !ALLOWED.has(k));
    if (bad.length) {
      const taskText = `${this.task?.id ?? ''}\n${this.task?.title ?? ''}\n${this.task?.prompt ?? ''}`;
      const zenEscape = id === 'app.cancel.escape' || /zen|escape|cancel/i.test(taskText);
      const hint = zenEscape
        ? " For Escape exits zen/fold tasks, do not edit app.cancel.escape; use add_fold_cancellable {\"system\":\"frontend/systems/main.ts\",\"foldId\":\"shell.zen\"}."
        : '';
      return `set_command: unsupported props ${bad.join(', ')} (allowed: shortcut, input, group, hidden, event). Functions (available/payload) need edit/patch.${hint}`;
    }
    const res = this.ws.run('git', ['grep', '-n', `id: '${id}'`, '--', 'frontend'], 20000);
    const hit = res.output.split('\n').filter(Boolean)[0];
    if (!hit) return `set_command: no command literal with id '${id}' found under frontend/`;
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
  },

serializeObject(obj) {
    const val = (v) => {
      if (typeof v === 'string') return /=>/.test(v) || /^\(.*\)\s*=>/.test(v) ? v : `'${v.replace(/'/g, "\\'")}'`;
      if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
      if (v && typeof v === 'object') return this.serializeObject(v);
      return JSON.stringify(v);
    };
    return `{ ${Object.entries(obj).map(([k, v]) => `${k}: ${val(v)}`).join(', ')} }`;
  },

tool_add_command({ system, spec, handler }) {
    if (this.phase !== 'green') return 'add_command is GREEN-phase only (it edits frontend/)';
    const parsedSpec = this.parseSpec(spec);
    if (!parsedSpec || !parsedSpec.id) return 'add_command: spec must include at least {id, label}, e.g. {"id":"graph.edge.reverse","label":"Reverse edge","group":"edge"}';
    const { abs, rel } = this.safePath(system);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${system}`;
    const src = readFileSync(abs, 'utf8');
    const idPattern = `\\bid\\s*:\\s*['"]${parsedSpec.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`;
    const existing = this.ws.run('git', ['grep', '-nE', idPattern, '--', 'frontend'], 20000);
    if (existing.ok && existing.output.trim()) {
      const taskText = `${this.task?.id ?? ''}\n${this.task?.title ?? ''}\n${this.task?.prompt ?? ''}`;
      const hint = parsedSpec.id === 'app.cancel.escape' || /zen|escape|cancel/i.test(taskText)
        ? ' For Escape exits zen/fold tasks, keep app.cancel.escape as-is and call add_fold_cancellable {"system":"frontend/systems/main.ts","foldId":"shell.zen"}.'
        : '';
      const first = existing.output.trim().split('\n')[0];
      return `add_command: '${parsedSpec.id}' already exists at ${first} — use set_command to modify data props.${hint}`;
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
  },

tool_add_command_alias({ system, id, event, key, shortcut, group = 'alias', ctrl = false, shift = false, alt = false, meta = false }) {
    if (this.phase !== 'green') return 'add_command_alias is GREEN-phase only (it edits frontend/)';
    if (!system || !id || !event || !key) {
      return 'add_command_alias: send {system,id,event,key,shortcut,ctrl?,shift?,alt?,meta?}; example {"system":"frontend/systems/choose.ts","id":"choose.all.cmd","event":"choose.all","key":"a","shortcut":"Cmd+A","meta":true}';
    }
    return this.tool_add_command({
      system,
      spec: {
        id,
        label: shortcut ? `${event} (${shortcut})` : `${event} alias`,
        event,
        group,
        hidden: true,
        shortcut: shortcut ?? undefined,
        input: { on: 'keydown', key, ctrl: !!ctrl, shift: !!shift, alt: !!alt, meta: !!meta, prevent: true },
      },
    });
  },

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
  },

tool_declare_event({ system, event, type = 'void' }) {
    if (this.phase !== 'green') return 'declare_event is GREEN-phase only (it edits frontend/)';
    if (!event) return 'declare_event needs {system, event, type?}';
    const { abs, rel } = this.safePath(system);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${system}`;
    const lines = readFileSync(abs, 'utf8').split('\n');
    if (!this._declareEventInLines(lines, event, type)) return `declare_event: '${event}' already declared in ${rel}`;
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] declare_event '${event}' → ${rel}`);
    return `declared '${event}': ${type} in ${rel}. emit('${event}', …) is now typed; add the emit with patch/add_command.`;
  },

tool_add_fold_toggle({ system, id, foldId, key, shortcut, label, group, surface, glyph, order }) {
    if (this.phase !== 'green') return 'add_fold_toggle is GREEN-phase only (it edits frontend/)';
    if (!system || !id || !foldId || !key) {
      return 'add_fold_toggle needs {system, id, foldId, key, shortcut?, surface?, glyph?}, e.g. {"system":"frontend/systems/main.ts","id":"view.left.toggle","foldId":"outline.panel","key":"b","shortcut":"B"}. The fold.toggle event + payload are wired for you.';
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
  },

tool_add_fold_cancellable({ system, foldId }) {
    if (this.phase !== 'green') return 'add_fold_cancellable is GREEN-phase only (it edits frontend/)';
    if (!system || !foldId) return 'add_fold_cancellable needs {system, foldId}, e.g. {"system":"frontend/systems/main.ts","foldId":"shell.zen"} — makes Escape exit that folded region.';
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
      return `add_fold_cancellable: the system in ${rel} doesn't use a single-line ({ … }) => ctx destructure, so I can't safely add origin/contexts. Add it by hand (see jump.ts): contexts.interaction.cancel.register({ origin, active: () => contexts.fold.folded('${foldId}'), cancel: () => contexts.fold.set('${foldId}', true) });`;
    }
    const current = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const missing = ['contexts', 'origin'].filter(n => !current.includes(n));
    if (missing.length) {
      lines[sysIdx] = sysLine.replace(/\(\s*\{[^}]*\}\s*\)\s*=>/, `({ ${[...current, ...missing].join(', ')} }) =>`);
    }
    const indent = (sysLine.match(/^\s*/) ?? [''])[0] + '  ';
    lines.splice(sysIdx + 1, 0,
      `${indent}// Escape exits this folded region — cancellation peels the topmost active layer.`,
      `${indent}contexts.interaction.cancel.register({`,
      `${indent}  origin,`,
      `${indent}  active: () => contexts.fold.folded('${foldId}'),`,
      `${indent}  cancel: () => contexts.fold.set('${foldId}', true),`,
      `${indent}});`,
    );
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] add_fold_cancellable ${foldId} → ${rel}${missing.length ? ` (+${missing.join(',')})` : ''}`);
    return `added Escape-to-exit cancellable for fold '${foldId}' in ${rel}${missing.length ? ` (added ${missing.join(', ')} to the ctx destructure)` : ''}.\nrun_test to confirm.`;
  },

tool_add_panel({ system, id, anchor, foldId, movable, layout, order, mountWhen, buttons }) {
    if (this.phase !== 'green') return 'add_panel is GREEN-phase only (it edits frontend/)';
    if (!system || !id || !anchor) {
      return 'add_panel needs {system, id, anchor}, e.g. {"system":"frontend/systems/view-zoom.ts","id":"zoom","anchor":"bottom-right","movable":true,"layout":"stack","buttons":["view.zoom.in","view.fit.all"]}. buttons routes those existing top affordances into the panel.';
    }
    const anchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    if (!anchors.includes(anchor)) return `add_panel: anchor must be one of ${anchors.join(', ')}`;
    const { abs, rel } = this.safePath(system);
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    if (!existsSync(abs)) return `no such file: ${system}`;
    const lines = readFileSync(abs, 'utf8').split('\n');
    if (new RegExp(`declarePanel\\(\\s*\\{[^}]*id:\\s*['"]${id}['"]`).test(lines.join('\n'))) {
      return `add_panel: ${rel} already declares panel '${id}'`;
    }
    const sysIdx = lines.findIndex(l => /\bsystem\(\s*['"][^'"]+['"]/.test(l));
    if (sysIdx < 0) return `add_panel: no system('…', …) registration in ${rel}`;
    const sysLine = lines[sysIdx];
    const m = sysLine.match(/\(\s*\{([^}]*)\}\s*\)\s*=>/);
    if (!m) {
      return `add_panel: the system in ${rel} doesn't use a single-line ({ … }) => ctx destructure, so I can't safely add declarePanel. Add it by hand near the top of the system body: declarePanel({ id: '${id}', anchor: '${anchor}' });`;
    }
    const current = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const missing = ['declarePanel'].filter(n => !current.includes(n));
    if (missing.length) {
      lines[sysIdx] = sysLine.replace(/\(\s*\{[^}]*\}\s*\)\s*=>/, `({ ${[...current, ...missing].join(', ')} }) =>`);
    }
    const props = [`id: '${id}'`, `anchor: '${anchor}'`];
    if (foldId) props.push(`foldId: '${foldId}'`);
    if (movable) props.push('movable: true');
    if (layout) props.push(`layout: '${layout}'`);
    if (Number.isFinite(Number(order))) props.push(`order: ${Number(order)}`);
    if (mountWhen) props.push(`mountWhen: ${mountWhen}`); // raw arrow expression, e.g. () => debugOn()
    const indent = (sysLine.match(/^\s*/) ?? [''])[0] + '  ';
    lines.splice(sysIdx + 1, 0,
      `${indent}// Stage tool panel — buttons reach it via panel: '${id}' on their contribute(...).`,
      `${indent}declarePanel({ ${props.join(', ')} });`,
    );
    // Route requested buttons into the panel: inject panel:'id' into each
    // matching contribute({ … command: 'X' … }) that doesn't already have one.
    // (Done after the splice so indices already reflect the inserted lines.)
    const wanted = Array.isArray(buttons) ? buttons
      : typeof buttons === 'string' ? buttons.split(',').map(s => s.trim()).filter(Boolean) : [];
    const routed = [];
    const unrouted = [];
    for (const cmd of wanted) {
      const i = lines.findIndex(l => /contribute\(\s*\{/.test(l) && l.includes(`command: '${cmd}'`));
      if (i < 0) { unrouted.push(cmd); continue; }
      if (/\bpanel:/.test(lines[i])) { routed.push(cmd); continue; }
      lines[i] = lines[i].replace(/contribute\(\s*\{/, `contribute({ panel: '${id}',`);
      routed.push(cmd);
    }
    writeFileSync(abs, lines.join('\n'));
    this.log(`[tool] add_panel ${id} (${anchor}) → ${rel}${missing.length ? ' (+declarePanel)' : ''}${routed.length ? ` +${routed.length} buttons` : ''}`);
    const routeNote = wanted.length
      ? ` Routed ${routed.length}/${wanted.length} buttons${unrouted.length ? ` (not found: ${unrouted.join(', ')} — route by hand with patch)` : ''}.`
      : ` Now route buttons: add panel: '${id}' to each contribute({ surface: 'top', … }) for this panel (or re-call add_panel with buttons:[…]).`;
    return `declared panel '${id}' (${anchor}) in ${rel}${missing.length ? ' (added declarePanel to the ctx destructure)' : ''}.${routeNote} run_test to confirm.`;
  },

tool_add_css_rule({ path = 'frontend/styles.css', selector, declarations, after }) {
    if (this.phase !== 'green') return 'add_css_rule is GREEN-phase only (it edits frontend/)';
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
  },

tool_add_edge_reverse() {
    if (this.phase !== 'green') return 'add_edge_reverse is GREEN-phase only (it edits frontend/)';

    const graphModel = this.safePath('frontend/model/graph.ts');
    const graphSystem = this.safePath('frontend/systems/graph.ts');
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
      if (regIdx < 0) return 'add_edge_reverse: no contexts.commands.register([ found in frontend/systems/graph.ts';
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
      'Files: frontend/systems/graph.ts, frontend/model/graph.ts.',
      'Now run_test to confirm.',
    ].join('\n');
  },

tool_add_graph_export_json() {
    if (this.phase !== 'green') return 'add_graph_export_json is GREEN-phase only (it edits frontend/)';

    const graphSystem = this.safePath('frontend/systems/graph.ts');
    if (!this.writeAllowed(graphSystem.rel)) return this.phaseDenied(graphSystem.rel);
    let lines = readFileSync(graphSystem.abs, 'utf8').split('\n');
    const src = () => lines.join('\n');

    this._declareEventInLines(lines, 'graph.export.json', 'void');
    this._declareEventInLines(lines, 'graph.exported', '{ json: string }');

    if (!/id:\s*['"]graph\.export\.json['"]/.test(src())) {
      const regIdx = lines.findIndex(l => /contexts\.commands\.register\(\[/.test(l));
      if (regIdx < 0) return 'add_graph_export_json: no contexts.commands.register([ found in frontend/systems/graph.ts';
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
      'File: frontend/systems/graph.ts.',
      'Now run_test to confirm.',
    ].join('\n');
  },

tool_add_container_delete_cascade() {
    if (this.phase !== 'green') return 'add_container_delete_cascade is GREEN-phase only (it edits frontend/)';

    const containersSystem = this.safePath('frontend/systems/containers.ts');
    if (!this.writeAllowed(containersSystem.rel)) return this.phaseDenied(containersSystem.rel);
    const source = readFileSync(containersSystem.abs, 'utf8');
    if (/emit\('graph\.node\.delete', \{ id: childRef\.id \}\)/.test(source)) {
      return 'add_container_delete_cascade: frontend/systems/containers.ts already cascades child node deletes';
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
    if (!source.includes(oldText)) return 'add_container_delete_cascade: expected child-release block not found in frontend/systems/containers.ts';
    writeFileSync(containersSystem.abs, source.replace(oldText, nextText));
    this.log('[tool] add_container_delete_cascade');
    return [
      'added recursive container child deletion in frontend/systems/containers.ts.',
      'Child containers emit graph.container.delete; child nodes emit graph.node.delete.',
      'Now run_test to confirm.',
    ].join('\n');
  }
};
