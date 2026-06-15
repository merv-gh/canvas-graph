# frontend Design Principles

The non-negotiables. When a choice is ambiguous, walk this list top-down — the higher
principle wins.

---

## 1. Smallest core

Core owns *only*: event bus, command registry, render-place adapter, view math,
template adapter, feature-flag registry. Everything else is an optional system.

A new contributor should be able to read `core.ts` end-to-end in 15 minutes. If a
concept needs more text to explain than to implement, it belongs in a system, not
the core.

> **Test:** `core.ts` size ≤ 400 lines. New core APIs require deleting at least
> as many lines elsewhere. **And** `ctx.contexts` ≤ 14 entries — the shared
> mental-model surface ratchets: adding a context means merging two first
> (`contexts.budget` DX rule + `principles.test.ts`).

Current status: `core.ts` is below this target after extracting IO, flags, DX,
selection, and other small adapters. The context surface shrank by merging
itemModes + itemOverlays → `decorations` and hierarchy + itemTargets + nesting →
`hierarchy`. New foundation work keeps paying its way with equal or greater
deletions / merges.

## 2. Systems are self-sufficient and independent

A system owns its data, its commands, its events, its render contributions, and
its teardown. Disabling a system must not break others.

- Systems never reach into another system's internals. They communicate by
  events and the shared registries (`commands`, `places`, `view`, `properties`).
- A system that needs another system's behavior declares it via `requires` —
  DX warns when a required dependency is off.
- Cross-system *flows* (event A in domain X causes event B in domain Y) live in
  `features.ts`, never inside a system. Otherwise toggling X off silently
  breaks the flow.

> **Test:** Disable any non-core system; the rest still boots without errors.

## 3. Everything has both a command and a UI affordance

If a user can do X, they can do X from:
- the keyboard (a shortcut bound to a command), AND
- the mouse (a button, list row, or pointer gesture surfacing that command).

This is non-negotiable for discoverability and accessibility. The DX validator
enforces it per ability action.

> **Test:** Every `actionDef.ui` is non-empty AND at least one affordance has a
> `kind: 'button'` or `kind: 'handler'`.

## 4. Data shapes the UI

The shape of the data declares the shape of the UI. Don't write bespoke views
for one-off entities.

- `collection` → list + search + create + delete + order, automatically.
- `entity.properties` → properties modal with grouped, typed inputs.
- `entity.abilities` → palette commands + entity affordances + behavior.

Reusable and unified beats fancy customization. The cost of building a custom
view is paid by every future contributor reading the code.

> **Test:** Adding a new entity kind requires no new render code — just the
> entity declaration.

## 5. Render *placement* is a swappable adapter (renderers are DOM today)

The render boundary takes a `Renderable` — currently `Node | () => Node`. Systems
emit renderables into named places/slots and never reach for
`document.querySelector` *outside* the slot they own. So the *placement* layer —
where things mount, plus the command/affordance/toolbar wiring — is swappable.

Be honest about the limit: today every renderer hand-builds DOM nodes, so a
React/JSX swap still rewrites the leaf renderers. What stays free is placement,
commands, and affordances. To make renderers themselves swappable, widen
`Renderable` to accept a framework node and add an adapter — until then, do not
claim "swap to React for free."

> **Test:** A grep for `document.querySelector` outside render-adjacent files
> returns zero in `systems/` and `abilities/` (enforced in
> `principles.test.ts`). New renderers return `Renderable`.

## 6. DX validator is progressively aggressive

Every contract gets a runtime check before it gets enforced socially. New rules
start as `warn`, then graduate to `error` once the codebase passes.

Rules to keep adding:
- contract rules (action has palette command, etc.)
- consistency rules (no duplicate input bindings, no shared paletteCommand)
- structural rules (every used template exists)
- dependency rules (`requires` satisfied, no declared-but-disabled abilities)
- runtime hygiene rules (commands have origin, no orphan events after the
  user has actually used the relevant feature)

The validator should be **noisy enough to catch refactors that break invariants**,
**quiet enough to be left on in dev forever**.

> **Test:** Baseline app passes with zero errors and only acknowledged warnings.

## 7. Testability is first-class

Three rules:
- Every public surface (commands, events, flags, render places) is reachable
  from `window.app` for devtool poking and Playwright assertions.
