# walker — overnight TDD loop for local models

A local model (ollama) fixes bugs in v2 under strict, mechanical TDD. The model
is assumed weak; the harness supplies reproduction, verification, isolation, and
context selection. Success pressure flows back into the architecture: if a 7B
model can't fix a small bug here, the code (or its observability) is too clever.

## Run

```bash
node walker/loop.mjs --task zen-canvas --mock     # prove the plumbing, no model
node walker/loop.mjs --task zen-canvas --max-turns 8   # short real smoke
node walker/loop.mjs --hours 8                    # overnight, all tasks, cycles
touch walker/STOP                                 # graceful stop between attempts
```

Config: `config.json` (ollama URL/model, budgets, ports). Override per run:
`--model qwen3.5:35b`, `--cycles 3`, `--task <id>`.

## The loop

Per task attempt, in a **disposable workspace** (rsync copy of the repo,
node_modules symlinked, its own git, its own vite on :5180, its own headless
Chromium):

1. **setup** — optional script re-introduces a known bug (`walker/setup/<name>.mjs`),
   so fixed bugs stay usable as benchmark cases forever.
2. **RED** — model may write ONLY under `tests/commands/walker/`. Its `done` is
   accepted only when `tests/commands/walker/<task>.test.ts` exists and FAILS.
   A test that passes immediately is rejected ("not red").
3. **GREEN** — model may write ONLY under `v2/`. `done` accepted when its red
   test passes.
4. **VERIFY** — harness-run, no model: full vitest suite + `tsc --noEmit`.
   Regressions are fed back (stay in GREEN); success = `fixed`.

Guards are tool-level, not prompt-level: path allowlists per phase, no shell
tool, exact-match `edit` (unique old-text required), everything else read-only.

## Model interface (hardened against real 7B behavior)

- ollama `/api/chat`. Native tool calling when the template supports it; in
  practice qwen2.5-coder emits tool JSON as plain text, so the text parser is
  the main path. It survives, in order: raw JSON; JSON with literal newlines in
  strings; backtick template-literal values; `name("arg")` call syntax;
  ```` ```json ```` fences; trailing extra tool calls (first wins).
- **Code never travels inside JSON strings.** `write`/`edit` use a two-step
  dialogue: the model sends the JSON head (`{"name":"write","arguments":{"path":…}}`),
  the harness asks for the payload, the model replies with pure fenced code
  block(s) (one for write; OLD then NEW for edit). Models that inline a properly
  escaped `content` skip the second step automatically.
- Failed `edit`s return a fuzzy hint (closest matching real line) so paraphrased
  old-text converges instead of looping.
- One tool per turn. Non-tool replies get one nudge; 3 misses = failed attempt.
  Identical repeated calls get a stop warning; 3 repeat-strikes = abort
  (`looping`) — small models doom-loop without this.
- Context: the curated pack (system prompt + task card + model's own `note`s) is
  budgeted ≤ **1000 tokens** (asserted, logged). Tool results are trimmed to
  1200 chars and history is capped at the last 8 messages, so a full request
  stays ~2–3k tokens — comfortable for `num_ctx: 8192`.
- Escalation ladder: after 2 failed attempts on a task, retries use
  `escalateModel` (default qwen3.5:35b) at higher temperature; seeds rotate per
  cycle so overnight runs explore.

## Eyes: app tools + screenshots + logs

The `app` tool drives the live workspace app through Playwright:
`app command view.zen` (run any command id), `app snapshot ui.shell` (any
dot-path of `debug.snapshot()`), `app eval <js>` (window.v2 in scope),
`app screenshot` (PNG saved to the journal; the model gets a one-line layout
summary — place sizes, rendered counts, shell state — since text models can't
see pixels). Browser console is captured per attempt. The `walk` task kind uses
the same tools for open-ended exploration; its `note`s land in
`journal/run-*/walk-*/observations.md` — feed good ones back into TASKS.md.

## Journal (everything an overnight run leaves behind)

```
walker/journal/run-<timestamp>/
  report.md            # one table row per attempt: outcome, turns, minutes
  walker.log
  <task>-c<cycle>a<n>/
    messages.jsonl     # full conversation + tool traffic
    fix.patch          # git diff of the workspace at end of attempt
    result.json        # outcome machine-readable
    shots/*.png        # screenshots (phase transitions + model-requested)
    console.log
```

Apply a winning patch to the real repo manually after review:
`git apply walker/journal/run-*/zen-canvas-*/fix.patch` (the patch includes the
red test — keep it; move it under `tests/commands/recorded/` if it's a recorded-class bug).

## Adding tasks

Edit `TASKS.md` (format documented at the top). For regression-class bugs write
a `walker/setup/<id>.mjs` that re-breaks a fixed bug in the workspace — exact
string replacement that throws loudly when the source drifts. Keep prompts
≤120 words; point at ≤3 files; name the repro commands.

## Notes

- Default model `qwen2.5-coder:7b`; 3b is too weak for GREEN, usable for walk.
  If you later expose bigger ctx or pull new coder models on the ollama box
  (ssh offer), bump `numCtx` / models in config.json — nothing else changes.
- The walker never touches the real repo: workspaces live in `walker/workspace`
  (recreated per attempt), the only durable output is `walker/journal/`.
- Known-good cycle proof: `--task zen-canvas --mock` exercises every moving part
  (setup → red gate → green gate → full verify → patch/journal) deterministically.
