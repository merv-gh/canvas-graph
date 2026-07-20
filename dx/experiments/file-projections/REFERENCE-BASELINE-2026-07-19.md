# Independent 100% reference baseline — 2026-07-19

This is feasibility evidence, not a model or concept-discovery score. The implementation
and coverage tests were completed manually in a disposable worktree, then saved into the
maintained native recipe and replayed into a second fresh worktree.

## Proven result

- Native `fp change plan`: passed against clean `HEAD` revisions.
- Native `fp change apply`: `verified: true`, 7 files changed, rollback not needed.
- Focused automation tests: 17 passed.
- Typecheck: passed, including `backend/**/*.ts`.
- Full Vitest: 48 files passed, 1 skipped; 269 tests passed, 7 skipped.
- Hidden canvas acceptance: 5 passed.
- Hidden backend acceptance: 3 passed.
- Statements: 100% (283/283).
- Branches: 100% (81/81).
- Functions: 100% (77/77).
- Lines: 100% (230/230).
- Strict gate: PASS.

The maintained recipe is `recipes/automation-workflows.change.json`. The reproducible
control is `make experiment-file-projections-reference EXPERIMENT_RUN=<name>`. Verified
raw evidence is under ignored `runs/reference-control-final/`; native plan/apply and the
strict score both passed in that fresh disposable worktree.

## Interpretation

The literal gate is achievable and the saved recipe reproduces it. No model read/token
efficiency is assigned to this row: using those numbers would conflate a human reference
with the cold concept-scoped DeepSeek experiment. That experiment remains failed/blocked
by provider balance until rerun.