- Commands take a `CommandSource` so a test can dispatch them without
  synthesizing DOM events.
- The bus exposes `_subscribed` / `_emitted` sets for DX *and* tests to
  inspect.

If a behavior is hard to test, the behavior is in the wrong place.

> **Test:** A new feature ships with a smoke test that flips its flag off-then-on
> and asserts its affordance appears/disappears.

## 8. Render-on-demand, never on-tick

The render system installs `bus.onAny` and coalesces all data mutations into one
`requestAnimationFrame` per scope. Systems never emit redraw events directly.

Past-tense / fact events (`.created`, `.updated`, `.deleted`, `.selected`,
`.focused`, `.switched`) are the canonical mutation signals. The scheduler reads
them; nothing else has to.

> **Test:** 100 rapid `editing.node.create` calls produce ≤ 2 `render.view.set`
> calls per scope.

## 9. Persistence lives in its own system

The same way render is swappable, persistence is swappable. `localStorage`,
`IndexedDB`, an HTTP server, an `:memory:` for tests — pick one at boot via flag.

Currently persistence goes through an `IoApi` adapter, but command overrides,
disabled commands, and feature flags still call that adapter directly from core
contexts. That's debt. Eventually this becomes an `io` system the rest of the
app talks to by events: `io.read`, `io.write`, `io.changed`.

> **Test:** Setting `io: false` removes all `localStorage` access; the app boots
> with in-memory defaults.

## 10. Selection / focus / view state lives outside the domain

`Graph` owns nodes + edges. It does NOT own "which one is selected", "which one
is focused", "what's the camera position". Those are presentation concerns,
keyed by graph id in a separate store.

This is what lets you display the same graph twice with two different cursors,
write tests that mutate a graph without a UI, and switch graphs without losing
the camera.

> **Test:** `Graph` has no `selected`, `focused`, or `camera` field.

## 11. Actions can have many modalities, abilities can be split

A "Move node" intent has at least two modalities: pointer drag and arrow-key
nudge. Each modality is its own ability so a user (or a flag) can toggle them
independently.

If an action's UI affordances span pointer + keyboard + voice + remote, that's
three or four abilities sharing a domain, not one ability with branching logic.

> **Test:** Disabling `ability.nudgeable` keeps `ability.draggable` working,
> and vice versa.

## 12. Empty states are not optional

Every list, every place, every modal renders something meaningful when the
underlying data is empty:
- "No graphs yet. Press <kbd>N</kbd> or click +."
- "No nodes in this graph yet. Press <kbd>A</kbd>."
- "Nothing in history. Make a change first."

A blank screen with hidden affordances is a bug, not minimalism.

> **Test:** A booted app with empty data shows at least one explicit call to
> action per place.

## 13. Toolbar/HUD/affordances come from data, not templates

The shell template owns *places*, not *contents*. Buttons in the toolbar are
contributed by systems via affordances (`surface: 'top'`, `kind: 'button'`).
Disabling a system removes its toolbar button automatically.

Hardcoded `<button data-command="x">` in the shell template is debt: when the
command goes away the button stays.

> **Test:** Hardcoded `data-command` attributes in the shell template = 0.

## 14. Shortcuts are parsable strings

Shortcuts are written `Ctrl+Shift+P`, `Cmd+K`, `Alt+ArrowRight`, `?`. The parser
splits on `+`, maps modifier aliases (`Cmd`/`Meta`/`Command`), and falls back
to letter-case on the final segment.

Special-casing per-key (`?` means Shift+/, `+` means Shift+=) was deleted. The
matcher trusts `event.key` to encode the produced character.

> **Test:** `setShortcut(id, 'Ctrl+Shift+P')` parses correctly AND blocks plain
> `p`.

## 15. Past-tense convention is the bus contract

- `*.create`, `*.update`, `*.delete` — imperative; request. Has a command.
- `*.created`, `*.updated`, `*.deleted` — past tense; fact. Emitted by the system
  that owns the data, after the change lands.

Other systems subscribe to facts, never to requests. The scheduler classifies
fact events as redraw triggers. The DX rule skips fact events when checking for
"handler with no emitter" (because they fire on user action).

> **Test:** A new event's name signals its kind. PRs that break the convention
> get bounced.

## 16. Per-system origin tagging is mandatory

