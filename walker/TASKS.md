# walker tasks

Format: `## <id>` then `- key: value` bullets, then free-text prompt (this is what
the model sees — keep it under ~120 words). Keys: `kind` (bug | feature | walk |
layout), `files` (≤3 hints), `title`, `command` (new feature command id),
`disabled` (skip). `layout` tasks are judged in a REAL browser by the oracle:
RED writes a `.layout.json` via gen_layout_test (focus/rect/style/path asserts),
not a vitest file.

Suggested next local-model queue: `duplicate-node`, then `insert-node-on-edge`.
Browser/layout tasks should wait for the layout oracle path.

## modal-focus
- kind: layout
- files: v2/systems/command-modal.ts, v2/abilities/configurable.ts
- title: Properties modal opens but keyboard focus stays on the node

Opening item properties leaves focus on the node article instead of the modal's
first field, so you must click before typing the name. Reproduce with
{"command":"editing.node.create"} then {"command":"item.properties.open"}: the
modal is open and visible, but document.activeElement is still the node and
ui.modal.focusedField is null. Use app_probe to see it, then gen_layout_test with
desired (red) asserts {"focus":".modal input"} and
{"path":"ui.modal.focusedField","op":"truthy"} — both fail today. GREEN: when the
properties modal opens, move focus to its first field (edit v2/ only).

## edge-inline-edit
- kind: feature
- files: v2/model/entities.ts, v2/abilities/editable.ts
- title: Edge labels cannot be edited inline

Node titles edit inline (Enter or double-click on `[data-editable-title]`), but
edges don't: the edge SVG renderer has no `[data-editable-title]` element and the
edge entity lacks the `editable()` ability, so selecting an edge and pressing
Enter silently does nothing. Goal: emit `item.title.edit` for a selected edge →
typing a label → `item.title.commit` updates `edge.Label.text` (storage path
already works). Add `editable()` to edgeEntity abilities AND make its renderer
mark the label `<text>` element editable. Red test: select an edge, emit
'item.title.commit' with the edge ref and new text, assert the edge label
changed AND the rendered edge exposes a `[data-editable-title]` element.

## walk
- kind: walk
- title: Explore the app via commands, report anything broken

You are exploring a live graph app. Use `app command <id>` to drive it
(editing.node.create, editing.edge.create, view.zen, choose.all, layout.apply.tidy,
palette.open …), `app snapshot ui` / `app snapshot graph` to observe state,
`app screenshot` for layout numbers, `app eval` for anything else
(window.v2 = the app context). After each command check: did ui.rendered counts,
selection, or places sizes change the way the command promises? Save every
suspected bug with `note` (symptom + the exact commands to reproduce). Call
`done` with a summary when you have walked at least 10 distinct commands.

## duplicate-node
- kind: feature
- files: v2/features.ts, v2/systems/graph.ts
- title: Duplicate the selected node
- command: editing.node.duplicate

Add command `editing.node.duplicate` (group `editing`, shortcut `D`, available
when a node is selected): creates a new node copying the selected node's Label
text and Size, positioned slightly offset (e.g. +24,+24), and the new node
becomes the selection. Reuse the existing `editing.node.create` →
`graph.node.create` flow (see nodeLifecycle in v2/features.ts) — a duplicate is
a create with a prefilled draft. Red test: create a node, rename intent not
needed — duplicate it, assert `graph.nodes` length 2 and both share the same
`Label.text`, and `selection.count` is 1.

## insert-node-on-edge
- kind: feature
- files: v2/systems/graph.ts, v2/features.ts
- title: Insert a node in the middle of the selected edge
- command: editing.edge.split

Sequence editing lacks the "split this arrow" verb. Add command
`editing.edge.split` (group `edge`, available when an edge is selected): given
selected edge A→B, create a new node N at the midpoint of A and B, delete the
original edge, create edges A→N and N→B, select N. Fan out through EXISTING
events (`graph.node.create` / `graph.edge.create` / `graph.edge.delete`) from a
feature-style listener — no storage changes. Red test: scenario builds A→B,
run the command, assert `graph.nodes` length 3 and `graph.edges` length 2.

## properties-name-editable
- kind: bug
- disabled: true
- files: v2/abilities/configurable.ts
- title: Editing a node's Title in the properties modal loses focus after one char

