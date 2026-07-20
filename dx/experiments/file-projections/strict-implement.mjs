#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addUsage,
  bounded,
  cleanRun,
  complete,
  emptyUsage,
  eventSink,
  HERE,
  provider,
  runCheck,
  runDir,
  runFp,
  writeJson,
} from './shared.mjs';

const run = cleanRun(process.argv[2]);
const manifest = JSON.parse(readFileSync(join(HERE, 'runs', run, 'strict-worktree.json'), 'utf8'));
const worktree = manifest.worktree.path;
const phase = cleanRun(process.env.STRICT_ATTEMPT || 'strict-implement');
const out = runDir(run, phase);
const events = eventSink(join(out, 'events.jsonl'));
const client = provider();
client.model = process.env.IMPLEMENT_MODEL || 'deepseek-v4-pro';
const usage = emptyUsage();
const transcript = [];
const plans = new Map();
const checks = [];
let planSequence = 0;
let apiCalls = 0;
let readCalls = 0;
let invalidCalls = 0;
let edits = 0;
let firstEdit = null;
let latestCoverage = null;
let finished = false;
let final = {};
let providerError = '';

const conceptDir = join(worktree, 'concepts');
const concepts = new Map((existsSync(conceptDir) ? readdirSync(conceptDir) : []).filter(name => name.endsWith('.yaml')).map(file => {
  const content = readFileSync(join(conceptDir, file), 'utf8');
  const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim() || file.replace(/\.yaml$/, '');
  const scopes = new Set();
  let section = '';
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^(inputs|outputs|owns):\s*$/);
    if (heading) { section = heading[1]; continue; }
    if (/^[a-z]/.test(line)) section = '';
    const item = section && line.match(/^\s+-\s+(.+)$/)?.[1];
    if (!item) continue;
    const path = item.replace(/^`|`$/g, '').replace(/\s+\([^)]*\)\s*$/, '').trim();
    if (path) scopes.add(path);
  }
  return [name, { file, content, scopes }];
}));

const writableFeaturePath = path => [
  /^backend\/automation\.ts$/,
  /^frontend\/systems\/automation\.ts$/,
  /^frontend\/systems\/index\.ts$/,
  /^frontend\/styles\.css$/,
  /^tests\/commands\/automation(?:-[a-z0-9-]+)?\.test\.ts$/,
  /^tsconfig\.json$/,
].some(pattern => pattern.test(path));