Every command, every listener, every renderable contribution is tagged with the
system that created it. That's what lets a flag-flip do a clean teardown — and
what lets DX say "this command has no origin, who owns it?".

> **Test:** `command.no-origin` warning count = 0.

## 17. Keyboard budget — every common journey ≤ 3 keystrokes

The app is built for users who don't reach for the mouse. That's not a vibe;
it's a budget. Every canonical journey has a fixed, tested keystroke cost.
PRs that raise a cost have to either earn the new key with a UX win or trim
a different path to compensate.

| Journey                                                  | Keys                  | Cost |
|----------------------------------------------------------|-----------------------|-----:|
| Create a floating node                                   | `A`                   |    1 |
| Create a child of the selected node (selection moves)    | `A`                   |    1 |
| Create a child of the selected node (selection stays)    | `Shift+A`             |    1 |
| Build a chain of N nodes from one anchor                 | `A` × N               |    N |
| Build N siblings from one anchor                         | `Shift+A` × N         |    N |
| Edge from selected to picked target                      | `E` + letter          |    2 |
| Edge with both endpoints picked                          | `E` + letter + letter |    3 |
| Jump to any node or edge                                 | `G` + letter          |    2 |
| Fit-all to view                                          | `Z`                   |    1 |
| Fit selected                                             | `Shift+Z`             |    1 |
| Delete selected                                          | `X`                   |    1 |
| Open palette / Help                                      | `P` / `?`             |    1 |
| Toggle collapse on selected                              | `C`                   |    1 |
| Edit title of selected                                   | `Enter`               |    1 |
| Cycle selection forward / back                           | `Tab` / `Shift+Tab`   |    1 |

Three rules guarantee the budget holds:

1. **Selection is implicit context.** A command that needs a "current item"
   gets it from `selection.selected()` first, the click target second, and a
   form/picker only as a last resort. Anything reachable from selection
   collapses by one keystroke.
2. **Picker > form.** When a command needs a graph item (source/target,
   parent, jump target), declare `picker` on the CommandSpec, not `form`.
   Pickers consume letters; forms consume sentences.
3. **`seed` is mandatory on picker steps that have an obvious default.**
   If the user has already given you the answer (e.g. selection = From for
   edge create), the step skips itself. The fast path is the default path.

> **Test:** `tests/commands/frontend-journey-budget.test.ts` enforces each row.
> When you add a new entity ability, add the corresponding journey row before
> shipping.

## 18. Hierarchy is visible in navigation, not just storage

Containment is a *navigation* truth, not only a data field. The left pane (and,
next, the palette) render the tree: a contained item nests under its parent;
loose items stay flat in their kind's section. A flat list that hides real
nesting is Principle 12's blank-screen bug, one level up.

Hierarchy is two questions over one structure:
- **ordered importance** — what nests under what, sibling order → *what to show
  when, what matters less right now*.
- **shortest paths** — parent chain up, children down → *log-N* jump, search,
  and contextual commands.

Both come from the single `hierarchy` context (`tree`, `roots`, `childrenOf`,
`parentChain`, `targets`). Storage (the `nesting` engine) is the same concept's
mutable side.

**Fold is the one less-detail ⟷ more-detail operation** over that hierarchy.
Panel fold (outline sections, via the `fold` store) and item collapse (containers
/ nodes, via `Collapsed`) are two facets of it and share one chevron (`▾`/`▸`) —
don't invent a second collapse idiom. (Collapse is presentation state; migrating
it from entity data into the `fold` store is the open follow-up, per Principle 10.)

> **Test:** Move a node into a container → it renders inside that container's
> `.outline-children` and is not a loose top-level row
> (`outline-tree.test.ts`, `principles.test.ts`).

## 19. Concepts merge and split safely

The architecture is judged by how cheaply you can *regroup* it. Each context is
assembled from small, separately-typed **facets** (`decorations.modes` /
`.overlays`; `hierarchy.sources` / `.parents`). Merging two concepts = put two
facets behind one object; splitting one back = lift a facet into its own context.
Origin-scoped teardown is uniform, so a regroup never changes runtime behavior.
The pressure to merge is the contexts budget (Principle 1); the freedom to split
is that facets are independently typed.

> **Test:** `ctx.contexts` ≤ 14 (`contexts.budget`). Disabling any system tears
> down cleanly regardless of how its contexts are grouped (Principle 2 tests).

