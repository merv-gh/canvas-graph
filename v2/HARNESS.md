# HARNESS.md — autonomous bug-fixing with a local model (RTX 3080 Ti class)

Goal: a 7–14B local model (12 GB VRAM) fixes "smallest bugs" (the zen-mode /
fold-mode canvas-disappears class) **verifiably and unattended**. The model is the
weakest part of the loop, so the loop must supply localization, verification, and
context selection — the model only writes small diffs.

## Why v2 is already close

The loop is reproduce → localize → patch → verify. v2 has unusually strong primitives:

| Loop stage | Existing primitive |
|---|---|
| Reproduce | `sim.record()` in-app → trace JSON; `bootV2()` + `sim.replay(trace)` replays it headlessly in jsdom in <1s |
| Observe | `debug.snapshot()` — structured user-visible state; every leaf carries the exact TS expression to assert it |
| Encode as test | `traceToTest()` / the in-app Assert modal emits a runnable `.test.ts` (see `tests/commands/recorded/`) |
| Localize | feature flags: every system/ability/feature toggles off independently — bisect by booting flag subsets |
| Verify | 543 fast tests + coverage gates + DX validator (throws on contract violations) + `tsc --noEmit` |
| Context budget | `CLAUDE.md` router + per-dir indexes: file selection is a table lookup, not embedding search |

Two recorded bugs so far (left-fold, zen) are both **layout-class** — the one thing
jsdom can't see. That gap is Phase 1.

## Phase 1 — close the observation gaps

1. **Layout oracle (Playwright, one spec).** `tests/v2-layout-oracle.spec.js`: boot the
   real app, replay a trace passed as JSON, assert physical truths:
   `places.{top,left,stage,modal}` `getBoundingClientRect()` sizes, stage non-zero,
   N rendered nodes within stage box. Data-driven: a folder of
   `cases/*.json` `{ trace, expect: { "ui.places.stage.width": ">0", ... } }`.
   This converts "canvas disappears" from human-eyes-only into a machine verdict.
   The jsdom snapshot already returns the same paths, so one case file drives both oracles.
2. **Pointer-stream helpers in the testkit.** `dragItem(ctx, ref, dx, dy)`,
   `resizeItem(...)` synthesizing pointerdown/move/up — lifts `resizeable` (33%) and
   `draggable` branch coverage, and lets traces include gestures.
3. **Snapshot diff.** `snapshotDiff(a, b): { path, before, after }[]` in `core/snapshot.ts`.
   A small model reasons over 10 changed paths, not two 200-line trees.
4. **Determinism.** `bootV2` already stubs RAF + memory IO. Also freeze `performance.now`
   and `Date` in the testkit so traces and generated ids are stable across runs.

## Phase 2 — localization the model doesn't have to be smart for

1. **Flag bisect script.** `scripts/agent/bisect.mjs --case cases/zen.json`:
   re-runs the failing assertion under flag subsets (binary search over ~30 entries,
   each boot <1s) → "fails with only {render, main, foldable} on → suspect files:
   systems/main.ts, systems/foldable.ts, core/fold.ts, styles.css". Flags double as
   a fault localizer — that's the payoff of Principle 2.
2. **Event→owner lookup.** `bus._subscribersOf/_emittersOf` already exist; dump
   `introspect()` to JSON (`scripts/agent/owners.mjs`) so "who handles fold.toggle"
   is one grep-free query.
3. **Surface dormant DX probes.** `sim.orphanEmits()` / `silentListeners()` exist but
   nothing reports them — emit as `dx` warnings after first user action; they catch
   renamed-event typos, the most common small-model patch error.

## Phase 3 — the agent protocol (small-model-shaped)

Contract per attempt — keep total context ≤ ~8k tokens:

```
INPUT : failing test source + its run output (trimmed),
        bisect verdict (suspect files, ≤3),
        the suspect files' contents,
        v2/CLAUDE.md "Hard rules" section only.
OUTPUT: one unified diff. Nothing else. No prose.
```

Verifier (deterministic, no model): apply diff → `npx vitest run <failing test>` →
if green, `npx vitest run` + `npm run typecheck` (DX runs inside boots) → verdict JSON.
On red: feed back the first error block, retry ≤4. On green: commit to a branch with
the trace + test included. The regression test ships WITH the fix by construction —
the harness wrote it before the model ever ran.

Guardrails that make small models safe here:
- diff-only output, applied with `git apply --3way`; reject diffs touching >3 files or >80 lines;
- tests + DX + typecheck are the merge gate, not model judgment;
- principles tests reject architectural drift (querySelector, core growth) automatically.

## Phase 4 — runtime on the 3080 Ti

- 12 GB VRAM: Qwen2.5-Coder-14B-Instruct Q4_K_M (~9 GB, ~25–35 tok/s) — best
  fix-rate/VRAM today; fallback Qwen2.5-Coder-7B Q5 (faster, weaker). Serve with
  `ollama` or llama.cpp's OpenAI-compatible endpoint.
- Orchestrator options: (a) a ~200-line Node script implementing Phase 3 directly;
  (b) Claude Code pointed at the local endpoint (`ANTHROPIC_BASE_URL`-style proxy
  e.g. claude-code-router / LiteLLM) — gets the CLAUDE.md routing for free but burns
  more tokens; start with (a), it's measurable.
- An attempt = repro 1s + bisect ~30s + 4 × (gen ~60s + verify ~60s) ≈ **under 10 min**
  worst case, fully local.

## Phase 5 — the benchmark falls out for free

Every `tests/commands/recorded/*.test.ts` is a (repro, fix) pair. Build the eval set by
`git revert`-ing each fix on a branch and asking the harness to re-solve it. Track
pass@1 / pass@4. Today's corpus: canvas-disappears-on-fold, canvas-disappears-on-zen.
Every future recorded bug grows the benchmark — record bugs even when you fix them
yourself by hand.

## Definition of "smallest bug" (what to route to the local model)

✔ wrong/missing CSS pin, wrong event name, missing `available()` guard, off-by-one in a
payload, missing fold/visibility filter, stale empty-state text.
✘ new systems, new abilities, anything spanning >3 files, anything without a recorded
trace — route those to a big model or a human.
