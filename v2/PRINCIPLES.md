# v2 Design Principles

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
> as many lines elsewhere.

Current status: `core.ts` is below this target after extracting IO, flags, DX,
selection, and other small adapters. New core APIs should keep paying their way
with equal or greater deletions.

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

## 5. Render is a swappable adapter

The render boundary takes a `Renderable` (`string | Node | () => string | Node`).
Systems emit renderables; they never reach for `document.querySelector` *outside*
the slot they own.

This is what lets us swap to React, Radix, JSX, canvas, or anything else later
*without* rewriting systems. If a system pokes the DOM globally, the swap costs
everything.

> **Test:** A grep for `document.querySelector` outside `render` / `templates` /
> `commands` should return zero results in `systems.ts` and `abilities.ts`.
> (We have known violations today; track them as debt.)

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
  from `window.v2` for devtool poking and Playwright assertions.
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

> **Test:** `tests/commands/v2-journey-budget.test.ts` enforces each row.
> When you add a new entity ability, add the corresponding journey row before
> shipping.

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

---

## Future audit — container system as a single-file add

We want to add containers (nodes that hold child nodes) soon. The single-file
test is whether `systems/container.ts` + a model declaration are *all* a
contributor has to write. We checked the current architecture against that
goal before building anything.

### Already covered

- `ItemRef.parent: Id[]` exists and is honoured by `selection`, `focus`,
  `itemTargets`, and `itemKey` deep-equality. Nested addressing works
  end-to-end today.
- Render iterates `model.entities()` through `EntityDef.render`. A new entity
  kind (`'container'`) can declare its own renderer with zero render edits.
  Z-order falls out of declaration order — put `container` before `node` in
  the model and children paint on top.
- `affordances.entity(entityDef, slot)` is kind-agnostic. A container's
  abilities (resize, collapse children, lock layout) project through the same
  affordance pipeline as nodes.
- `factScope` reads suffix conventions, so `container.created` /
  `container.children.changed` register as redraw triggers without scheduler
  edits.
- `keyboard.capture({onKey})` + `commandPicker` give a container picker
  ("Move selection into container ⟨P⟩") for free.

### Must land before containers ship (still single-file friendly)

1. **`Graph.itemsOfKind(kind)` extension point.**
   Today it switches on `'node' | 'edge'`. A container system needs to plug
   its own item store in. Replace the switch with a registry on `Graph`:
   `graph.registerItemStore(kind, () => Item[])`. Container system calls
   `graph.registerItemStore('container', () => containers)` at boot. No core
   commit needed for each new kind.

2. **`graph.node.updated` cascade.**
   Dragging a container has to move its children. The container system listens
   to `graph.node.updated`, computes the delta, and emits
   `graph.node.update` for each child. This already works today —
   `nodeLifecycle` is the proof. So: zero core change, just a feature-style
   listener in `container.ts`.

3. **`itemTargets` from a side-source.**
   Containers need to be jump targets and picker candidates. The targets API
   already accepts a `register(source, provider)` from any system —
   `container.ts` calls it the same way `graph.ts` does today.

4. **Selection precedence.**
   Clicking a child should not bubble to the container. Today
   `selection.item.select` matches `[data-item-kind][data-item-id]` via
   `closest()`, so the *innermost* tagged element wins — already correct.
   Containers just need to be rendered *behind* children (rule #1 above).

5. **Layout-awareness (acceptable gap for v1).**
   `tidy` / `radial` / `grid` walk the flat node list and ignore parenting.
   We accept the v1 container does not participate in tidy; if a parent has
   children, layout runs on the parent only and the user lays out children
   manually (or with a `tidy` invoked while a container is selected).
   Promote later by adding `layout.scope` plumbing — that's *its own*
   single-file addition then.

### Bottom line

Containers are one file plus *one* core primitive: `graph.registerItemStore`.
That core change is small (~10 lines) and pays for any future entity kind, not
just containers. Once it lands, every new kind ships as a single file.

If we end up needing more than that to ship containers, we got the abstraction
wrong somewhere. Stop, fix the abstraction, then come back.
