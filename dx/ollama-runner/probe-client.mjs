// Shared client for the dx probe (tests/commands/probes/dx-probe.test.ts).
// Spawns vitest on the probe file with the request in env, reads the JSON answer.
// Used by both the apptool CLI (repo cwd) and the dx model tools (workspace cwd).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROBE_PATH = 'tests/commands/probes/dx-probe.test.ts';

export function runProbe(cwd, request, timeoutMs = 120000) {
  const dir = mkdtempSync(join(tmpdir(), 'dx-probe-'));
  const out = join(dir, 'answer.json');
  const normalizedRequest = request?.mode === 'scenario'
    ? { ...request, ...normalizeScenarioSpec(request) }
    : request;
  try {
    try {
      execFileSync('npx', ['vitest', 'run', '--reporter=dot', PROBE_PATH], {
        cwd,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PROBE_REQUEST: JSON.stringify(normalizedRequest), PROBE_OUT: out },
      });
    } catch (err) {
      // vitest exits non-zero when the probe test itself errors; the answer
      // file (if written) still carries the real diagnostic.
      const fallback = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim();
      try { return JSON.parse(readFileSync(out, 'utf8')); }
      catch { return { error: `probe run failed: ${fallback.slice(-600)}` }; }
    }
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function singletonPath(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length !== 1) return null;
  const [key, inner] = entries[0];
  const path = prefix ? `${prefix}.${key}` : key;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return singletonPath(inner, path);
  return { path, value: inner };
}

export function normalizeScenarioSpec(spec = {}) {
  spec = spec ?? {};
  const asserts = (spec.asserts ?? []).map(assertion => {
    if (assertion.command && assertion.has && typeof assertion.has !== 'string') {
      const leaf = singletonPath(assertion.has);
      if (leaf) return { ...assertion, has: leaf.path, value: assertion.value ?? leaf.value };
    }
    if (assertion.command || typeof assertion.path !== 'string' || !assertion.has) return assertion;
    const m = assertion.path.match(/^commands\.(.+)$/);
    if (!m) return assertion;
    const { path, ...rest } = assertion;
    return { ...rest, command: m[1] };
  });
  return { ...spec, steps: spec.steps ?? [], asserts };
}

export function validateScenarioSpec(spec = {}) {
  const errors = [];
  if (!Array.isArray(spec.steps ?? [])) errors.push('steps must be an array');
  if (!Array.isArray(spec.asserts ?? [])) errors.push('asserts must be an array');
  for (const [i, step] of (spec.steps ?? []).entries()) {
    if (step.command != null && typeof step.command !== 'string') errors.push(`steps[${i}].command must be a string`);
    if (step.event != null && typeof step.event !== 'string') errors.push(`steps[${i}].event must be a string`);
  }
  for (const [i, assertion] of (spec.asserts ?? []).entries()) {
    if (assertion.path != null && typeof assertion.path !== 'string') errors.push(`asserts[${i}].path must be a string dot-path`);
    if (assertion.has != null && typeof assertion.has !== 'string') errors.push(`asserts[${i}].has must be a string dot-path`);
    if (assertion.command && /^handler(\.|$)/.test(String(assertion.has ?? ''))) {
      errors.push(`asserts[${i}] checks command.handler, but commands are data and do not store handlers. Assert behavior instead: steps view.zen then app.cancel.escape, assert ui.shell.zen false`);
    }
    if (assertion.command != null && typeof assertion.command !== 'string') errors.push(`asserts[${i}].command must be a string`);
    if (assertion.event != null && typeof assertion.event !== 'string') errors.push(`asserts[${i}].event must be a string`);
    if (assertion.file != null && typeof assertion.file !== 'string') errors.push(`asserts[${i}].file must be a string`);
    if (assertion.css != null && typeof assertion.css !== 'string') errors.push(`asserts[${i}].css must be a string selector`);
  }
  const finalPaths = new Map();
  for (const [i, assertion] of (spec.asserts ?? []).entries()) {
    if (!assertion.path || assertion.event || assertion.command || assertion.file || assertion.css) continue;
    const op = assertion.op ?? 'eq';
    if (op !== 'eq') continue;
    const key = assertion.path;
    const value = JSON.stringify(assertion.value);
    if (finalPaths.has(key) && finalPaths.get(key).value !== value) {
      errors.push(`asserts[${i}] contradicts asserts[${finalPaths.get(key).index}] for final path '${key}'. Scenario asserts final state after all steps; remove intermediate asserts`);
    } else {
      finalPaths.set(key, { value, index: i });
    }
  }
  return errors;
}