const assertConceptPath = (conceptName, path, mode = 'read') => {
  if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe path: ${path}`);
  const concept = concepts.get(conceptName);
  if (!concept) throw new Error(`unknown concept: ${conceptName}`);
  const covered = concept.scopes.has(path);
  if (!covered) throw new Error(`${path} is outside ${conceptName} declared inputs/outputs/owns`);
  if (mode === 'write') {
    const writable = concept.content.split(/\r?\n/).reduce((state, line) => {
      const heading = line.match(/^(outputs|owns):\s*$/);
      if (heading) return { section: heading[1], paths: state.paths };
      if (/^[a-z]/.test(line)) return { section: '', paths: state.paths };
      const item = state.section && line.match(/^\s+-\s+(.+)$/)?.[1];
      if (item) state.paths.add(item.replace(/^`|`$/g, '').replace(/\s+\([^)]*\)\s*$/, '').trim());
      return state;
    }, { section: '', paths: new Set() }).paths;
    const allowed = writable.has(path);
    if (!allowed) throw new Error(`${path} is not an output/owned path of ${conceptName}`);
    if (!writableFeaturePath(path)) throw new Error(`${path} is outside the fixed automation evaluation surface`);
  }
  return concept;
};

const tools = [
  {
    type: 'function', function: {
      name: 'concept_route', description: 'Route the task through native concept boundaries/path. No raw repository search is exposed.',
      parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    },
  },
  {
    type: 'function', function: {
      name: 'concept_view', description: 'Materialize one model-authored concept through native architecture and read that projection.',
      parameters: { type: 'object', properties: { concept: { type: 'string' } }, required: ['concept'] },
    },
  },
  {
    type: 'function', function: {
      name: 'concept_read', description: 'Read one file only when declared by the concept. Supply start/end for large files; oversized unbounded reads return a cursor hint instead of clipped repeated content.',
      parameters: { type: 'object', properties: { concept: { type: 'string' }, file: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['concept', 'file'] },
    },
  },
  {
    type: 'function', function: {
      name: 'concept_plan_file',
      description: 'Author one complete file only under the named concept outputs/ownership, then invoke native fp change plan. Apply separately.',
      parameters: { type: 'object', properties: { concept: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, required: ['concept', 'path', 'content'] },
    },
  },
  {
    type: 'function', function: {
      name: 'concept_plan_edit',
      description: 'Plan one exact revision-guarded replacement only under the named concept outputs/ownership.',
      parameters: {
        type: 'object',
        properties: {
          concept: { type: 'string' }, path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, revision: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' },
        },
        required: ['concept', 'path', 'start', 'end', 'revision', 'old', 'new'],
      },
    },
  },
  {
    type: 'function', function: {
      name: 'apply_concept_plan', description: 'Apply one previously returned concept-scoped plan id through native fp change apply.',
      parameters: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
    },
  },
  {
    type: 'function', function: {
      name: 'verify', description: 'Run focused tests, typecheck, full suite, or strict 99% automation coverage. Coverage reports exact uncovered lines.',
      parameters: { type: 'object', properties: { target: { type: 'string', enum: ['focused', 'typecheck', 'full', 'coverage'] } }, required: ['target'] },
    },
  },
  {
    type: 'function', function: {
      name: 'finish', description: 'Finish only after focused/type/full pass and statements, branches, functions, and lines coverage are each at least 99%.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  },
];

const task = readFileSync(join(HERE, 'task.md'), 'utf8');
const conceptPacket = readFileSync(join(HERE, 'runs', run, 'strict-concepts', 'concept-packet.md'), 'utf8');
const messages = [
  {
    role: 'system',
    content: `You are a fresh implementation agent. You receive only the user task and a packet produced by a separate cold concept-author model. No maintainer-authored context, concept, projection, reference implementation, file template, or change plan exists.

This is concept-scoped editing only. Route and read through concept_route/concept_view/concept_read; raw tree, search, shell, and unrestricted source reads do not exist. Every source/test change must name a model-authored concept, stay inside its declared outputs/ownership, and pass through native change plan/apply via concept_plan_file or concept_plan_edit plus apply_concept_plan. Never weaken existing tests or add dependencies. Implement the task, run focused tests and typecheck early, then iterate from strict coverage output until statements, branches, functions, and lines are all >=99%. Run the full suite and finish only after measured success.`,
  },
  { role: 'user', content: `${task}\n\n--- model-authored concept packet ---\n${conceptPacket}\n--- end packet ---\n\nImplement and reach the strict gate.` },
];

function planChange(change) {
  const id = `plan-${++planSequence}`;
  const changePath = `.projections/strict-${id}.change.json`;
  const planPath = `.projections/strict-${id}.plan.json`;
  writeJson(join(worktree, changePath), change);
  const result = runFp(['change', 'plan', '-change', changePath, '-out', planPath], worktree);
  if (result.exit_code !== 0) throw new Error(result.output);
  const plan = JSON.parse(readFileSync(join(worktree, planPath), 'utf8'));
  plans.set(id, planPath);
  return { id, authority_hash: plan.authority_hash, files: plan.files.map(file => ({ path: file.path, created: file.created, diff: bounded(file.diff, 5000) })) };
}

function conceptAnchor(conceptName) {
  const concept = concepts.get(conceptName);
  const path = [...concept.scopes].find(candidate => existsSync(join(worktree, candidate)) && !candidate.endsWith('/'));
  if (!path) throw new Error(`${conceptName} has no existing source anchor for a native change plan`);
  return path;
}

function coverageSummary() {
  const path = join(worktree, 'coverage', 'strict-automation', 'coverage-summary.json');
  if (!existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, 'utf8'));
  return report.total || null;
}

events('start', { run, worktree, model: client.model });
try {
for (let turn = 1; turn <= Number(process.env.IMPLEMENT_MAX_TURNS || 60) && !finished; turn++) {
  const response = await complete(client, messages, tools, Number(process.env.IMPLEMENT_MAX_TOKENS || 8192));
  apiCalls++;
  addUsage(usage, response.usage);
  const raw = response.choices?.[0]?.message || { role: 'assistant', content: '' };
  const assistant = { role: 'assistant', content: raw.content || '', ...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}) };
  messages.push(assistant);
  transcript.push({ turn, ...assistant });
  if (!assistant.tool_calls?.length) break;

  for (const call of assistant.tool_calls) {
    let args = {};
    let output = '';
    let ok = true;
    try {
      args = JSON.parse(call.function?.arguments || '{}');
      if (call.function?.name === 'concept_route') {
        const question = String(args.question).replace(/\s+/g, ' ').slice(0, 500);
        const boundaries = runFp(['boundaries', '-root', '.', question], worktree);
        const path = runFp(['path', '-root', '.', question], worktree);
        readCalls++;
        ok = boundaries.exit_code === 0 && path.exit_code === 0;
        output = `${boundaries.output}\n${path.output}`;
      } else if (call.function?.name === 'concept_view') {
        const concept = concepts.get(args.concept);
        if (!concept) throw new Error(`unknown concept: ${args.concept}`);
        const result = runFp(['architecture', 'materialize', args.concept, '-root', '.'], worktree);
        readCalls++;
        ok = result.exit_code === 0;
        const projection = join(worktree, '.projections', 'concepts', `${args.concept}.projection`);
        output = `${concept.content}\n\n${result.output}\n${existsSync(projection) ? readFileSync(projection, 'utf8') : ''}`;
      } else if (call.function?.name === 'concept_read') {
        assertConceptPath(args.concept, args.file);
        const ranged = Number.isInteger(args.start) && Number.isInteger(args.end);
        if ((args.start !== undefined || args.end !== undefined) && !ranged) throw new Error('start and end must be supplied together');
        if (ranged && (args.start < 1 || args.end < args.start || args.end - args.start > 400)) throw new Error('range must be ascending and at most 401 lines');
        const result = ranged
          ? runFp(['query', '-kind', 'bookmark', '-file', args.file, '-range', `${args.start}-${args.end}`, '-limit', String(args.end - args.start + 1)], worktree)
          : runFp(['explore', 'file', '-file', args.file], worktree);
        readCalls++;
        ok = result.exit_code === 0;
        if (!ranged && result.output.length > 18000) {
          const lineCount = readFileSync(join(worktree, args.file), 'utf8').split(/\r?\n/).length;
          ok = false;
          output = `file has ${lineCount} lines; retry concept_read with an explicit start/end range (max 401 lines)`;
        } else output = result.output;
      } else if (call.function?.name === 'concept_plan_file') {
        assertConceptPath(args.concept, args.path, 'write');
        const anchor = conceptAnchor(args.concept);
        output = JSON.stringify(planChange({
          query: { kind: 'bookmark', inputs: [{ file: anchor, line: 1 }], limit: 5 },
          files: [{ path: args.path, content: args.content }],
        }), null, 2);
      } else if (call.function?.name === 'concept_plan_edit') {
        assertConceptPath(args.concept, args.path, 'write');
        output = JSON.stringify(planChange({
          query: { kind: 'bookmark', inputs: [{ file: args.path, range: { start: args.start, end: args.end } }], limit: 10 },
          edits: [{ origin: { path: args.path, range: { start: args.start, end: args.end }, revision: args.revision }, old: args.old, new: args.new }],
        }), null, 2);
      } else if (call.function?.name === 'apply_concept_plan') {
        const planPath = plans.get(args.plan_id);
        if (!planPath) throw new Error('unknown plan id');
        const resultPath = `.projections/strict-${args.plan_id}.apply.json`;
        const result = runFp(['change', 'apply', '-plan', planPath, '-out', resultPath], worktree, 120_000);
        if (result.exit_code !== 0) throw new Error(result.output);
        edits++;
        if (!firstEdit) firstEdit = { api_calls: apiCalls, read_calls: readCalls, usage: { ...usage } };
        output = `applied ${args.plan_id} through native concept-scoped fp change apply`;
      } else if (call.function?.name === 'verify') {
        const testFiles = [
          'tests/commands/automation-backend.test.ts',
          'tests/commands/automation.test.ts',
          'tests/commands/automation-canvas.test.ts',
        ].filter(path => existsSync(join(worktree, path)));
        const definitions = {
          focused: ['npx', ['vitest', 'run', ...testFiles], 120_000],
          typecheck: ['npm', ['run', 'typecheck'], 120_000],
          full: ['npx', ['vitest', 'run'], 240_000],
          coverage: ['npx', [
            'vitest', 'run', ...testFiles,
            '--coverage', '--coverage.include=backend/automation.ts', '--coverage.include=frontend/systems/automation.ts',
            '--coverage.reporter=text', '--coverage.reporter=json-summary', '--coverage.reportsDirectory=coverage/strict-automation',
          ], 180_000],
        };
        const selected = definitions[args.target];
        const check = runCheck(`strict-${args.target}-${checks.length + 1}`, selected[0], selected[1], worktree, out, selected[2]);
        checks.push({ ...check, target: args.target, edit_generation: edits });
        ok = check.passed;
        if (args.target === 'coverage') latestCoverage = coverageSummary();
        output = `${check.output}\nCOVERAGE_JSON ${JSON.stringify(latestCoverage)}`;
      } else if (call.function?.name === 'finish') {
        const passed = target => checks.some(check => check.target === target && check.passed && check.edit_generation === edits);
        const percentages = latestCoverage ? ['statements', 'branches', 'functions', 'lines'].map(key => latestCoverage[key]?.pct ?? 0) : [];
        if (!passed('focused') || !passed('typecheck') || !passed('full') || !passed('coverage') || percentages.length !== 4 || percentages.some(value => value < 99)) {
          throw new Error(`gate incomplete after edit ${edits}: focused=${passed('focused')} typecheck=${passed('typecheck')} full=${passed('full')} coverage=${percentages.join('/')}`);
        }
        final = args;
        finished = true;
        output = 'strict gate accepted';
      } else throw new Error(`unknown tool ${call.function?.name}`);
      if (!ok) invalidCalls++;
    } catch (error) {
      ok = false;
      invalidCalls++;
      output = `ERROR: ${error.message}`;
    }
    const clipped = bounded(output, 20000);
    const safeArgs = ['concept_plan_file'].includes(call.function?.name)
      ? { concept: args.concept, path: args.path, content_chars: String(args.content || '').length }
      : ['concept_plan_edit'].includes(call.function?.name)
        ? { ...args, old_chars: String(args.old || '').length, new_chars: String(args.new || '').length, old: undefined, new: undefined }
        : args;
    transcript.push({ turn, role: 'tool', name: call.function?.name, args: safeArgs, ok, output: clipped });
    messages.push({ role: 'tool', tool_call_id: call.id, content: clipped });
    events('tool_result', { turn, name: call.function?.name, ok, output_chars: clipped.length });
    if (finished) break;
  }
}
} catch (error) {
  providerError = String(error?.message || error);
  events('provider_error', { message: providerError });
}

let changedFiles = [];
try { changedFiles = execFileSync('git', ['status', '--short'], { cwd: worktree, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); } catch {}
const metrics = {
  schema_version: 1,
  phase,
  run,
  model: client.model,
  api_calls: apiCalls,
  read_calls: readCalls,
  invalid_calls: invalidCalls,
  edits,
  first_edit: firstEdit,
  usage,
  coverage: latestCoverage,
  checks: checks.map(({ output, ...check }) => check),
  changed_files: changedFiles,
  finished,
  provider_error: providerError || null,
};
writeJson(join(out, 'metrics.json'), metrics);
writeJson(join(out, 'transcript.json'), transcript);
writeJson(join(out, 'final.json'), final);
events('finish', metrics);
console.log(JSON.stringify(metrics, null, 2));
