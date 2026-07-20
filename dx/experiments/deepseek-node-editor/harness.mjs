#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const ARM = process.argv[2];
const WORKTREE = resolve(process.argv[3] || '');
const RUN = process.argv[4] || new Date().toISOString().replaceAll(':', '-');
const ARMS = new Set(['baseline', 'context', 'code-review-graph', 'file-projections', 'file-projections-optimized', 'file-projections-prefetched', 'file-projections-guided', 'file-projections-recipe']);

if (!ARMS.has(ARM) || !process.argv[3]) {
  console.error('usage: node harness.mjs baseline|context|code-review-graph|file-projections|file-projections-optimized|file-projections-prefetched|file-projections-guided|file-projections-recipe WORKTREE [run-name]');
  process.exit(2);
}
if (!existsSync(join(WORKTREE, 'package.json'))) throw new Error(`not a prepared worktree: ${WORKTREE}`);

const OUT = join(HERE, 'runs', RUN, ARM);
mkdirSync(OUT, { recursive: true });
const eventsPath = join(OUT, 'events.jsonl');
const startedAt = Date.now();
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const maxTurns = Number(process.env.EXPERIMENT_MAX_TURNS || 30);

function envFile(path) {
  const values = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

const credentials = envFile(process.env.DEEPSEEK_ENV || resolve(REPO, '../file-projections/.env'));
const apiKey = process.env.DEEPSEEK_API_KEY || credentials.API_KEY;
let apiBase = process.env.DEEPSEEK_API_HOST || credentials.API_HOST;
if (!apiKey || !apiBase) throw new Error('DeepSeek API_HOST/API_KEY unavailable');
apiBase = apiBase.replace(/\/$/, '');
if (!apiBase.endsWith('/v1')) apiBase += '/v1';

function event(type, data = {}) {
  appendFileSync(eventsPath, JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n');
}

const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 };
const metrics = {
  schema_version: 1,
  arm: ARM,
  run: RUN,
  model,
  worktree: WORKTREE,
  started_at: new Date(startedAt).toISOString(),
  api_calls: 0,
  tool_calls: 0,
  read_calls: 0,
  direct_file_reads: 0,
  navigation_calls: 0,
  edits: 0,
  tests: 0,
  first_edit: null,
  usage,
  outcome: 'running',
};
let projectionReadCount = 0;
let postEditVerificationStarted = false;
let needsVerification = false;
let repairReadsSinceEdit = 0;
const verificationTargets = new Set();

const bounded = (value, limit = 16000) => {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…<trimmed ${text.length - limit} chars>`;
};

function safePath(input) {
  if (!input || isAbsolute(input)) throw new Error('path must be repository-relative');
  const path = resolve(WORKTREE, input);
  if (path !== WORKTREE && !path.startsWith(WORKTREE + sep)) throw new Error('path escapes worktree');
  return path;
}

function editablePath(input) {
  const normalized = input.replaceAll('\\', '/');
  if (!normalized.startsWith('frontend/') && !normalized.startsWith('tests/commands/')) {
    throw new Error('edits allowed only under frontend/ or tests/commands/');
  }
  return safePath(normalized);
}

function markRead(kind) {
  metrics.read_calls++;
  if (kind === 'direct') metrics.direct_file_reads++;
  else metrics.navigation_calls++;
  if (ARM === 'file-projections-guided' && metrics.first_edit && !needsVerification) repairReadsSinceEdit++;
}

function markEdit(name) {
  metrics.edits++;
  if (!metrics.first_edit) {
    metrics.first_edit = {
      tool: name,
      wall_ms: Date.now() - startedAt,
      api_calls: metrics.api_calls,
      read_calls: metrics.read_calls,
      direct_file_reads: metrics.direct_file_reads,
      navigation_calls: metrics.navigation_calls,
      usage: { ...usage },
    };
    event('first_edit', metrics.first_edit);
  }
  if (ARM === 'file-projections-guided') {
    repairReadsSinceEdit = 0;
    needsVerification = true;
  }
}

function numbered(content, start, end) {
  const lines = content.split(/\r?\n/);
  const from = Math.max(1, Number(start) || 1);
  const to = Math.min(lines.length, Number(end) || from + 239, from + 399);
  return lines.slice(from - 1, to).map((line, i) => `${from + i}|${line}`).join('\n');
}

function listFiles({ path = '.', limit = 240 }) {
  markRead('direct');
  const root = safePath(path);
  if (!existsSync(root)) throw new Error(`missing path: ${path}`);
  const files = [];
  const visit = current => {
    if (files.length >= Math.min(Number(limit) || 240, 500)) return;
    for (const name of readdirSync(current).sort()) {
      if (['.git', 'node_modules', 'dist', 'coverage', 'test-results'].includes(name)) continue;
      const absolute = join(current, name);
      const info = statSync(absolute);
      if (info.isDirectory()) visit(absolute);
      else files.push(relative(WORKTREE, absolute));
      if (files.length >= Math.min(Number(limit) || 240, 500)) break;
    }
  };
  if (statSync(root).isDirectory()) visit(root); else files.push(relative(WORKTREE, root));
  return files.join('\n');
}

function readFile({ path, start_line = 1, end_line }) {
  markRead('direct');
  const absolute = safePath(path);
  return numbered(readFileSync(absolute, 'utf8'), start_line, end_line);
}

function search({ query, path = '.', limit = 80 }) {
  markRead('direct');
  const args = ['-n', '--fixed-strings', '--glob', '!node_modules/**', '--glob', '!dist/**', '--', String(query), path];
  try {
    return bounded(execFileSync('rg', args, { cwd: WORKTREE, encoding: 'utf8', maxBuffer: 2_000_000 }), Math.min(Number(limit) || 80, 200) * 240);
  } catch (error) {
    if (error.status === 1) return 'no matches';
    throw error;
  }
}

function stripFence(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

function editFile({ path, old_text, new_text }) {
  const absolute = editablePath(path);
  const before = readFileSync(absolute, 'utf8');
  const oldText = String(old_text);
  const count = before.split(oldText).length - 1;
  if (!oldText || count !== 1) throw new Error(`old_text must match exactly once; matches=${count}`);
  markEdit('edit_file');
  writeFileSync(absolute, before.replace(oldText, String(new_text)));
  return `updated ${path}`;
}

function writeFile({ path, content }) {
  const absolute = editablePath(path);
  mkdirSync(dirname(absolute), { recursive: true });
  markEdit('write_file');
  writeFileSync(absolute, stripFence(content) + (String(content).endsWith('\n') ? '' : '\n'));
  return `${existsSync(absolute) ? 'wrote' : 'created'} ${path}`;
}

function insertOnce(source, anchor, insertion) {
  if (source.includes(insertion.trim())) return source;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`projection integration anchor count=${count}: ${anchor}`);
  return source.replace(anchor, `${anchor}${insertion}`);
}

function applyProjection({ system_source, test_source, css_append = '' }) {
  const systemSource = stripFence(system_source);
  const testSource = stripFence(test_source);
  if (!systemSource.includes('registerAutomation') || !systemSource.includes("system('automation'")) {
    throw new Error('system_source must export/register automation system');
  }
  if (!testSource.includes('automation.example.create')) throw new Error('test_source must exercise required automation commands');
  markEdit('apply_projection');
  writeFileSync(editablePath('frontend/systems/automation.ts'), systemSource + '\n');
  writeFileSync(editablePath('tests/commands/automation.test.ts'), testSource + '\n');

  const indexPath = editablePath('frontend/systems/index.ts');
  let index = readFileSync(indexPath, 'utf8');
  index = insertOnce(index, "import type { Registry } from '../core';\n", "import { registerAutomation } from './automation';\n");
  index = insertOnce(index, '  registerGraph(system);\n', '  registerAutomation(system);\n');
  writeFileSync(indexPath, index);

  if (String(css_append).trim()) {
    const cssPath = editablePath('frontend/styles.css');
    const css = readFileSync(cssPath, 'utf8');
    if (!css.includes('/* automation projection */')) {
      writeFileSync(cssPath, `${css.trimEnd()}\n\n/* automation projection */\n${stripFence(css_append)}\n`);
    }
  }
  return 'projection applied: system, composition, CSS, focused test';
}

function applyReferenceProjection() {
  const recipeRoot = resolve(process.env.PROJECTION_RECIPE_WORKTREE
    || resolve(REPO, '../.worktrees/ecs-canvas-graph-trial-1/reference'));
  const paths = [
    'frontend/systems/automation.ts',
    'frontend/systems/index.ts',
    'frontend/styles.css',
    'tests/commands/automation.test.ts',
  ];
  for (const path of paths) {
    if (!existsSync(join(recipeRoot, path))) throw new Error(`projection recipe missing: ${recipeRoot}/${path}`);
  }
  markEdit('apply_reference_projection');
  for (const path of paths) writeFileSync(editablePath(path), readFileSync(join(recipeRoot, path), 'utf8'));
  return 'verified projection recipe applied: system, composition, CSS, focused tests';
}

function runTests({ target = 'focused' }) {
  postEditVerificationStarted = true;
  needsVerification = false;
  verificationTargets.add(target);
  metrics.tests++;
  const choices = {
    focused: ['npx', ['vitest', 'run', 'tests/commands/automation.test.ts']],
    full: ['npx', ['vitest', 'run']],
    typecheck: ['npm', ['run', 'typecheck']],
  };
  const selected = choices[target];
  if (!selected) throw new Error('target must be focused, full, or typecheck');
  try {
    return bounded(execFileSync(selected[0], selected[1], {
      cwd: WORKTREE,
      encoding: 'utf8',
      timeout: target === 'full' ? 180_000 : 120_000,
      maxBuffer: 8_000_000,
      env: { ...process.env, NO_COLOR: '1' },
    }), 10000);
  } catch (error) {
    return bounded(`EXIT ${error.status ?? 'error'}\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`, 12000);
  }
}

function gitDiff() {
  markRead('direct');
  const status = execFileSync('git', ['status', '--short'], { cwd: WORKTREE, encoding: 'utf8' });
  const diff = execFileSync('git', ['diff', '--', 'frontend', 'tests/commands'], { cwd: WORKTREE, encoding: 'utf8', maxBuffer: 8_000_000 });
  return bounded(`${status}\n${diff}`, 20000);
}

function graphQuery({ kind, query }) {
  markRead('navigation');
  const allowed = new Set(['find', 'file', 'callers', 'callees', 'tests']);
  if (!allowed.has(kind)) throw new Error('unsupported graph query kind');
  try {
    return bounded(execFileSync(process.execPath, ['dx/cli/apptool.mjs', 'graph', kind, String(query)], {
      cwd: WORKTREE,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2_000_000,
    }), 16000);
  } catch (error) {
    return bounded(`graph query failed\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`);
  }
}

function readProjection({ name = 'automation-system' }) {
  if (ARM === 'file-projections-optimized' && projectionReadCount > 0) {
    return 'projection already supplied; use apply_projection now';
  }
  projectionReadCount++;
  markRead('navigation');
  if (name !== 'automation-system') throw new Error('only automation-system projection exists');
  return readFileSync(join(HERE, 'projections', 'automation-system.projection.md'), 'utf8');
}

const commonTools = [
  {
    type: 'function', function: {
      name: 'list_files', description: 'List bounded repository files. Counts as a direct repository read.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'number' } } },
    },
  },
  {
    type: 'function', function: {
      name: 'read_file', description: 'Read a bounded repository-relative line range with line numbers.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['path'] },
    },
  },
  {
    type: 'function', function: {
      name: 'search', description: 'Fixed-string repository search. Use only for an exact unresolved anchor.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    },
  },
  {
    type: 'function', function: {
      name: 'edit_file', description: 'Replace one exact source occurrence. This is an edit event.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] },
    },
  },
  {
    type: 'function', function: {
      name: 'write_file', description: 'Write a complete file under frontend/ or tests/commands/. This is an edit event.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
  },
  {
    type: 'function', function: {
      name: 'run_tests', description: 'Run focused automation test, full Vitest suite, or TypeScript check.',
      parameters: { type: 'object', properties: { target: { type: 'string', enum: ['focused', 'full', 'typecheck'] } }, required: ['target'] },
    },
  },
  {
    type: 'function', function: {
      name: 'git_diff', description: 'Inspect current frontend/tests status and diff.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function', function: {
      name: 'finish', description: 'Finish after implementation and verification. Report concise result.',
      parameters: { type: 'object', properties: { summary: { type: 'string' }, tests: { type: 'string' } }, required: ['summary'] },
    },
  },
];

const tools = [...commonTools];
if (ARM === 'code-review-graph') tools.unshift({
  type: 'function', function: {
    name: 'graph_query',
    description: 'Query installed code-review-graph index before direct reads: find symbols, map a file, trace callers/callees, or find tests.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['find', 'file', 'callers', 'callees', 'tests'] }, query: { type: 'string' } },
      required: ['kind', 'query'],
    },
  },
});
if (ARM === 'file-projections' || ARM === 'file-projections-optimized' || ARM === 'file-projections-prefetched' || ARM === 'file-projections-guided' || ARM === 'file-projections-recipe') tools.unshift(
  {
    type: 'function', function: {
      name: 'read_projection',
      description: 'Read the single crafted, source-backed automation concept projection. Prefer this over tree/search/file discovery.',
      parameters: { type: 'object', properties: { name: { type: 'string', enum: ['automation-system'] } } },
    },
  },
  {
    type: 'function', function: {
      name: 'apply_projection',
      description: 'Apply all projection slots atomically: new automation system, deterministic index wiring, CSS append, focused test. Preferred first edit.',
      parameters: {
        type: 'object',
        properties: {
          system_source: { type: 'string' },
          test_source: { type: 'string' },
          css_append: { type: 'string' },
        },
        required: ['system_source', 'test_source', 'css_append'],
      },
    },
  },
);
if (ARM === 'file-projections-recipe') tools.unshift({
  type: 'function', function: {
    name: 'apply_reference_projection',
    description: 'Apply the independently verified automation concept recipe atomically across system, composition, CSS, and focused tests.',
    parameters: { type: 'object', properties: {} },
  },
});

const task = readFileSync(join(HERE, 'task.md'), 'utf8');
const context = ARM === 'context' ? readFileSync(join(HERE, 'context.md'), 'utf8') : '';
const prefetchedProjection = ARM === 'file-projections-prefetched' || ARM === 'file-projections-guided' || ARM === 'file-projections-recipe'
  ? readFileSync(join(HERE, 'projections', 'automation-system.projection.md'), 'utf8')
  : '';
if (prefetchedProjection) {
  projectionReadCount = 1;
  metrics.read_calls++;
  metrics.navigation_calls++;
  event('projection_prefetched', { name: 'automation-system', chars: prefetchedProjection.length });
}
const armInstruction = {
  baseline: 'No curated repository map is supplied. Discover only what is required, then make the first correct edit quickly.',
  context: 'A generic maintainer-written context.md is embedded below. Use it, then read only exact edit anchors it does not contain.',
  'code-review-graph': 'Use graph_query before direct file reads. Query structure/impact, then read only exact source needed for edits.',
  'file-projections': 'First call read_projection exactly once. Prefer apply_projection as the first edit; use direct reads only for an explicit gap or repair.',
  'file-projections-optimized': 'Pre-edit capability shaping exposes only read_projection and apply_projection. Read the projection once, then make apply_projection the first edit. Direct reads/tests unlock afterward for evidence-driven repair.',
  'file-projections-prefetched': 'The complete task projection is prefetched below. Your first and only pre-edit tool is apply_projection. Generate all three slots now; direct reads/tests unlock after that edit for evidence-driven repair.',
  'file-projections-guided': 'The complete task projection is prefetched below. First call apply_projection. Immediately afterward, run focused tests or typecheck; verification is the only post-edit capability until evidence exists. Then repair exact failures with minimal reads.',
  'file-projections-recipe': 'The complete projection is prefetched and has an independently verified reusable recipe. First call apply_reference_projection. Then run focused tests and typecheck. Do not rediscover or regenerate recipe code.',
}[ARM];

const systemPrompt = `You are a repository coding agent in a controlled efficiency experiment.
Implement the task completely in the supplied worktree using real tools. Never fabricate a tool call or test result. Keep existing architecture contracts. Do not edit EVAL_TASK.md, context fixtures, configuration, or existing tests. Add production code and new focused tests. Use no shell; run verification through run_tests. Minimize repository reads and billed tokens before first edit without guessing. After edits, inspect failures and repair. Call finish only after focused tests and typecheck; run full tests when time permits.

Experiment arm: ${ARM}
${armInstruction}
${context ? `\n--- embedded context.md ---\n${context}\n--- end context.md ---` : ''}
${prefetchedProjection ? `\n--- prefetched source-backed projection ---\n${prefetchedProjection}\n--- end projection ---` : ''}`;

const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: `${task}\n\nStart now. Preserve drawing-only graph behavior.` },
];
const transcript = [];
let done = false;
let finalText = '';

function toolSummary(name, args) {
  if (name === 'write_file') return { path: args.path, chars: String(args.content ?? '').length };
  if (name === 'edit_file') return { path: args.path, old_chars: String(args.old_text ?? '').length, new_chars: String(args.new_text ?? '').length };
  if (name === 'apply_projection') return {
    system_chars: String(args.system_source ?? '').length,
    test_chars: String(args.test_source ?? '').length,
    css_chars: String(args.css_append ?? '').length,
  };
  return args;
}

function executeTool(name, args) {
  switch (name) {
    case 'list_files': return listFiles(args);
    case 'read_file': return readFile(args);
    case 'search': return search(args);
    case 'edit_file': return editFile(args);
    case 'write_file': return writeFile(args);
    case 'run_tests': return runTests(args);
    case 'git_diff': return gitDiff();
    case 'graph_query': return graphQuery(args);
    case 'read_projection': return readProjection(args);
    case 'apply_projection': return applyProjection(args);
    case 'apply_reference_projection': return applyReferenceProjection();
    case 'finish':
      done = true;
      finalText = `${args.summary ?? ''}${args.tests ? `\n\nTests: ${args.tests}` : ''}`;
      return 'finish accepted';
    default: throw new Error(`unknown tool: ${name}`);
  }
}

event('start', { arm: ARM, model, worktree: WORKTREE, tool_names: tools.map(tool => tool.function.name) });

try {
  for (let turn = 1; turn <= maxTurns && !done; turn++) {
    const responseStarted = Date.now();
    const activeTools = ARM === 'file-projections-recipe' && !metrics.first_edit
      ? tools.filter(tool => tool.function.name === 'apply_reference_projection')
      : ARM === 'file-projections-recipe' && (!verificationTargets.has('focused') || !verificationTargets.has('typecheck'))
        ? tools.filter(tool => tool.function.name === 'run_tests')
      : ARM === 'file-projections-recipe'
        ? tools.filter(tool => tool.function.name === 'run_tests' || tool.function.name === 'finish')
      : (ARM === 'file-projections-prefetched' || ARM === 'file-projections-guided') && !metrics.first_edit
      ? tools.filter(tool => tool.function.name === 'apply_projection')
      : ARM === 'file-projections-guided' && needsVerification
        ? tools.filter(tool => tool.function.name === 'run_tests')
      : ARM === 'file-projections-guided' && repairReadsSinceEdit >= 3
        ? tools.filter(tool => ['edit_file', 'write_file', 'run_tests', 'finish'].includes(tool.function.name))
      : ARM === 'file-projections-optimized' && !metrics.first_edit
        ? tools.filter(tool => tool.function.name === (projectionReadCount ? 'apply_projection' : 'read_projection'))
        : tools;
    const allowedToolNames = new Set(activeTools.map(tool => tool.function.name));
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8192,
        messages,
        tools: activeTools,
        ...(ARM === 'file-projections-guided' || ARM === 'file-projections-recipe'
          ? { thinking: { type: 'disabled' }, tool_choice: 'required' }
          : {}),
      }),
      signal: AbortSignal.timeout(Number(process.env.EXPERIMENT_TIMEOUT_MS || 300_000)),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${body?.error?.message || JSON.stringify(body)}`);
    metrics.api_calls++;
    const u = body.usage || {};
    usage.prompt_tokens += u.prompt_tokens || 0;
    usage.completion_tokens += u.completion_tokens || 0;
    usage.total_tokens += u.total_tokens || 0;
    usage.cached_tokens += u.prompt_tokens_details?.cached_tokens || u.prompt_cache_hit_tokens || 0;
    usage.reasoning_tokens += u.completion_tokens_details?.reasoning_tokens || 0;

    const message = body.choices?.[0]?.message || { role: 'assistant', content: '' };
    const assistant = {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
    messages.push(assistant);
    transcript.push({ turn, role: 'assistant', content: assistant.content, reasoning_content: assistant.reasoning_content, tool_calls: assistant.tool_calls || [] });
    event('model_response', {
      turn,
      wall_ms: Date.now() - responseStarted,
      finish_reason: body.choices?.[0]?.finish_reason,
      usage: u,
      content_chars: assistant.content.length,
      reasoning_chars: String(assistant.reasoning_content ?? '').length,
      tool_count: assistant.tool_calls?.length ?? 0,
    });

    if (!assistant.tool_calls?.length) {
      finalText = assistant.content || 'model stopped without finish tool';
      metrics.outcome = metrics.edits ? 'stopped-after-edit' : 'stopped-before-edit';
      break;
    }

    for (const call of assistant.tool_calls) {
      metrics.tool_calls++;
      const name = call.function?.name || '';
      let args = {};
      let result;
      let ok = true;
      const callStarted = Date.now();
      try {
        args = JSON.parse(call.function?.arguments || '{}');
        if (!allowedToolNames.has(name)) throw new Error(`tool not available in this phase: ${name}`);
        result = executeTool(name, args);
      } catch (error) {
        ok = false;
        result = `ERROR: ${error.message}`;
      }
      const output = bounded(result);
      transcript.push({ turn, role: 'tool', name, args: toolSummary(name, args), ok, output });
      event('tool_result', { turn, name, args: toolSummary(name, args), ok, wall_ms: Date.now() - callStarted, output_chars: output.length });
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      if (done) break;
    }
  }
  if (done) metrics.outcome = 'finished';
  else if (metrics.outcome === 'running') metrics.outcome = 'turn-limit';
} catch (error) {
  metrics.outcome = 'harness-error';
  metrics.error = error.message;
  finalText = `Harness error: ${error.message}`;
  event('error', { message: error.message, stack: error.stack });
}

metrics.wall_ms = Date.now() - startedAt;
metrics.finished_at = new Date().toISOString();
try {
  metrics.changed_files = execFileSync('git', ['status', '--short'], { cwd: WORKTREE, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
} catch { metrics.changed_files = []; }
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
writeFileSync(join(OUT, 'transcript.json'), JSON.stringify(transcript, null, 2) + '\n');
writeFileSync(join(OUT, 'final.md'), finalText + '\n');
event('finish', { outcome: metrics.outcome, wall_ms: metrics.wall_ms, usage, first_edit: metrics.first_edit });
console.log(JSON.stringify(metrics, null, 2));
