import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
export const FP_BIN = process.env.FP_BIN || '/Users/user/Documents/AI/entrypoint/file-projections/bin/fp';

export const cleanRun = value => String(value || 'fp-trial').replace(/[^a-zA-Z0-9._-]/g, '-');
export const bounded = (value, limit = 16000) => {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…<trimmed ${text.length - limit} chars>`;
};

export function runDir(run, phase) {
  const path = join(HERE, 'runs', cleanRun(run), phase);
  mkdirSync(path, { recursive: true });
  return path;
}

export function manifestFor(run) {
  return JSON.parse(readFileSync(join(HERE, 'runs', cleanRun(run), 'worktrees.json'), 'utf8'));
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function eventSink(path) {
  return (type, data = {}) => appendFileSync(path, JSON.stringify({
    at: new Date().toISOString(),
    type,
    ...data,
  }) + '\n');
}

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

export function provider() {
  const values = envFile(process.env.DEEPSEEK_ENV || resolve(REPO, '../file-projections/.env'));
  const apiKey = process.env.DEEPSEEK_API_KEY || values.API_KEY;
  let apiBase = process.env.DEEPSEEK_API_HOST || values.API_HOST;
  if (!apiKey || !apiBase) throw new Error('DeepSeek API_HOST/API_KEY unavailable');
  apiBase = apiBase.replace(/\/$/, '');
  if (!apiBase.endsWith('/v1')) apiBase += '/v1';
  return { apiKey, apiBase, model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash' };
}

export async function complete(client, messages, tools, maxTokens = 4096) {
  const response = await fetch(`${client.apiBase}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${client.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: client.model,
      temperature: 0,
      max_tokens: maxTokens,
      messages,
      tools,
      tool_choice: 'required',
      thinking: { type: 'disabled' },
    }),
    signal: AbortSignal.timeout(Number(process.env.EXPERIMENT_TIMEOUT_MS || 300_000)),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${body?.error?.message || JSON.stringify(body)}`);
  return body;
}

export const emptyUsage = () => ({
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  cached_tokens: 0,
  reasoning_tokens: 0,
});

export function addUsage(total, current = {}) {
  total.prompt_tokens += current.prompt_tokens || 0;
  total.completion_tokens += current.completion_tokens || 0;
  total.total_tokens += current.total_tokens || 0;
  total.cached_tokens += current.prompt_tokens_details?.cached_tokens || current.prompt_cache_hit_tokens || 0;
  total.reasoning_tokens += current.completion_tokens_details?.reasoning_tokens || 0;
}

export function runFp(args, cwd, timeout = 60_000) {
  const result = spawnSync(FP_BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 12_000_000,
    env: { ...process.env, FP_NO_GAP_LOG: '1', NO_COLOR: '1' },
  });
  return {
    command: [FP_BIN, ...args].join(' '),
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: bounded(`${result.stdout || ''}${result.stderr || ''}`, 24000),
  };
}

export function runCheck(name, command, args, cwd, out, timeout = 180_000) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16_000_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const record = {
    name,
    command: [command, ...args].join(' '),
    exit_code: result.status,
    signal: result.signal,
    wall_ms: Date.now() - started,
    passed: result.status === 0,
    output: bounded(`${result.stdout || ''}\n${result.stderr || ''}`, 30000),
  };
  writeFileSync(join(out, `${name}.log`), record.output);
  return record;
}