export function validateGenTestSpec(spec = {}) {
  const errors = validateScenarioSpec(spec);
  if (!Array.isArray(spec.asserts) || spec.asserts.length === 0) {
    errors.push('gen_test requires at least one assert; use scenario/app_probe for observation-only runs');
  }
  return errors;
}

/** Render a runnable vitest file from a validated scenario. Steps/asserts use
 *  the same shapes the probe's `scenario` mode takes, so the workflow is:
 *  scenario (observe actuals) → adjust expected values → genTest (red test). */
export function genTest(input) {
  const { title, steps = [], asserts = [] } = normalizeScenarioSpec(input);
  const needsFs = asserts.some(a => a.file);
  const needsTrace = asserts.some(a => a.event);
  // Command steps self-assert: a missing/unavailable command is itself red.
  const stepLines = steps.map(s => s.command
    ? `    expect(runCommand(ctx, ${JSON.stringify(s.command)}), ${JSON.stringify(`command ${s.command} should run`)}).toBe(true);\n    await settle();`
    : `    ctx.sim.replay([{ name: ${JSON.stringify(s.event)}, data: ${JSON.stringify(s.data ?? null)}, at: 0 }]);\n    await settle();`,
  ).join('\n');
  const pathExpr = (p) => `ctx.debug!.snapshot().${p}`;
  const assertLines = asserts.map(a => {
    if (a.event) {
      const found = `[...fired].reverse().find(e => e.name === ${JSON.stringify(a.event)})`;
      if (!a.path) return `    expect(fired.some(e => e.name === ${JSON.stringify(a.event)}), ${JSON.stringify(`event ${a.event} should fire`)}).toBe(true);`;
      const expr = `(${found}?.data as Record<string, unknown> | undefined)?.${a.path}`;
      return a.op === 'contains'
        ? `    expect(String(${expr})).toContain(${JSON.stringify(a.value)});`
        : `    expect(${expr}).toEqual(${JSON.stringify(a.value)});`;
    }
    if (a.command) {
      const expr = `ctx.contexts.commands.get(${JSON.stringify(a.command)})${a.has ? '?.' + a.has.split('.').join('?.') : ''}`;
      return a.value === undefined
        ? `    expect(${expr}).toBeTruthy();`
        : `    expect(${expr}).toEqual(${JSON.stringify(a.value)});`;
    }
    if (a.file) return `    expect(readFileSync(resolve(process.cwd(), ${JSON.stringify(a.file)}), 'utf8')).toMatch(/${a.matches}/);`;
    if (a.css && a.op === 'count') return `    expect(document.querySelectorAll(${JSON.stringify(a.css)}).length).toBe(${Number(a.value)});`;
    if (a.css && a.op === 'textContains') return `    expect([...document.querySelectorAll(${JSON.stringify(a.css)})].map(el => el.textContent).join('|')).toContain(${JSON.stringify(a.value)});`;
    if (a.css) return `    expect(document.querySelector(${JSON.stringify(a.css)})).not.toBeNull();`;
    const expr = pathExpr(a.path);
    const op = a.op ?? 'eq';
    if (op === 'truthy') return `    expect(${expr}).toBeTruthy();`;
    if (op === 'falsy') return `    expect(${expr}).toBeFalsy();`;
    if (op === 'gt') return `    expect(${expr}).toBeGreaterThan(${Number(a.value)});`;
    if (op === 'lt') return `    expect(${expr}).toBeLessThan(${Number(a.value)});`;
    if (op === 'contains') return `    expect(String(${expr})).toContain(${JSON.stringify(a.value)});`;
    if (op === 'neq') return `    expect(${expr}).not.toEqual(${JSON.stringify(a.value)});`;
    return `    expect(${expr}).toEqual(${JSON.stringify(a.value)});`;
  }).join('\n');
  const tracePre = needsTrace ? `    const rec = ctx.sim.record();\n    rec.start();\n` : '';
  const tracePost = needsTrace ? `    const fired = rec.stop();\n` : '';
  return `${needsFs ? "import { readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\n" : ''}import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';

describe(${JSON.stringify(title)}, () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootApp();
    await settle();
${tracePre}${stepLines}
${tracePost}${assertLines}
  });
});
`;
}
