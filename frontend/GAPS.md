# Gaps, debt & not-yet-enforced principles

`PRINCIPLES.md` holds only rules that **pass today** and have a test. This file
holds everything else: principles we're driving toward but can't yet enforce,
known debt, observability blind spots, and harness gaps. The split keeps the
bible clean — by its own rule, "if it doesn't pass today, it's a TODO" (lives
here), "if it passes, it's a principle" (lives there).

Actionable cards for these live in `dx/tasks/TASKS.md`; the roadmap narrative is
in `README.md`.

---

## Aspirational principles (stated, not yet enforced)

### Persistence is its own swappable system (PRINCIPLES §9)
Today persistence goes through the `IoApi` adapter, but command overrides,
disabled commands, and feature flags still call that adapter directly from core
contexts. There is no `io` *system*, and **reload loses the graph** — a blocker
for a writing app. Target: an `io` system the rest of the app talks to by events
(`io.read` / `io.write` / `io.changed`), localStorage first, IndexedDB as an
adapter.
> Enforcing test (fails today): `io: false` removes all `localStorage` access and
> the app boots with in-memory defaults.

### Undo/redo as an inverse-patch listener (PRINCIPLES §21)
The bus discipline already pays for it — every mutation is a replayable fact.
Undo is the inverse-patch consumer of those facts; it just hasn't been written.
Blocked on inverse payloads (or a snapshot-diff strategy) for graph/container
mutations.

---

## Known debt

- **Renderers are not swappable (PRINCIPLES §5).** Placement, commands, and
  affordances are adapter-clean, but every leaf renderer hand-builds DOM, and the
  projection layer covers commands/events/affordances — **not** entities/renderers
  (the biggest per-task code surface). "Views-only contribution" stops at the
  renderer wall; this is why `node-media-types`, `markdown`, `edge-inline-edit`
  block on schema/renderer work.
- **Collapse lives on entity data (PRINCIPLES §10/§18).** Item `Collapsed` should
  migrate from entity data into the `fold` store (presentation state belongs
  outside the domain). Open follow-up.
- **Ratchets are at the cap.** `core.ts` is 391/400 lines and `ctx.contexts` is
  14/14. The next foundational concept must merge two contexts first (by design —
  Principle 1/19 — but it means seam work now pays a merge tax).

---

## Observability blind spots

- **Browser-truth gap (top roadmap item).** jsdom can't compute grid/transform
  geometry, so DOM-count and layout snapshot fields are unvalidated against real
  rendering. A data-driven Playwright **layout oracle** (replay a trace, assert
  real `getBoundingClientRect` / focus) is the highest-priority foundation piece;
  every `layout` / `*-oracle` card in TASKS.md blocks on it.
- **`ui.rendered.edges` overcounts 2×.** Each edge renders two
  `[data-item-kind="edge"]` lines (`.edge-hit` + `.edge-line`,
  `model/entities.ts`), and the snapshot counts both — a *wrong* field is worse
  than a missing one because it reads as authoritative. No test pins
  `ui.rendered.*` to its model-side count. **Candidate principle:** every
  `ui.rendered.*` count has a test asserting it equals the model count.

---

## Harness & delegation gaps (from live local-model runs)

- **`gen_test` scenario validation crashes on a missing element.** A RED assert
  that queries a not-yet-existing node throws `Cannot read properties of undefined
  (reading 'dataset')` instead of failing cleanly. A red test *should* fail, not
  crash — this pushes weak models off the scenario path into hand-authoring.
  Null-guard DOM/`path` assert resolution in the scenario runner
  (`dx/ollama-runner/probe-client.mjs` → `runProbe`).
- **Small models thrash on hand-authored test files.** qwen3:8b burned a full
  20-turn RED budget on syntax/import errors and never reached GREEN. Cards that
  can't be expressed as a `gen_test` scenario need an **intent constructor** (the
  README "constructor" path) so the model emits intent, not text surgery. Coder
  models (qwen2.5-coder) handle raw tests far better — escalate by kind.
- **Static context pack over budget.** `1229 tok > 1000` budget warns every turn;
  trim the static pack or raise `budgets.staticContextTokens`.
- **The queue is honor-system.** `loop.mjs` filters tasks only on `disabled`, not
  `delegate: ready` — un-disabling a not-ready card would hand it to a 7b model.
  Make the loop respect `delegate: ready`.

---

## Resolved audits (historical)

- **Containers as a single-file add.** A pre-build audit checked whether
  `systems/containers.ts` + a model declaration were *all* a contributor needed.
  Containers shipped on that basis (`systems/containers.ts` is now the exemplar
  for a new kind). Kept as the methodology: if a planned feature needs more than
  one file + declaration, the abstraction is wrong — fix it before building. See
  git history of `PRINCIPLES.md` for the full original audit.
