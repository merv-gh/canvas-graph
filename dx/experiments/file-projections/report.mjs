#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE } from './shared.mjs';

const run = cleanRun(process.argv[2]);
const root = join(HERE, 'runs', run);
const discoverRun = cleanRun(process.env.DISCOVERABILITY_RUN || run);
const discover = JSON.parse(readFileSync(join(HERE, 'runs', discoverRun, 'discoverability', 'metrics.json'), 'utf8'));
const automation = JSON.parse(readFileSync(join(root, 'automation', 'metrics.json'), 'utf8'));
const quality = JSON.parse(readFileSync(join(root, 'score', 'score.json'), 'utf8'));
const first = automation.first_edit;
const report = `# File-projections experiment: ${run}

Binary: \`${automation.changed_files ? 'standalone file-projections' : 'file-projections'}\`  
Model: \`${automation.model}\`

| Experiment | Result | Calls/reads | Tokens | Quality |
|---|---:|---:|---:|---:|
| Discoverability/self-operability | ${discover.score}/${discover.max_score} | ${discover.fp_calls} fp calls (${discover.invalid_calls} invalid) | ${discover.usage.total_tokens} | valid concept plan: ${discover.criteria.valid_concept_plan ? 'yes' : 'no'} |
| Recipe-driven automation | ${automation.finished ? 'finished' : 'incomplete'} | ${first?.read_calls ?? automation.read_calls} reads before edit | ${first?.usage.total_tokens ?? 'n/a'} before edit; ${automation.usage.total_tokens} total | ${quality.score}/${quality.max_score} |

Discoverability sample: \`${discoverRun}\`  
Automation sample: \`${run}\`

## First edit

- Native operation: \`${first?.argv?.join(' ') ?? 'none'}\`
- API calls: ${first?.api_calls ?? 'n/a'}
- Repository reads: ${first?.read_calls ?? 'n/a'} (all through file-projections; direct reads ${first?.direct_file_reads ?? 0})
- Provider-reported tokens: ${first?.usage.total_tokens ?? 'n/a'}
- Wall time: ${first?.wall_ms ?? 'n/a'} ms

## Quality gates

${quality.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.name} (${check.wall_ms} ms)`).join('\n')}

## Interpretation

The discoverability run measures the product before repository-specific guidance. The
automation run measures the maintained winning path after the concept explains source
root, coverage, recipe location, and native plan/apply sequence. The source edit is
performed by \`fp change apply\`; no reference-copy or custom edit tool is exposed.
`;
writeFileSync(join(root, 'REPORT.md'), report);
console.log(report);
