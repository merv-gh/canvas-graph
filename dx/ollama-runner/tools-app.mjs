import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { genTest, normalizeScenarioSpec, runProbe, validateGenTestSpec, validateScenarioSpec } from './probe-client.mjs';
import { graphQuery } from './graphdb.mjs';
import { repairJson } from './ollama.mjs';

export const appTools = {
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
  },

async tool_gen_layout_test({ title, spec }) {
    if (this.phase !== 'red') return 'gen_layout_test is RED-phase only. GREEN edits frontend/ and re-runs run_test.';
    if (!this.browser) return 'gen_layout_test: layout oracle unavailable (no browser session)';
    const parsed = this.parseSpec(spec);
    if (!parsed || !Array.isArray(parsed.asserts) || !parsed.asserts.length) {
      return 'gen_layout_test: send {steps:[…], asserts:[…]} with focus/rect/style/path asserts stating the DESIRED behavior.';
    }
    await this.browser.fresh();
    const { pass, results } = await this.browser.probe(parsed);
    const lines = results.map(r => `${r.ok ? 'PASS' : 'FAIL'}: ${r.label}${r.ok ? '' : ` — actual: ${JSON.stringify(r.actual)}`}`);
    if (pass) return `These asserts already PASS on current code — not a red test. Choose asserts for the currently-broken behavior.\n${lines.join('\n')}`;
    const rel = `tests/commands/dx/${this.task.id}.layout.json`;
    if (!this.writeAllowed(rel)) return this.phaseDenied(rel);
    const { abs } = this.safePath(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify({
      title: title ?? this.task.id,
      ...(parsed.viewport ? { viewport: parsed.viewport } : {}),
      steps: parsed.steps ?? [],
      asserts: parsed.asserts,
    }, null, 2)}\n`);
    return `wrote ${rel} — layout oracle is RED (${results.filter(r => !r.ok).length}/${results.length} asserts fail):\n${lines.join('\n')}\nNow run_test it to advance to GREEN, then edit frontend/.`;
  },

async tool_app({ action, arg = '' }) {
    if (!this.browser) return 'app tools unavailable (no browser session)';
    // A walk is a stateful user journey: reloading before every command erases
    // the graph and makes later steps report false regressions. RED/GREEN tasks
    // still reload here so browser observations pick up source edits without
    // depending on HMR.
    if (this.phase !== 'walk') await this.browser.fresh();
    if (action === 'command') {
      const r = await this.browser.runCommand(arg);
      const snap = await this.browser.snapshot('ui');
      return `ran=${r.ran}\nui after: ${JSON.stringify(snap).slice(0, 700)}`;
    }
    if (action === 'snapshot') return JSON.stringify(await this.browser.snapshot(arg), null, 1);
    if (action === 'eval') return String(await this.browser.evalJs(arg));
    if (action === 'viewport') return `viewport=${await this.browser.setViewport(arg)}`;
    if (action === 'screenshot') {
      const { summary } = await this.browser.screenshot(this.phase);
      return summary;
    }
    return `unknown app action: ${action}`;
  },

parseSpec(spec) {
    if (spec && typeof spec === 'object') return spec;
    for (const candidate of [spec, repairJson(String(spec ?? ''))]) {
      try { return JSON.parse(candidate); } catch { /* next */ }
    }
    return null;
  },

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
  },

tool_scenario({ spec }) {
    const parsed = normalizeScenarioSpec(this.parseSpec(spec));
    if (!parsed) return 'scenario: spec is not valid JSON — send {steps:[…],asserts:[…]}';
    const shapeErrors = validateGenTestSpec(parsed);
    if (shapeErrors.length) return `scenario: invalid spec shape — ${shapeErrors.join('; ')}`;
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
  },

tool_gen_test({ title, spec }) {
    if (this.phase !== 'red') {
      return [
        'gen_test is RED-phase only. GREEN keeps the existing failing test; do not rewrite it.',
        `Current test: ${this.taskTestPath ?? this.defaultTestPath ?? 'tests/commands/dx/<task>.test.ts'}.`,
        'Use projection/inspect/scenario to identify the remaining failed assertion, then edit frontend/ with the constructor tool (set_command/add_command/etc.) and run_test again.',
      ].join('\n');
    }
    const parsed = normalizeScenarioSpec(this.parseSpec(spec));
    if (!parsed) return 'gen_test: spec is not valid JSON';
    const shapeErrors = validateScenarioSpec(parsed);
    if (shapeErrors.length) return `gen_test: invalid spec shape — ${shapeErrors.join('; ')}`;
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
    if (badCss) return `gen_test: css asserts support op=count|exists|textContains only. To assert CSS source text (rules like dashed border), use {"file":"frontend/styles.css","matches":"..."} with no steps.`;
    const validation = runProbe(this.ws.dir, { mode: 'scenario', steps: parsed.steps ?? [], asserts: [] });
    if (validation.error) return `gen_test: scenario validation failed: ${validation.error}`;
    // UNAVAILABLE = broken preconditions (a spec bug) — block. UNKNOWN commands
    // are allowed: for feature tasks the not-yet-existing command IS the red
    // (generated steps assert runCommand(...) === true, failing until GREEN).
    const blocked = validation.steps?.find(s => !s.ok && (s.detail ?? '').includes('UNAVAILABLE'));
    const commandSpecOnly = (parsed.asserts ?? []).length > 0
      && (parsed.asserts ?? []).every(a => a.command && !a.event && !a.path && !a.file && !a.css);
    if (blocked && commandSpecOnly) {
      return `gen_test: command-spec asserts inspect the registry without running commands. Remove all steps and keep only asserts like {"command":"${(parsed.asserts ?? [])[0]?.command}","has":"input.key","value":"."}.`;
    }
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
    const source = genTest({ title: title ?? 'dx case', steps: parsed.steps ?? [], asserts: parsed.asserts ?? [] });
    const target = this.defaultTestPath;
    const { abs, rel } = this.safePath(target);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, source);
    this.log(`[tool] gen_test → ${rel}`);
    return [`wrote ${rel} (${source.split('\n').length} lines).`, ...unknownNotes, 'Now run_test it — it should FAIL to be a valid red test.'].join('\n');
  },

tool_graph({ mode, query }) {
    const answer = graphQuery(this.ws.repoRoot, mode, query ?? '');
    if (answer.error) return `graph: ${answer.error}`;
    if (!Array.isArray(answer) || !answer.length) return `graph ${mode}: no results for "${query}"`;
    return answer.map(r =>
      r.file ? `${r.kind ?? ''} ${r.name ?? r.qualified ?? r.test} — ${r.file}:${r.line ?? '?'}` : JSON.stringify(r),
    ).join('\n');
  },

tool_note() { return 'noted'; },

tool_done() { return 'phase check running…'; },

tool_give_up() { return 'giving up'; }
};

