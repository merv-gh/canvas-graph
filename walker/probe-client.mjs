// Shared client for the walker probe (tests/commands/probes/walker-probe.test.ts).
// Spawns vitest on the probe file with the request in env, reads the JSON answer.
// Used by both the apptool CLI (repo cwd) and the walker model tools (workspace cwd).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROBE_PATH = 'tests/commands/probes/walker-probe.test.ts';

export function runProbe(cwd, request, timeoutMs = 120000) {
  const dir = mkdtempSync(join(tmpdir(), 'walker-probe-'));
  const out = join(dir, 'answer.json');
  try {
    try {
      execFileSync('npx', ['vitest', 'run', '--reporter=dot', PROBE_PATH], {
        cwd,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PROBE_REQUEST: JSON.stringify(request), PROBE_OUT: out },
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

export function normalizeScenarioSpec(spec = {}) {
  spec = spec ?? {};
  const asserts = (spec.asserts ?? []).map(assertion => {
    if (assertion.command || !assertion.path || !assertion.has) return assertion;
    const m = String(assertion.path).match(/^commands\.(.+)$/);
    if (!m) return assertion;
    const { path, ...rest } = assertion;
    return { ...rest, command: m[1] };
  });
  return { ...spec, steps: spec.steps ?? [], asserts };
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
import { bootV2, runCommand, settle } from '../v2-testkit';

describe(${JSON.stringify(title)}, () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootV2();
    await settle();
${tracePre}${stepLines}
${tracePost}${assertLines}
  });
});
`;
}