## 20. Types read high → low

`types.ts` opens with a **MODEL MAP** naming the nouns (Renderable → ItemRef →
AppEvents → CommandSpec → AbilityDef → EntityDef → CollectionDef/ModelDef). The
full definitions appear below in that same order. A reader grasps the model from
the map and descends only into the layer they need. The map can't rot because
it's checked against the real definitions and their order.

> **Test:** the MAP precedes the first definition AND its nouns are defined in
> the documented order (`principles.test.ts`).

## 21. Every domain mutation is reversible and replayable

The bus is the system of record. Every mutation is an imperative event that
carries enough to redo it (`item.update {ref, patch}`, `graph.*`, `container.*`);
every fact is emitted after the change lands; `sim.record` / `replay` round-trips
a whole session. That single discipline is what makes undo/redo a small
inverse-patch consumer *and* what powers the record → assert → generate test
pipeline. Never mutate domain state outside an event handler.

> **Test:** replaying a recorded trace into a fresh boot reconstructs the same
> state (`frontend-debug.test.ts`). Undo, when it lands, is the inverse-patch listener
> on these same facts.

## 22. Actions operate on the chosen set — choosing is higher than selecting

A bulk action is "do X over *these items*." Selection is a **set**; a single
selection is a set of one. Two roles, cleanly split:

- **Choosers** build the set (`all`, `none`, `toggle`, `invert`, `follow`-edges,
  `radius`, `search`) — each a `Set → Set` command emitting `selection.choose`.
- **Actions** consume it (`delete`, `move`, `group`) — each fans out over the set
  into the SAME per-item events single-select already uses (`graph.*.delete`,
  `item.update`, `container.add-child`).

That fan-out is the point: decorations, redraw, deletion-cleanup, and (next)
undo reuse one set of seams, so `X` deletes 1 or N and arrows move 1 or N with
no special-casing. "Choosing mode" needs no new state — it *is* the decorated
set. Multi that works by fanning out to single-item events is also the cheapest
proof the rest of the stack is robust.

> **Test:** `choose.all` then delete empties the graph; `group` folds the set
> into a container that nests them; nudging {container + child} moves the child
> once, not twice (`frontend-choose.test.ts`).

## 23. A new feature is a views edit plus at most one new file

Building a *seam* — a new context, a registry, a render adapter — is foundation
work and may touch several core files. That is the big-model / human job, and it
is explicitly exempt from this rule. But once the seam exists, adding a *feature*
on top of it must cost almost nothing:

- route behaviour through existing data surfaces — commands, affordances, panels,
  entity declarations — edited in `views/*.proj.*` and synced back to source;
- add **at most one** new source file (the system / ability that owns the
  feature), scaffolded by `gen <kind> <name>`.

If a feature needs edits scattered across many source files, the seam it should
have ridden does not exist yet: stop, build the seam, then this principle holds
for the next feature of its kind (e.g. the tool-panel registry turned "move a
button to a new panel" into a one-field `panel:` edit in `command-ui.proj.ts`).
Like Principle 6, this is progressively enforced — today some features still
touch 2–3 files; each projection / generator we add pulls another feature-shape
under the rule.

> **Test:** `npm run dx -- project sync <name> --dry-run` reports the change as a
> clean source diff from `views/` edits alone (the views-only dogfood guard), and
> any new file is the `gen` scaffold. A feature whose dry-run hits a routing error
> names the next projection to build — see `GAPS.md`.

---

## Anti-principles (things we explicitly do NOT believe)

- **"Make it general first."** No. Add the third concrete case, then extract.
- **"DX rules slow you down."** No. They cost a microtask at boot and catch the
  refactor that would have wasted half a day.
- **"Just use React state."** No. The bus is the API; React (if we add it) is
  one renderer of many.
- **"One big file is fine."** Once a single file grows past one concept,
  reading cost dominates. Split early.
- **"The test will catch it."** Tests catch the cases you thought of. DX rules
  catch the structure you forgot. We want both.

---

## How to add a new principle

1. State it as a sentence under 20 words.
2. Write the test (or DX rule) that enforces it.
3. If the codebase passes today, it's a principle. If it doesn't, it's a TODO.

If you can't write the test, the principle is too vague.
