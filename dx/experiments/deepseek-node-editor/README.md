# DeepSeek node-editor efficiency experiment

> Historical archive. Its recipe arm used a custom reference-copy tool and is not an
> admissible file-projections result. `make experiments` now runs only the real-binary
> suite in `../file-projections/`.

Reproducible comparison of repository-orientation/edit surfaces on one identical
automation-node task. Each arm owns a Git worktree and branch from the same commit.
The harness records real API usage, real tool calls, time/read/token counts before the
first edit, full transcripts, diffs, verification, and hidden acceptance quality.

## Arms

- `baseline`: ordinary list/read/search/edit/test tools.
- `context`: baseline plus embedded generic maintainer `context.md`.
- `code-review-graph`: baseline plus structural graph queries.
- `file-projections`: one task-specific source-backed projection plus atomic slot apply;
  ordinary reads remain available.
- `file-projections-recipe`: prefetched projection plus a closed, verified semantic
  recipe built from the independent reference. This intentionally measures reusable
  concept delivery, not free-form code generation.
- `reference`: independent Codex implementation and quality ceiling; not an API-token arm.

Exploratory `optimized`, `prefetched`, and `guided` arms are retained as failed pilots.
They show why prompt instructions and dynamically hiding tools were insufficient with
this provider: the model repeated stale/unadvertised tool names or rediscovered source
after editing.

## Reproduce

Credentials default to `../file-projections/.env` and are never copied into results.
Override with `DEEPSEEK_ENV`, `DEEPSEEK_API_HOST`, `DEEPSEEK_API_KEY`, or
`DEEPSEEK_MODEL`.

```bash
# Prepare all worktrees at an immutable base.
node dx/experiments/deepseek-node-editor/prepare.mjs trial-x 520529b

# Or prepare selected arms only.
node dx/experiments/deepseek-node-editor/prepare.mjs trial-x 520529b baseline context

# Run one API arm.
node dx/experiments/deepseek-node-editor/harness.mjs \
  baseline ../.worktrees/ecs-canvas-graph-trial-x/baseline trial-x

# Score model test, typecheck, full suite, hidden acceptance, and static contract.
node dx/experiments/deepseek-node-editor/score.mjs \
  baseline ../.worktrees/ecs-canvas-graph-trial-x/baseline trial-x
```

`metrics.json` is authoritative for efficiency. `score.json` is authoritative for
quality. `events.jsonl` proves every timing/tool/usage claim. Raw transcripts and test
logs remain beside them.

## Metric definitions

- `read_calls`: list, direct file read/search/diff, graph query, or projection read.
- `first_edit`: snapshot immediately before executing first successful write/edit tool.
- `first_edit.usage.total_tokens`: cumulative provider-reported prompt + completion
  tokens through the response that requested the first edit.
- `cached_tokens`: reported prompt-cache hits; raw totals include them.
- Quality: hidden acceptance 45, model test 10, typecheck 15, full suite 15,
  structural contract 15. Maximum 100.
- Full-suite parallel LCP-only failures receive one retry. If all other tests pass, the
  repo's documented isolated performance test must pass before the full-suite check is
  accepted.

See `REPORT-2026-07-19.md` for results and limitations.
