# walker — shakedown analysis (2026-06-12)

Empirical findings from ~12 real ollama runs (qwen2.5-coder 7b/14b, qwen3.5:35b)
on two canary tasks (`zen-canvas`, `choose-invert-shortcut`), and what they imply
for the four candidate causes: tools, system description, architecture, model.

## What actually happened

`choose-invert-shortcut` is the trivial canary: add `shortcut:'I'` + an `input`
binding to **one** existing command. Across six attempts the model never shipped
it. The failures, ranked by wall-clock burned:

| # | model | where it died | root cause |
|---|---|---|---|
| 1 | 7b | RED: used `toHaveAttribute` (jest-dom) | model + matcher-knowledge gap |
| 2 | 14b | RED: called `graph.node.create` (wrong id) | identifier discovery |
| 3 | 14b | RED: `keydown` as a bus event; `ctx.x()` as a snapshot path | DOM-vs-bus + path-syntax confusion |
| 4–5 | 14b | RED: wrote a test that PASSED (asserted current behavior), then tried to edit `v2/` during RED | "red must fail" + phase confusion |
| 6 | 14b | **GREEN: 20–29 min looping read→edit→read** — couldn't reproduce exact old-text for `edit` | **text surgery** |

`zen-canvas`: 7b never fixed it; the mock proves the pipeline; 14b reached GREEN
via auto-advance but lost the same way (edit exact-match).

## Root-cause taxonomy → the lever each needs

The single dominant cost was **applying the edit**, not finding what to change.
Discovery (inspect/scenario/graph) worked; the model knew the right change and
still couldn't perform reliable text surgery on a weak model's token budget.

| Failure | Lever | Fix shipped |
|---|---|---|
| edit exact-match loops (biggest) | **tools** | `patch` (line-addressed), `locate` (verbatim anchors), `set_command`/`add_command` (intent-level constructors) |
| RED test passes (wrong polarity) | tools + description | `{command,has,value}` spec-asserts + `{event}` trace-asserts; task cards state DESIRED-behavior asserts; "a green suite proves nothing" |
| wrong command/event ids | tools | probe returns closest-match suggestions; `inspect` |
| DOM input vs bus event | tools + description | probe: "`keydown` is DOM input — run the COMMAND"; prompt note |
| snapshot path syntax (`ctx.x()`) | tools | probe rejects `ctx.`/`()` paths with the valid vocabulary |
| phase confusion (edit v2 in RED) | harness | auto-advance phases on `run_test` evidence; clearer phase-denied message; give-up bounce |
| 50–200 s/turn (CPU offload) amplifies everything | tools + description | constructors collapse multi-turn edits to one call; terse decision-tree prompt |

## Verdict on the four candidate causes

1. **Better debugging/exploring tools** — *partly the issue, now closed.* The
   exploring tools (inspect/scenario/graph) were already good; the **editing**
   tools were missing. That was the real gap.
2. **Better system description** — *real but secondary.* The GREEN decision tree,
   the DOM-vs-bus distinction, and the snapshot-path vocabulary were genuine doc
   gaps. The prompt is now 827 tokens (was 1239) and leads with a decision tree.
3. **Clearer / more compressed architecture** — *not the bottleneck.* v2 is
   already legible and observable. The one architectural property that mattered
   is "**commands are data**" — the constructors exploit exactly that. The
   actionable extension (the user's instinct) is *constructors over hand-editing*,
   which is a tooling layer on top of the existing data-shaped design, not a
   refactor of it.
4. **Better models** — *the floor, not the ceiling.* 7b is below the bar
   (matcher/concept errors it can't recover from). 14b is capable but
   CPU-offload-slow, so every wasted turn is expensive — which is precisely why
   minimizing turns (constructors) matters more here than for a fast model.

**Bottom line: ~80% missing editing tools, ~15% prompt clarity, ~5% architecture;
model capability gates 7b out and 14b in.** The harness had been leaving 14b's
capability on the table by forcing exact-text editing.

## Coverage matrix (can the toolbox carry a semi-decent / 14b model?)

RED is the same shape for all: `scenario` → `gen_test` → `run_test` (auto-advance).
GREEN is where tasks differ.

| Task | GREEN path | Confidence |
|---|---|---|
| `choose-invert-shortcut` | `set_command` ×1 | **High** — proven in selftest end-to-end |
| `detail-shortcuts` | `set_command` ×2 | **High** |
| `properties-title` (CSS dashed border) | `patch` on `styles.css`; RED `{file,matches}` | **High–Med** (small CSS surface) |
| `reverse-edge` | `add_command` + ~3-line swap handler | **Med** (handler logic is the risk; `{event:graph.edge.updated}`+state asserts verify) |
| `duplicate-node` | `add_command` + handler emitting existing create flow | **Med** |
| `export-json` | `add_command` + `declare_event` (auto) + serialize/clipboard | **Med** |
| `insert-node-on-edge` | `add_command` + ~6-line fan-out handler | **Med–Low** (most logic) |
| `edge-inline-edit` | edit `model/entities.ts` abilities + SVG renderer `[data-editable-title]` | **Med–Low** (renderer is real code; no constructor) |

The user's bar — "model gets at least one fix right" — is met by construction:
`set_command` is proven in `selftest` to produce a correctly-bound, type-valid
command in a booted copy, and the shortcut tasks reduce to exactly that.

## Honest remaining gaps

- **Handler logic** for new-verb tasks is still free-form code the model writes
  (constructors place it, don't author it). `scenario` event/state asserts give a
  fast correctness loop, but a confused handler still needs model competence.
- **`edge-inline-edit`** needs a renderer change (mark the edge label editable) —
  not mechanizable; the natural next constructor would be `add_ability {entity,
  ability}`, but it only does half (the renderer half remains code).
- **Speed.** 14b at 50–200 s/turn on 12 GB means even a 6-turn success is ~10 min.
  The 10-min attempt cap (now set) plus constructors (fewer turns) is the mitigation;
  a smaller-but-faster coder model or more VRAM is the other axis.
- **Prompt budget** still warns ~1000–1150 with the task card; acceptable (total
  request stays ~2–3k, well under `num_ctx` 8192).

## If you change v2 to help the model further (optional, low priority)

The architecture is already good; these are *small* affordances, not refactors:
- A one-line `cmd(id, label, opts)` constructor in core would make every command
  literal a single greppable call — `set_command`/`add_command` already simulate
  this from the outside, so the payoff is marginal.
- Keeping command literals **one per line** (they already mostly are) is what lets
  `set_command` inject props reliably; a lint rule would protect that.