NOTE: disabled for the walker (jsdom) queue — focus loss is a BROWSER behavior a
jsdom scenario can't drive. The observability seam is laid: `ui.modal.focusedField`
(which field has focus) and `ui.modal.fields` (current values). This task is ready
for the Playwright layout-oracle (README roadmap), not the local loop yet.
Symptom: the node properties modal (⚙ / item.properties.open) Title field
(property id `title`, v2/model/entities.ts) commits per keystroke
(properties.item.input → item.update → redraw) and the redraw rebuilds the modal
body, blurring the input — you can't type a full title. RED (browser): focus the
Title input, dispatch two input events, assert document.activeElement stays it
(ui.modal.focusedField === 'title'). GREEN: don't rebuild the modal on item.update
for the open item, or restore focus+caret after (see outline.ts's queueMicrotask
refocus after search).

## event-log-collapse
- kind: feature
- disabled: true
- files: v2/systems/log.ts, v2/styles.css, v2/core/snapshot.ts
- title: Event log panel needs collapse shortcut and UI affordance
- command: view.log.toggle

T2 after fold tooling: make the event log collapsible with fold id `log.panel`
and command `view.log.toggle`. Add a visible affordance near the log panel,
mirror state in the debug snapshot, and hide the log body while folded. This
should follow the same constructor path as the top panel once the log panel has
a stable shell/snapshot seam.

## container-collapse-icon
- kind: bug
- disabled: true
- files: v2/systems/outline.ts, v2/systems/containers.ts
- title: Container collapse icon is dead

T3 localization task. The outline/container collapse affordance renders but
clicking it does not toggle the expected nested view. Repro should assert a
visible nested child under `ui.outline` before/after the click. Likely root is
click routing or row precedence in the outline; localize with the browser oracle
before delegating the fix.

## panel-click-focus-fit
- kind: feature
- disabled: true
- files: v2/systems/outline.ts, v2/systems/view-zoom.ts
- title: Clicking a panel item should focus and fit the item

T3 design call. `view.fit.item` already exists. Decide whether this behavior is
outline-panel-only or a universal selection side effect. Once decided, add a
small task that clicks/selects an outline row and asserts focus plus viewport fit
through the browser/layout oracle.

## graph-properties-name
- kind: feature
- disabled: true
- files: v2/systems/graph.ts, v2/model/entities.ts
- title: Graph should have editable Name properties

T3 seam task. The properties modal is data-shape driven, but graph itself has no
item-store seam for renaming. Add storage support for `kind: graph`, graph
properties, and a Name field; then the existing configurable ability/modal can
handle the UI.

## feature-generator-wizard
- kind: feature
- disabled: true
- files: walker/gen.mjs, walker/dx.mjs
- title: Feature/system generator wizard for future delegation

Tooling/meta-lever. Build a DX wizard that asks for system/feature/ability name,
events, commands, surfaces, tests, and projection slices, then writes a small
scaffold with TODOs and a red test. This is for the big model/human to build,
then smaller models fill the generated blanks.

## floating-tool-panels
- kind: feature
- disabled: true
- files: v2/systems/item-toolbar.ts, v2/types.ts
- title: Floating movable tool panels

T4 foundation. The top toolbar is now a movable/collapsible stage tool panel in
`v2/systems/tool-panel.ts`. Remaining work is the general registry/API for other
panels plus persisted positions. `item-toolbar.ts` remains a partial precedent
for entity-local handles.

## graph-persistence
- kind: feature
- disabled: true
- files: v2/systems/graph.ts, v2/core/io.ts
- title: Persist graphs to localStorage or IndexedDB

T4 Principle 9 debt. Add an IO system with `io.read`, `io.write`, and
`io.changed` events, start with localStorage, then make IndexedDB an adapter.
Only delegate after the persistence seam and serialization contract are clear.

## deep-links
- kind: feature
- disabled: true
- files: v2/systems/scenario.ts, v2/systems/view-zoom.ts
- title: Deep links for graph, camera, coordinates, and focus

T4. `?scenario=` keystroke macros exist, but state links are new. Define URL
serialization for `{ graphId, camera, selection/focus }`, parse on boot, and
update URL after stable changes without noisy history spam.

## universal-search
- kind: feature
- disabled: true
- files: v2/systems/command-modal.ts, v2/systems/jump.ts
- title: Universal search in the palette

T4. Palette currently searches commands only. Add a `searchSources` registry for
commands, items, settings, and future tools. Reuse the item enumeration patterns
from `jump.ts`, then rank with a small fuzzy scorer.

## split-app-framework
- kind: feature
- disabled: true
- files: v2/core.ts, v2/systems/index.ts, v2/model
- title: Split graph app from reusable framework

T4 architecture. Separate framework (`core/`, generic systems) from graph app
(`model/`, graph/containers/demo). Needs a package boundary and migration plan,
not a small model card.

## production-release
- kind: feature
- disabled: true
- files: package.json, README.md, .github
- title: Production and GitHub release readiness

T4 release work. Gates exist, but CI, license, contributing guide, deploy target,
and release workflow still need a coherent pass.
