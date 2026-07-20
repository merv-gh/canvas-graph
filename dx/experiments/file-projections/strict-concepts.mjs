#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  runDir,
  runFp,
  writeJson,
} from './shared.mjs';

const run = cleanRun(process.argv[2]);
const manifest = JSON.parse(readFileSync(join(HERE, 'runs', run, 'strict-worktree.json'), 'utf8'));
const worktree = manifest.worktree.path;
const out = runDir(run, 'strict-concepts');
const events = eventSink(join(out, 'events.jsonl'));
const client = provider();
client.model = process.env.CONCEPT_MODEL || client.model;
const usage = emptyUsage();
const transcript = [];
const saved = [];
let apiCalls = 0;
let readCalls = 0;
let invalidCalls = 0;
let finished = false;
let final = {};
let providerError = '';

const tools = [
  {
    type: 'function', function: {
      name: 'fp_tree',
      description: 'Use the real binary to list repository files. This is read-only.',
      parameters: { type: 'object', properties: { source_root: { type: 'string' } } },
    },
  },
  {
    type: 'function', function: {
      name: 'fp_file',
      description: 'Use the real binary to read one repository-relative text file and its revision.',
      parameters: { type: 'object', properties: { file: { type: 'string' }, source_root: { type: 'string' } }, required: ['file'] },
    },
  },
  {
    type: 'function', function: {
      name: 'fp_line',
      description: 'Use the real binary to inspect one exact source line and enclosing symbol.',
      parameters: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer' }, source_root: { type: 'string' }, question: { type: 'string' } }, required: ['file', 'line'] },
    },
  },
  {
    type: 'function', function: {
      name: 'save_concept',
      description: 'The only write capability. Author one structured durable concept; the harness renders the binary’s restricted YAML schema, then invokes native artifact-plan and artifact-apply. Path is forced under concepts/. No production or test file can be changed.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          question: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          inputs: { type: 'array', items: { type: 'string' } },
          outputs: { type: 'array', items: { type: 'string' } },
          owns: { type: 'array', items: { type: 'string' } },
          file: { type: 'string' },
          line: { type: 'integer' },
          seed_symbol: { type: 'string' },
          additional_symbols: { type: 'array', items: { type: 'string' } },
          handoffs: {
            type: 'array',
            items: {
              type: 'object',
              properties: { to: { type: 'string' }, kind: { type: 'string', enum: ['data', 'state', 'control', 'responsibility'] }, via: { type: 'string' } },
              required: ['to', 'kind', 'via'],
            },
          },
        },
        required: ['name', 'question', 'inputs', 'outputs', 'owns', 'file', 'line', 'seed_symbol'],
      },
    },
  },
  {
    type: 'function', function: {
      name: 'validate_concepts',
      description: 'Run native architecture and boundaries over the concepts authored so far. Use this before finishing; every required concept must appear in the native architecture index.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function', function: {
      name: 'finish_concepts',
      description: 'Finish after at least three connected, natively materializable concepts cover the task.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  },
];

const task = readFileSync(join(HERE, 'task.md'), 'utf8');
const messages = [
  {
    role: 'system',
    content: `You are the concept-author agent in a cold fairness experiment. No maintainer context, concept, projection, implementation recipe, reference code, or change plan is supplied. Explore only through the real file-projections-backed tools.

Your only write is save_concept, which is mechanically restricted to concepts/*.yaml and applied through native artifact-plan/artifact-apply. You cannot edit production or tests. You have a hard budget of 12 repository reads; this is concept modeling, not exhaustive source review. Create a small connected concept system sufficient for a fresh coding agent to implement and verify the user task. Use real source symbols as seeds and explicit handoffs. Include file placement, invariants, verification commands, and likely integration seams in owns/inputs/outputs—but do not embed source code, full-file templates, patches, or a change plan. A concept absent from native architecture validation is unusable. Begin saving concepts once you have valid source anchors, then validate and repair the concept system before finishing.`,
  },
  { role: 'user', content: `${task}\n\nExplore the cold repository, author the concept system, then finish.` },
];

events('start', { run, worktree, model: client.model });
try {
for (let turn = 1; turn <= Number(process.env.CONCEPT_MAX_TURNS || 28) && !finished; turn++) {
  const response = await complete(client, messages, tools, Number(process.env.CONCEPT_MAX_TOKENS || 6144));
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
      if (call.function?.name === 'fp_tree') {
        if (readCalls >= 12) throw new Error('read budget exhausted; call save_concept now');
        const argv = ['explore', 'tree', ...(args.source_root ? ['-source-root', args.source_root] : [])];
        const result = runFp(argv, worktree);
        readCalls++;
        ok = result.exit_code === 0;
        output = result.output;
      } else if (call.function?.name === 'fp_file') {
        if (readCalls >= 12) throw new Error('read budget exhausted; call save_concept now');
        const argv = ['explore', 'file', '-file', args.file, ...(args.source_root ? ['-source-root', args.source_root] : [])];
        const result = runFp(argv, worktree);
        readCalls++;
        ok = result.exit_code === 0;
        output = result.output;
      } else if (call.function?.name === 'fp_line') {
        if (readCalls >= 12) throw new Error('read budget exhausted; call save_concept now');
        const argv = ['explore', 'line', '-file', args.file, '-line', String(args.line), ...(args.source_root ? ['-source-root', args.source_root] : []), ...(args.question ? ['-question', args.question] : [])];
        const result = runFp(argv, worktree);
        readCalls++;
        ok = result.exit_code === 0;
        output = result.output;
      } else if (call.function?.name === 'save_concept') {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(args.name)) throw new Error('concept name must be kebab-case');
        const scalar = value => String(value || '').replace(/\s+/g, ' ').trim();
        const list = (name, values = []) => values.length ? `\n${name}:\n${values.map(value => `  - ${scalar(value)}`).join('\n')}` : '';
        const symbols = [...new Set([args.seed_symbol, ...(args.additional_symbols || [])].map(scalar).filter(Boolean))];
        const handoffs = (args.handoffs || []).length
          ? `\nhandoffs:\n${args.handoffs.map(item => `  - to: ${scalar(item.to)}\n    kind: ${scalar(item.kind)}\n    via: ${scalar(item.via)}`).join('\n')}`
          : '';
        const content = `name: ${args.name}\nquestion: ${scalar(args.question)}${list('aliases', args.aliases)}${list('inputs', args.inputs)}${list('outputs', args.outputs)}${list('owns', args.owns)}\n\nsources:\n${symbols.map(symbol => `  - symbol: ${symbol}`).join('\n')}${handoffs}\n`;
        const path = `concepts/${args.name}.yaml`;
        const planned = runFp([
          'explore', 'artifact-plan', '-kind', 'concept', '-name', args.name,
          '-file', args.file, '-line', String(args.line), '-path', path, '-content', content,
        ], worktree);
        if (planned.exit_code !== 0) throw new Error(planned.output);
        const artifact = JSON.parse(planned.stdout);
        if (!artifact.plan?.files?.every(file => file.path.startsWith('concepts/'))) throw new Error('artifact escaped concepts/');
        mkdirSync(join(worktree, '.projections'), { recursive: true });
        const planPath = `.projections/strict-${args.name}.plan.json`;
        writeJson(join(worktree, planPath), artifact.plan);
        const applied = runFp(['explore', 'artifact-apply', '-plan', planPath], worktree);
        if (applied.exit_code !== 0) throw new Error(applied.output);
        const architecture = runFp(['architecture', '-root', '.'], worktree);
        if (architecture.exit_code !== 0) throw new Error(architecture.output);
        const index = readFileSync(join(worktree, '.projections', 'index.projection'), 'utf8');
        const materializable = index.split(/\r?\n/).some(line => line.trim().startsWith(`${args.name} `));
        if (!materializable) throw new Error(`native apply wrote ${path}, but architecture did not materialize ${args.name}:\n${index}`);
        const record = { name: args.name, path, seed: `${args.file}:${args.line}` };
        const previous = saved.findIndex(item => item.name === args.name);
        if (previous >= 0) saved[previous] = record;
        else saved.push(record);
        output = `saved and materialized ${path} through native artifact plan/apply`;
      } else if (call.function?.name === 'validate_concepts') {
        const architecture = runFp(['architecture', '-root', '.'], worktree);
        const boundaries = runFp(['boundaries', '-root', '.', task.replace(/\s+/g, ' ').slice(0, 500)], worktree);
        ok = architecture.exit_code === 0 && boundaries.exit_code === 0;
        const index = existsSync(join(worktree, '.projections', 'index.projection'))
          ? readFileSync(join(worktree, '.projections', 'index.projection'), 'utf8')
          : architecture.output;
        output = `${index}\n${boundaries.output}`;
      } else if (call.function?.name === 'finish_concepts') {
        if (new Set(saved.map(item => item.name)).size < 3) throw new Error('at least three concepts required');
        final = args;
        finished = true;
        output = 'concept phase complete';
      } else throw new Error(`unknown tool ${call.function?.name}`);
      if (!ok) invalidCalls++;
    } catch (error) {
      ok = false;
      invalidCalls++;
      output = `ERROR: ${error.message}`;
    }
    const clipped = bounded(output, 8000);
    transcript.push({ turn, role: 'tool', name: call.function?.name, args, ok, output: clipped });
    messages.push({ role: 'tool', tool_call_id: call.id, content: clipped });
    events('tool_result', { turn, name: call.function?.name, ok, output_chars: clipped.length });
    if (finished) break;
  }
}
} catch (error) {
  providerError = String(error?.message || error);
  events('provider_error', { message: providerError });
}

