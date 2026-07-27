# ecs-canvas-graph

A touch- and keyboard-friendly graph editor for **writing graphs** — explaining programming
concepts, sequences, workflows, and nested maps of memory with fast navigation.
Event-driven, plugin-structured TypeScript; the architecture is judged by how
cheaply it can be regrouped and how easily a bug can be found, reproduced, and
fixed — by a human *or* a local model.

The app is `frontend/`, served at root. Version 0.1 is distributed only as a
static web build; the experimental embeddable library is outside the first
release and this repository is intentionally not configured for npm publication.

**Live app:** [merv-gh.github.io/canvas-graph](https://merv-gh.github.io/canvas-graph/)

Version 0.1 supports current Chromium on desktop and touch-sized viewports. Graphs
are stored in the browser; use JSON export for portable backups. Issues can be
reported through the [GitHub issue tracker](https://github.com/merv-gh/canvas-graph/issues).

## Quickstart

```bash
npm install
npm run dev                 # app at http://127.0.0.1:5174
npm run dx                  # dx task/status menu for local-model fixes
npx vitest run             # fast jsdom suite (tests/commands/, <60s)
npx vitest run -t "<name>" # one test by name — prefer while iterating
npm run typecheck          # tsc --noEmit
npm run test:browser       # Playwright (slow; layout/screenshots only)
npm run release:check      # app build + DX + types + coverage + browser tests
make experiments           # standalone file-projections experiment suite only
```

Verify changes with `npx vitest run` + `npm run typecheck`. Before a release, run
`npm run release:check`. A DX
contract validator runs inside every boot — a violation throws in tests, so you
don't have to eyeball it.

Canonical hosted-demo routes are `?demo=c4`, `?demo=math`, and
`?demo=workflow`. First-time visitors see the in-app guide once; the
`showDemo=false` cookie suppresses it on later visits, while the Guide command
always reopens it.

Canvas Graph is available under the [Apache License 2.0](LICENSE).

## Repo map

| Path | What |
|---|---|
| `frontend/` | the app: `core.ts` (bus + registry + contexts), `systems/`, `abilities/`, `features.ts`, `model/`, `types.ts` |
| `frontend/PRINCIPLES.md` | the 22 enforced architecture principles — the design bible |
| `frontend/CLAUDE.md`, `frontend/*/CLAUDE.md` | agent routing: which files a task touches, the hard rules |
| `tests/commands/` | the fast jsdom suite (command-driven) + `recorded/` UI-regression repros + `probes/` |
| `dx/cli/` | human entrypoints: status menu, preview, apply, app-aware inspection |
| `dx/ollama-runner/` | disposable workspaces, Ollama loop, browser/probe tools |
| `dx/projections/` | editable/read-only architecture views and their generator |
| `dx/experiments/file-projections/` | maintained cold concept-scoped editing + 99% benchmark |
| `dx/tasks/` | active queue, approvals, and archived done cards |

**Mental model (one sentence):** frontend is a typed event app where entities choose
abilities, abilities bring UI/commands/behavior, systems provide shared
infrastructure, and features choreograph cross-system flows. Imperative event
names are requests (`graph.node.create`); past-tense names are facts emitted by
the data owner after the change lands (`graph.node.created`); facts drive redraw.
Read `frontend/PRINCIPLES.md` before changing frontend.

## Recipe-first feature edits

Every feature starts by improving how the repository explains and applies that class
of edit. Use the standalone product at
`/Users/user/Documents/AI/entrypoint/file-projections/bin/fp` (override `FP_BIN`
for another checkout):

1. Run `fp context "<feature task>" --json`. If it abstains, plan a durable concept
   with `fp explore artifact-plan -kind concept -name <name> -file <seed> -line <line>`.
2. Review the concept question, ownership, handoffs, and source anchors before writing
   production code. Its coverage must include the user-facing adapter, headless/domain
   backend, composition seam, and focused tests whenever those layers participate.
3. Save a native `ConceptChange` recipe, then use `fp change plan -change <recipe.json>
   -out <plan.json>` and `fp change apply -plan <plan.json> -out <result.json>` in a
   disposable worktree. Never replace this with a custom copy/edit shortcut.
4. Verify focused tests, typecheck, and the full suite. Add the landed symbols to the
   concept and rebuild its projection.
5. Treat every extra discovery read, invalid tool call, or repair as recipe feedback:
   improve the concept or recipe, rerun the benchmark, and keep the lower-read version.

This is the self-improvement loop: **concept → native validation → concept-scoped edit →
99% verification → measured friction → better concept**. `make experiments` runs the
cold strict protocol; the older authored recipe replay is explicitly separate. Individual
strict stages and the historical replay target are documented in
[`dx/experiments/file-projections/README.md`](dx/experiments/file-projections/README.md).

---

## Automated develop / debug / fix

The loop every change goes through is **reproduce → localize → hint the edit →
verify**. frontend is built so each stage is a tool call, not a manual hunt. Two
front-ends share one engine — a CLI for humans/Claude, and model-tools for a
local LLM (`dx/`):

```bash
node dx/cli/apptool.mjs commands [filter]   # every command + shortcut + origin
node dx/cli/apptool.mjs events  [filter]    # every bus event: who fires / emits / handles
node dx/cli/apptool.mjs flows   <event>     # one event's path + 1-hop downstream
node dx/cli/apptool.mjs scenario '<json>'   # boot the real app, run steps, check asserts
node dx/cli/apptool.mjs gen-test '<json>'   # a validated scenario → a runnable vitest file
node dx/cli/apptool.mjs graph <find|callers|callees|file|tests> <q>   # code index → file:line
node dx/cli/apptool.mjs locate <anchor>     # grep + verbatim numbered context for the edit
node dx/cli/apptool.mjs gen <kind> <name>   # scaffold a new system/feature/ability (file + wiring + smoke test)
```

A `scenario` is the verification micro-loop — boot, drive, assert, in ~one second:

```json
{ "steps":  [ {"command":"editing.node.create"}, {"event":"fold.toggle","data":{"id":"shell.zen"}} ],
  "asserts": [ {"path":"ui.shell.zen","op":"eq","value":true},
               {"css":".node","op":"count","value":2},
               {"file":"frontend/styles.css","matches":"grid-row:\\s*2"},
               {"command":"choose.invert","has":"input.key","value":"i"},
               {"event":"graph.node.created"} ] }
```

The asserts span the whole observable surface: snapshot state (`graph.*`,
`selection.*`, `ui.*`), live DOM (`css`), source text (`file`), command specs
(`command`/`has`), and the event trace (`event`). State an assert as *desired*
behavior and it fails today — that's your red test, and `gen-test` writes it.

### The TDD harness (`dx/`)

`dx/ollama-runner/loop.mjs` drives a local model (ollama) through strict TDD in a
disposable workspace (its own copy, git, vite, headless Chromium):

1. **RED** — model writes only under `tests/commands/dx/`; accepted only when
   its test exists and *fails*. A test that passes immediately is rejected.
2. **GREEN** — model edits only `frontend/`; accepted when the red test passes.
3. **VERIFY** — harness-run (no model): full suite + `tsc --noEmit`.

Guards are mechanical (path allowlists per phase, no shell tool). The model
expresses edits as **intent**, not text surgery — `set_command` (props on an
existing command), `add_command` (a new verb + auto-declared event + handler),
`declare_event`, `patch` (line-addressed). See `dx/README.md` for the full
tool set, run modes, journal layout, and delegation guidance.

Every fixed bug gets a permanent `tests/commands/recorded/*.test.ts`, and the
finished task card moves from `dx/tasks/TASKS.md` to `dx/tasks/DONE.md` so the local
model only sees active work. **Record bugs even when you fix them by hand.**

### Watch a fix, then approve it (human in the loop)

`npm run dx` is the normal entrypoint for the whole local-model loop: status,
new task, run, log tail, patch preview, gate, landing commit, and journal cleanup
from one shortcut-driven terminal menu. The older direct commands are still useful
when scripting or debugging one layer:

1. **Watch** — `node dx/cli/preview.mjs --task <id> --apply <journal/.../fix.patch>`
   serves the patched fix in a disposable workspace and prints a URL like
   `…/?scenario=A;A;A;Ctrl+A;wait;i`. Opening it replays the exact keystrokes with
   a progress HUD, so you see the fix work (e.g. the new `i` shortcut inverting the
   selection). Scenarios are a shareable, replayable keystroke macro — also a great
   bug-report format (`?scenario=…` reproduces it on load).
2. **Gate** — `node dx/cli/apply.mjs --task <id>` runs the full quality gate in a
   fresh workspace: vitest suite + `tsc` + **80% coverage**. "Truly ready" = all
   three green. Dry-run by default — touches nothing.
3. **Approve + land** — add the task id to `dx/tasks/APPROVALS.md`, then
   `node dx/cli/apply.mjs --task <id> --apply-for-real` re-runs the gate, applies
   the frontend change to the repo, relocates the model's test into
   `tests/commands/recorded/`, and re-verifies. Review `git diff`, then commit.

The DX menu's `l` action performs that last step in one guarded path: it refuses
dirty target files, runs the apply gate, applies/re-verifies, stages only the
patch's paths, and commits them.

Strong quality gates everywhere: the loop's per-attempt VERIFY (suite + types),
the apply gate (+ coverage), and your visual approval.

---

## Make it further — the DX & testability contract

The goal is a **hyper-observable, hyper-testable** app where each *new* bug is
cheap to find, reproduce, and hint — by tooling, not memory. That holds only if
every feature pays a small observability tax as it lands. The contract:

1. **Every state that can be wrong is in the snapshot.** `core/snapshot.ts` is
   the single observable surface; each leaf carries the TS expression to assert
   it. A new visual/structural fact (a panel mode, a selection role, a layout
   flag) gets a snapshot field in the same PR. If `scenario` can't see it, it
   can't be tested or auto-fixed. *(zen mode was a one-line fix once `ui.shell.zen`
   existed; the gap was observability, not logic.)*
2. **Every mutation is an event, replayable from the bus.** `sim.record/replay`
   round-trips a session; a recorded user trace reproduces a bug in jsdom in <1s.
   Never mutate domain state outside an event handler.
3. **Every capability is a command (data), reachable from `window.app`.** That's
   what lets `inspect` enumerate, `scenario` drive, and `set_command`/`add_command`
   edit mechanically. Keep command literals one-per-line so the constructors can
   target them.
4. **Localization is free from the plugin boundary.** Systems toggle off
   independently (Principle 2), so a flag-bisect narrows a fault to a few files
   without the model reasoning about it.
5. **Every dispatch is a span, and observing costs nothing.**
   `systems/telemetry.ts` turns each bus event into an OpenTelemetry span, with
   parent/child taken from the bus's nested-dispatch depth — so a trace shows the
   real request → fact → feature chain, not a flat log. Capture on the
   interaction path is a Map lookup plus seven typed-array stores: no allocation,
   no string formatting. Batches leave on a microtask *after* the dispatch chain
   unwinds and land in a **worker**, where grouping, causality, OTLP
   serialisation, the persistence JSON and the HTTP POST all happen off-thread.
   `await app.telemetry.otlp()` returns OTLP/JSON (`resourceSpans`) that any
   collector accepts; `telemetry.copy` puts it on the clipboard.

### Telemetry & the event-flow portal

| | |
|---|---|
| See it | `Ctrl+Shift+E`, or **⋯ → Event flow**. Movable, resizable, collapsible. |
| Read it | Columns are bus dispatch depth (roots left), links are parent→child pairs the bus actually produced, a node lights when its event fires and fades over ~1.4s. Chips filter by channel. |
| Local sink (on) | Newest 100 spans live in `IoApi` and survive a reload. This is the sink that works on GitHub Pages, where there is no backend. |
| Backend sink (off) | `telemetry.export.toggle` POSTs batches to `http://localhost:4318/v1/traces` (`app.telemetry.setConfig({ endpoint })` to change it). Off by default and per-browser — nothing leaves the page until someone asks. A dead collector is swallowed, never surfaced as an editor error. |
| No SDK | The OTLP wire format is the contract; a ~200KB browser SDK to serialise 100 spans would cost every visitor more than it buys. Swapping the real SDK in later only replaces the aggregator. |
| Cost | `tests/commands/probes/telemetry-overhead.test.ts` holds the line: 20k emits with recording on stay inside noise of recording off, and a 10k-node pan/drag session keeps its render budget with the panel open. The panel's footer says `worker` or `inline` so you can see which side of the batch boundary you are on. |

### Roadmap (closes the remaining blind spots)

- **Layout oracle (Playwright, data-driven).** jsdom can't compute grid/transform
  geometry — and *both* recorded layout bugs (fold, zen) were that class. One spec
  that replays a trace and asserts real `getBoundingClientRect` sizes turns
  "canvas disappeared" from eyes-only into a machine verdict. Highest priority.
- **Pointer-stream testkit helpers** (`dragItem`, `resizeItem`) — lifts the
  gesture-only abilities (resize/drag) out of their coverage hole and lets traces
  carry gestures.
- **Persistence hardening.** Graphs already persist through the swappable `io`
  system; add schema migration and corrupted-storage recovery before changing
  the stored format.
- **Undo as an inverse-patch listener** on the existing facts — the bus discipline
  already paid for it (Principle 21); it's observability turned into a feature.
- **DX runtime hygiene** — surface `sim.orphanEmits()` / `silentListeners()` as
  warnings, and an acknowledge-list for the known by-design binding overlaps, so
  boot returns to zero-noise (real warnings stop drowning).
- **`add_ability {entity, ability}` constructor** — the one missing mechanical
  edit (the renderer half still needs code), to lift inline-edit-class tasks.

When a bug escapes the tools, the fix is usually one of the above — add the
missing snapshot field / event / command first, *then* fix the bug, so the next
one of its kind is auto-coverable.
