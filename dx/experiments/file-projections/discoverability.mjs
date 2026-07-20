#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addUsage,
  bounded,
  cleanRun,
  complete,
  emptyUsage,
  eventSink,
  HERE,
  manifestFor,
  provider,
  runDir,
  runFp,
  writeJson,
} from './shared.mjs';

const run = cleanRun(process.argv[2]);
const manifest = manifestFor(run);
const worktree = manifest.worktrees.discoverability.path;
const out = runDir(run, 'discoverability');
const events = eventSink(join(out, 'events.jsonl'));
const client = provider();
const usage = emptyUsage();
const started = Date.now();
const calls = [];
const transcript = [];
let apiCalls = 0;
let invalidCalls = 0;
let finished = false;
let final = {};

const tools = [
  {
    type: 'function',
    function: {
      name: 'run_file_projections',
      description: 'Run the real standalone file-projections binary in the repository. Pass argv only, without the binary name or shell syntax. Empty args opens its front door. Source-changing commands are blocked in this read-only discoverability experiment.',
      parameters: {
        type: 'object',
        properties: { args: { type: 'array', items: { type: 'string' } } },
        required: ['args'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish with the discovered concept-creation and native plan/apply recipe.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          concept_command: { type: 'string' },
          plan_command: { type: 'string' },
          apply_command: { type: 'string' },
        },
        required: ['summary', 'concept_command', 'plan_command', 'apply_command'],
      },
    },
  },
];

const task = readFileSync(join(HERE, 'task.md'), 'utf8');
const messages = [
  {
    role: 'system',
    content: `You are evaluating whether an unfamiliar agent can operate a standalone repository tool by itself. Use only run_file_projections. Do not use prior knowledge of its subcommands: begin at the binary's front door, inspect its own guidance, and discover the workflow. Do not edit source or apply a change.

Goal: determine how to create a durable concept-first editing recipe for the task. You must observe how context behaves before a concept exists, obtain one valid concept artifact plan anchored to a real enclosing source symbol, and finish with exact native commands for concept planning plus transactionally planning/applying a saved ConceptChange JSON. Invalid commands are measured, so follow returned guidance precisely.`,
  },
  { role: 'user', content: `${task}\n\nDiscover the tool-driven recipe; do not implement the feature.` },
];

const forbidden = args => {
  const command = args.join(' ');
  return /(^|\s)(watch|edit|menu|ui|sync)(\s|$)/.test(command)
    || /change\s+apply/.test(command)
    || /artifact-apply/.test(command)
    || /--write|-write/.test(command);
};

events('start', { run, worktree, model: client.model });
for (let turn = 1; turn <= Number(process.env.EXPERIMENT_MAX_TURNS || 16) && !finished; turn++) {
  const response = await complete(client, messages, tools);
  apiCalls++;
  addUsage(usage, response.usage);
  const raw = response.choices?.[0]?.message || { role: 'assistant', content: '' };
  const assistant = {
    role: 'assistant',
    content: raw.content || '',
    ...(raw.tool_calls?.length ? { tool_calls: raw.tool_calls } : {}),
  };
  messages.push(assistant);
  transcript.push({ turn, ...assistant });
  events('model_response', { turn, usage: response.usage, tool_count: assistant.tool_calls?.length || 0 });
  if (!assistant.tool_calls?.length) break;

  for (const call of assistant.tool_calls) {
    let args = {};
    let output = '';
    let ok = true;
    try {
      args = JSON.parse(call.function?.arguments || '{}');
      if (call.function?.name === 'finish') {
        final = args;
        finished = true;
        output = 'finish accepted';
      } else if (call.function?.name === 'run_file_projections') {
        if (!Array.isArray(args.args) || args.args.some(value => typeof value !== 'string')) throw new Error('args must be a string array');
        if (forbidden(args.args)) throw new Error('source-changing or interactive command blocked');
        const result = runFp(args.args, worktree);
        ok = result.exit_code === 0;
        if (!ok) invalidCalls++;
        output = `exit=${result.exit_code}\n${result.output}`;
        calls.push({ turn, args: args.args, exit_code: result.exit_code, output: bounded(result.output, 12000) });
      } else {
        throw new Error(`unknown tool ${call.function?.name}`);
      }
    } catch (error) {
      ok = false;
      invalidCalls++;
      output = `ERROR: ${error.message}`;
    }
    const boundedOutput = bounded(output, 16000);
    transcript.push({ turn, role: 'tool', name: call.function?.name, args, ok, output: boundedOutput });
    messages.push({ role: 'tool', tool_call_id: call.id, content: boundedOutput });
    events('tool_result', { turn, name: call.function?.name, args, ok, output_chars: boundedOutput.length });
    if (finished) break;
  }
}

const commandText = calls.map(call => call.args.join(' ')).join('\n');
const finalText = JSON.stringify(final);
const criteria = {
  opened_front_door: calls.some(call => call.args.length === 0 || ['help', '--help'].includes(call.args[0])),
  checked_context: calls.some(call => call.args[0] === 'context'),
  observed_abstention: calls.some(call => /"abstained"\s*:\s*true|concept confidence too low/.test(call.output)),
  valid_concept_plan: calls.some(call => call.exit_code === 0 && call.args[0] === 'explore' && call.args[1] === 'artifact-plan' && /"kind"\s*:\s*"concept"/.test(call.output) && /"plan"\s*:/.test(call.output)),
  native_plan_command: /change plan/.test(finalText),
  native_apply_command: /change apply/.test(finalText),
};
let score = 0;
if (criteria.opened_front_door) score += 10;
if (criteria.checked_context) score += 15;
if (criteria.observed_abstention) score += 15;
if (criteria.valid_concept_plan) score += 35;
if (criteria.native_plan_command) score += 10;
if (criteria.native_apply_command) score += 10;
if (invalidCalls <= 1) score += 5;

const metrics = {
  schema_version: 1,
  phase: 'discoverability',
  run,
  model: client.model,
  worktree,
  api_calls: apiCalls,
  fp_calls: calls.length,
  invalid_calls: invalidCalls,
  calls_to_valid_concept_plan: criteria.valid_concept_plan
    ? calls.findIndex(call => call.exit_code === 0 && call.args[0] === 'explore' && call.args[1] === 'artifact-plan' && /"plan"\s*:/.test(call.output)) + 1
    : null,
  usage,
  wall_ms: Date.now() - started,
  finished,
  score,
  max_score: 100,
  criteria,
  command_text: commandText,
};
writeJson(join(out, 'metrics.json'), metrics);
writeJson(join(out, 'transcript.json'), transcript);
writeJson(join(out, 'final.json'), final);
writeFileSync(join(out, 'commands.txt'), calls.map(call => `${call.exit_code}\t${call.args.join(' ')}`).join('\n') + '\n');
events('finish', metrics);
console.log(JSON.stringify(metrics, null, 2));