const architecture = runFp(['architecture', '-root', '.'], worktree);
const boundaries = runFp(['boundaries', '-root', '.', task.replace(/\s+/g, ' ').slice(0, 500)], worktree);
const path = runFp(['path', '-root', '.', task.replace(/\s+/g, ' ').slice(0, 500)], worktree);
const conceptDir = join(worktree, 'concepts');
const conceptFiles = existsSync(conceptDir) ? readdirSync(conceptDir).filter(name => name.endsWith('.yaml')).sort() : [];
const conceptText = conceptFiles.map(name => `## concepts/${name}\n\n\`\`\`yaml\n${readFileSync(join(conceptDir, name), 'utf8')}\`\`\``).join('\n\n');
const projectionPath = join(worktree, '.projections', 'paths');
const projections = (existsSync(projectionPath) ? readdirSync(projectionPath) : []).filter(name => name.endsWith('.projection')).sort()
  .map(name => `## .projections/paths/${name}\n\n\`\`\`text\n${readFileSync(join(projectionPath, name), 'utf8')}\`\`\``).join('\n\n');
const packet = `# Model-authored concept packet\n\n## Boundaries\n\n\`\`\`text\n${boundaries.output}\`\`\`\n\n${conceptText}\n\n${projections}\n`;
writeFileSync(join(out, 'concept-packet.md'), packet);
writeFileSync(join(worktree, 'EVAL_CONCEPT_PACKET.md'), packet);

const metrics = {
  schema_version: 1,
  phase: 'strict-concepts',
  run,
  model: client.model,
  api_calls: apiCalls,
  read_calls: readCalls,
  invalid_calls: invalidCalls,
  concepts: saved,
  concept_files: conceptFiles,
  usage,
  finished,
  architecture_ok: architecture.exit_code === 0,
  path_ok: path.exit_code === 0,
  provider_error: providerError || null,
};
writeJson(join(out, 'metrics.json'), metrics);
writeJson(join(out, 'transcript.json'), transcript);
writeJson(join(out, 'final.json'), final);
events('finish', metrics);
console.log(JSON.stringify(metrics, null, 2));
