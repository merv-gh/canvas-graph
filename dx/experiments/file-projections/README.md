# Standalone file-projections experiment

This is the maintained experiment. It uses the real standalone binary from
`/Users/user/Documents/AI/entrypoint/file-projections/bin/fp`; it has no synthetic
projection reader, reference-copy tool, or hidden edit primitive.

The default strict protocol answers two separate questions without conflating them:

- can a cold DeepSeek concept-author explore through the binary and author a small,
  connected, natively materializable concept system without source-write capability?
- can a fresh DeepSeek implementation agent reach the automation result using only
  concept-routed reads and concept-owned writes, with every edit going through native
  `fp change plan` / `fp change apply` and all four coverage dimensions at 99%?

No maintainer context, source template, reference implementation, or change plan enters
the strict model context. Materialized views are on-demand so reads and tokens count.
The harness enforces concept path scope mechanically. Native architecture views are
currently view-only, so “concept editing” means concept-scoped source changes through the
canonical change service—not pretending a view-only projection can sync new files.
Concept scope is exact-file only and is intersected with the fixed automation evaluation
surface, so an authored concept cannot grant itself broad directory write authority.

The older saved recipe remains under `recipes/` as a compression/replay benchmark. It is
not evidence of cold discovery and is excluded from the strict fairness claim.
The detailed assessment and latest honest result are in `FAIRNESS-2026-07-19.md` and
`RESULTS-2026-07-19.md`. `REFERENCE-BASELINE-2026-07-19.md` separately proves the
99% gate and maintained recipe without assigning human work to the model.

## Run

```bash
make experiments

# Stable names are useful when comparing reruns.
make experiment-file-projections EXPERIMENT_RUN=strict-trial-2

# First-class strict stages.
make experiment-file-projections-strict-prepare EXPERIMENT_RUN=strict-trial-2
make experiment-file-projections-strict-concepts EXPERIMENT_RUN=strict-trial-2
make experiment-file-projections-strict-package EXPERIMENT_RUN=strict-trial-2
make experiment-file-projections-strict-implement EXPERIMENT_RUN=strict-trial-2
make experiment-file-projections-strict-score EXPERIMENT_RUN=strict-trial-2
make experiment-file-projections-strict-report EXPERIMENT_RUN=strict-trial-2

# Historical recipe replay only.
make experiment-file-projections-recipe EXPERIMENT_RUN=recipe-trial-2

# Maintainer-authored feasibility control: native replay + the same strict gate.
make experiment-file-projections-reference EXPERIMENT_RUN=reference-control-2
```

Credentials default to the standalone product's `.env` and are never copied into the
run. Override with `DEEPSEEK_ENV`, `DEEPSEEK_API_HOST`, `DEEPSEEK_API_KEY`, or
`DEEPSEEK_MODEL`. Override the binary with `FP_BIN`.
Turn/output budgets can be bounded with `CONCEPT_MAX_TURNS`, `CONCEPT_MAX_TOKENS`,
`IMPLEMENT_MAX_TURNS`, and `IMPLEMENT_MAX_TOKENS`.

Raw transcripts, CLI calls, provider-reported usage, first-edit measurements, diffs,
coverage, hidden acceptance logs, scores, and the generated report live under
`runs/<run>/`. The suite writes its report first, then exits nonzero when the strict gate
fails so CI cannot mistake a completed experiment for a passing result.
The reference target is intentionally excluded from read/token comparisons.

## Recipe improvement rule

Before implementing a new feature, create or update its concept system first. Validate
that every concept materializes, route the task through its handoffs, and allow edits
only within declared outputs/ownership. After verification, add landed symbols and
measure concept coverage. Every repeated read, invalid call, missing anchor, or repair
becomes a concrete concept/tooling change before the next run. A recipe wins only when
it lowers reads/tokens while preserving hidden acceptance and the literal 99% gate.
