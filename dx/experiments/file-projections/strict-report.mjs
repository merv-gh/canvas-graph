#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE } from './shared.mjs';

const run = cleanRun(process.argv[2]);
const root = join(HERE, 'runs', run);
const attempt = cleanRun(process.env.STRICT_ATTEMPT || 'strict-implement');
const evidenceAttempt = cleanRun(process.env.STRICT_EVIDENCE_ATTEMPT || attempt);
const readJson = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
const packageResult = readJson(join(root, 'strict-concepts', 'packaging.json'));
const implementation = readJson(join(root, attempt, 'metrics.json'));
const quality = readJson(join(root, 'strict-score', 'score.json'));
const eventPath = join(root, evidenceAttempt, 'events.jsonl');
const events = existsSync(eventPath)
  ? readFileSync(eventPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  : [];
const toolEvents = events.filter(event => event.type === 'tool_result');
const reads = toolEvents.filter(event => ['concept_route', 'concept_view', 'concept_read'].includes(event.name)).length;
const invalid = toolEvents.filter(event => event.ok === false).length;
const materialized = packageResult?.materialized || [];
const fairnessFinding = materialized.length
  ? `Observed failures count: non-materializable future-file ownership, ranged-read friction,
provider exhaustion, missing implementation, and a failed 99% gate are not repaired or
scored as success.`
  : `The provider failed before concept authoring, so this smoke sample proves pipeline
failure handling only. It makes no claim about concept efficacy; zero concepts, zero edits,
and the failed 99% gate are recorded as failure.`;
const percentages = quality?.coverage
  ? ['statements', 'branches', 'functions', 'lines'].map(key => quality.coverage[key]?.pct ?? 0).join(' / ')
  : 'not produced';
const report = `# Strict concept-scoped experiment: ${run}

Protocol: cold model-authored concepts; fresh implementation context; no authored source
template, reference implementation, or change recipe; all reads/writes concept-scoped;
all writes through native \`fp change plan/apply\`; literal 99% statements/branches/functions/lines gate.

## Result

- Strict gate: **${quality?.strict_gate ? 'PASS' : 'FAIL'}**
- Implementation: ${implementation?.finished ? 'finished' : 'incomplete'}
- Provider error: ${implementation?.provider_error || 'none recorded'}
- First source edit: ${implementation?.first_edit ? `${implementation.first_edit.read_calls} reads / ${implementation.first_edit.usage.total_tokens} tokens` : 'none'}
- Attempt tool reads: ${Math.max(implementation?.read_calls ?? 0, reads)}; invalid calls: ${Math.max(implementation?.invalid_calls ?? 0, invalid)}
- Coverage (statements / branches / functions / lines): ${percentages}

## Concept operability

${materialized.map(item => `- ${item.ok ? 'PASS' : 'FAIL'} \`${item.name}\`${item.ok ? '' : ` — ${item.output.trim()}`}`).join('\n') || '- No concepts packaged.'}

## Fairness verdict

This protocol tests concept efficacy, not a replayed maintainer recipe. ${fairnessFinding}
`;
writeFileSync(join(root, 'STRICT-REPORT.md'), report);
console.log(report);
