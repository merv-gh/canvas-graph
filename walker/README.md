# walker — overnight TDD loop for local models

A local model (ollama) fixes bugs in v2 under strict, mechanical TDD. The model
is assumed weak; the harness supplies reproduction, verification, isolation, and
context selection. Success pressure flows back into the architecture: if a 7B
model can't fix a small bug here, the code (or its observability) is too clever.

## Run

```bash
npm run dx                              # status-first menu: run, watch, preview, gate, land
node walker/dx.mjs status               # same control plane, direct command mode
node walker/loop.mjs --task detail-shortcuts --max-turns 8   # short real smoke
node walker/loop.mjs --hours 8                    # overnight, all tasks, cycles
touch walker/STOP                                 # graceful stop between attempts
```

Config: `config.json` (ollama URL/model, budgets, ports). Override per run:
`--model qwen3.5:35b`, `--cycles 3`, `--task <id>`.

## DX menu

`npm run dx` is the normal human entrypoint. With no arguments it shows a compact
task/status table and single-key actions:

| Key | Action |
|---|---|
| `r` | run the local model for `pending`, `all`, or one selected task |
| `n` | append a new task card to `TASKS.md` |
| `w` | show or follow the latest `walker.log` |
| `p` | preview the latest fixed patch in a disposable app and print the URL |
| `g` | run the full apply gate for a fixed patch |
| `l` | gate, apply to the real repo, re-verify, and commit only the patch paths |
| `d` | move an already-applied task from `TASKS.md` to `DONE.md` |
| `o` | add the task id to `APPROVALS.md` for the older manual apply flow |
| `c` | remove old journal runs, keeping the newest N |

Direct equivalents exist for scripts/automation:

```bash
node walker/dx.mjs run detail-shortcuts --model qwen2.5-coder:7b
node walker/dx.mjs log --follow
node walker/dx.mjs preview detail-shortcuts
node walker/dx.mjs gate detail-shortcuts
node walker/dx.mjs land detail-shortcuts
node walker/dx.mjs archive detail-shortcuts
node walker/dx.mjs clean --keep 3
```

The menu deliberately wraps the existing `loop.mjs`, `preview.mjs`, and
`apply.mjs`; the model harness and quality gates remain in one place.

## The loop

Per task attempt, in a **disposable workspace** (rsync copy of the repo,
node_modules symlinked, its own git, its own vite on :5180, its own headless
Chromium):

1. **RED** — model may write ONLY under `tests/commands/walker/`. Its `done` is
   accepted only when `tests/commands/walker/<task>.test.ts` exists and FAILS.
   A test that passes immediately is rejected ("not red").
2. **GREEN** — model may write ONLY under `v2/`. `done` accepted when its red
   test passes.
3. **VERIFY** — harness-run, no model: full vitest suite + `tsc --noEmit`.
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

## App toolbox (model tools ⇄ human CLI)

Every capability is dual-exposed: a walker tool for the model and
`node walker/apptool.mjs <cmd>` for humans/Claude. Self-test: `node walker/selftest.mjs`.

| Tool / CLI | What it answers |
|---|---|
| `inspect commands [filter]` | every command + shortcut/binding/origin — *where shortcuts are missing* |
| `inspect events [filter]` | every bus event + which commands fire it, who emits/subscribes |
| `inspect flows <event>` / `flows` | one event's path: fired-by → handled-by → what handlers emit next |
| `scenario '<json>'` | boot the real app, run `{steps,asserts}`, get pass/fail + actuals + state — the verification micro-loop |
| `gen_test` / `gen-test '<json>' [out]` | validated scenario → runnable vitest file (the RED-phase shortcut) |
| `graph <find\|callers\|callees\|file\|tests> <q>` | code-review-graph index → `file:line` without grep |
| `locate <anchor> [dir]` | grep + verbatim numbered context, ready for patch/edit |
| `gen <system\|feature\|ability> <name>` (CLI) | scaffold a new plugin — template file + `index.ts`/CLAUDE.md wiring + a flag off→on smoke test. A human/Claude pre-step (writes a test + multiple files, so it's not a RED/GREEN model loop tool); the model then fills the TODOs. |

### GREEN-phase editing (model tools; intent over text surgery)

Exact-text `edit` was the #1 time sink for weak models (read→edit→read loops when
they couldn't reproduce source verbatim). The constructor tools express intent as
data and do the placement mechanically — all GREEN-phase, all proven in `selftest`
to produce code that boots *and* typechecks:

| Tool | What it does |
|---|---|
| `set_command {id, props}` | inject plain props (`shortcut`, `input`, `group`, `hidden`, `event`) into an existing command literal — the shortcut/binding tasks |
| `add_command {system, spec, handler?}` | splice a new command into a system's `register([…])`; auto-declares the command's request event and places `on(event, handler)` — new-verb tasks |
| `add_fold_toggle {system, id, foldId, key, …}` | the panel-collapse family (left/top/log/zen): wires the existing `fold.toggle` event + the `{id}` payload for you, optionally contributes a toolbar button — supply only `foldId`+`key` |
| `declare_event {system, event, type?}` | add a typed event to a system's `CustomEvents` (creating the `declare module` block if absent) |
| `patch {path, op, line, count, text}` | line-addressed replace/insert using read's numbers — no old-text matching (CSS and everything else) |

Decision tree the model is given: existing-command prop → `set_command`; new verb →
`add_command`; collapse/fold a panel or region → `add_fold_toggle`; new fact →
`declare_event`; anything else → `patch` (line numbers from `read`/`locate`).
`edit`/`write` remain as fallbacks.

scenario/gen-test JSON: `{"steps":[{"command":"editing.node.create"},{"event":"fold.toggle","data":{"id":"shell.zen"}}],`
`"asserts":[{"path":"ui.shell.zen","op":"eq","value":true},{"css":".node","op":"count","value":2},{"file":"v2/styles.css","matches":"grid-row"}]}`.
Implementation: `tests/commands/probes/walker-probe.test.ts` (skipped without `PROBE_REQUEST`;
boots the CURRENT tree — in walker runs that's the model's edited workspace).
Graph queries hit the repo's `.code-review-graph/graph.db` (may lag edits by a build).

The intended RED loop for the model: `inspect`/`graph` to discover → `scenario`
with desired-behavior asserts (failing now) → `gen_test` writes the file →
`run_test` confirms red → `done`. GREEN: edit v2/, `scenario` to iterate cheaply,
`run_test` to confirm.

## Eyes: app tools + screenshots + logs

The `app` tool drives the live workspace app through Playwright:
`app command view.zen` (run any command id), `app snapshot ui.shell` (any
dot-path of `debug.snapshot()`), `app eval <js>` (window.v2 in scope),
`app screenshot` (PNG saved to the journal; the model gets a one-line layout
summary — place sizes, rendered counts, shell state — since text models can't
see pixels). Browser console is captured per attempt. The `walk` task kind uses
the same tools for open-ended exploration; its `note`s land in
`journal/run-*/walk-*/observations.md` — feed good ones back into TASKS.md.

## Reading the live stream

stdout is a compact per-turn trace you can watch in real time (also in
`journal/run-*/walker.log`):

```
RED·t2  → run_test {}                 # phase · turn → tool call (salient args)
   ⤷ FAIL                             #   one-line result summary
RED accepted (auto-advance)           # phase transition (evidence-based)
GREEN·t1 → set_command choose.invert shortcut,input
   ⤷ updated v2/systems/choose.ts
[ollama] qwen2.5-coder:7b 25.6s prompt=2953tok out=21tok   # think time + tokens
```

`… prose, not a tool call: "…"` flags a non-tool reply (nudged); `aborting:
identical actions repeated` is the doom-loop breaker; `outcome=fixed|fail|looping|
gave-up` ends the attempt.

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
`git apply walker/journal/run-*/<task>-*/fix.patch` (the patch includes the
red test — keep it; move it under `tests/commands/recorded/` if it's a recorded-class bug).
The preferred path is `npm run dx` -> `p` preview -> `g` gate -> `l` land+commit,
which avoids copying patch paths by hand.

## Adding tasks

Edit `TASKS.md` (format documented at the top). For regression-class bugs write
a task card with the repro and the desired assertion. Keep prompts ≤120 words;
point at ≤3 files; name the repro commands. When a task lands, `npm run dx` -> `l`
archives it into `DONE.md` so the active queue stays small.

## Notes

- Default model `qwen2.5-coder:7b`; 3b is too weak for GREEN, usable for walk.
  If you later expose bigger ctx or pull new coder models on the ollama box
  (ssh offer), bump `numCtx` / models in config.json — nothing else changes.
- The walker never touches the real repo: workspaces live in `walker/workspace`
  (recreated per attempt), the only durable output is `walker/journal/`.
- Known-good proof for the tooling layer is `node walker/selftest.mjs`; real
  model runs should start with the smallest active card in `TASKS.md`.
