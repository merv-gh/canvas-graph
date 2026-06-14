# dx tasks

Format: `## <id>` then `- key: value` bullets, then free-text prompt (this is what
the model sees — keep it under ~120 words). Keys: `kind` (bug | feature | walk |
layout), `files` (≤3 hints), `title`, `command` (new feature command id),
`delegate` (ready | blocked:<reason>), `disabled` (skip). `layout` tasks are
judged in a REAL browser by the oracle: RED writes a `.layout.json` via
gen_layout_test (focus/rect/style/path asserts), not a vitest file.

Suggested next local-model queue: none until the next ready card is carved out.
Browser/layout tasks should wait for the layout oracle path.

## modal-focus
- kind: layout
- disabled: true
- delegate: blocked:layout-oracle-churn
- files: frontend/systems/command-modal.ts, frontend/abilities/configurable.ts
- title: Properties modal opens but keyboard focus stays on the node

Opening item properties leaves focus on the node article instead of the modal's
first field, so you must click before typing the name. Reproduce with
{"command":"editing.node.create"} then {"command":"item.properties.open"}: the
modal is open and visible, but document.activeElement is still the node and
ui.modal.focusedField is null. Use app_probe to see it, then gen_layout_test with
desired (red) asserts {"focus":".modal input"} and
{"path":"ui.modal.focusedField","op":"truthy"} — both fail today. GREEN: when the
properties modal opens, move focus to its first field (edit frontend/ only).

## edge-inline-edit
- kind: feature
- disabled: true
- delegate: blocked:test-constructor-needed
- files: frontend/model/entities.ts, frontend/abilities/editable.ts
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
(window.app = the app context). After each command check: did ui.rendered counts,
selection, or places sizes change the way the command promises? Save every
suspected bug with `note` (symptom + the exact commands to reproduce). Call
`done` with a summary when you have walked at least 10 distinct commands.

## duplicate-node
- kind: feature
- disabled: true
- delegate: blocked:setup-constructor-needed
- files: frontend/features.ts, frontend/systems/graph.ts
- title: Duplicate the selected node
- command: editing.node.duplicate

Add command `editing.node.duplicate` (group `editing`, shortcut `D`, available
when a node is selected): creates a new node copying the selected node's Label
text and Size, positioned slightly offset (e.g. +24,+24), and the new node
becomes the selection. Reuse the existing `editing.node.create` →
`graph.node.create` flow (see nodeLifecycle in frontend/features.ts) — a duplicate is
a create with a prefilled draft. Red test: create a node, rename intent not
needed — duplicate it, assert `graph.nodes` length 2 and both share the same
`Label.text`, and `selection.count` is 1.

## insert-node-on-edge
- kind: feature
- disabled: true
- delegate: blocked:constructor-needed
- files: frontend/systems/graph.ts, frontend/features.ts
- title: Insert a node in the middle of the selected edge
- command: editing.edge.split

Sequence editing lacks the "split this arrow" verb. Add command
`editing.edge.split` (group `edge`, available when an edge is selected): given
selected edge A→B, create a new node N at the midpoint of A and B, delete the
original edge, create edges A→N and N→B, select N. Fan out through EXISTING
events (`graph.node.create` / `graph.edge.create` / `graph.edge.delete`) from a
feature-style listener — no storage changes. Red test: scenario builds A→B,
run the command, assert `graph.nodes` length 3 and `graph.edges` length 2.

## node-title-only
- kind: bug
- disabled: true
- delegate: blocked:collapse-model-split
- files: frontend/model/entities.ts, frontend/index.html, frontend/styles.css
- title: Simple nodes should render only a centered title

Simple graph nodes show body/meta text like `e1` and expose a collapse icon even
when there is no body to collapse. Remove the node id/body-description from the
default node render and keep the title vertically centered. Existing node tests
still expect the generic `collapsible` ability, so first split "plain title-only
node" from future rich/markdown nodes or define when collapse is meaningful.

## node-inline-title-edit-stable
- kind: layout
- disabled: true
- delegate: blocked:browser-focus-oracle
- files: frontend/abilities/editable.ts, frontend/model/entities.ts
- title: Inline node title editing should keep focus and commit full titles

Node title editing from the canvas should accept multi-character edits without
losing focus or committing partial text. This needs a browser-focused repro:
enter edit mode on a node title, type two characters, assert the active element
is still `[data-editable-title]` and `graph.nodes[0].Label.text` equals the full
string after commit.

## properties-name-editable
- kind: bug
- disabled: true
- delegate: blocked:browser-focus-oracle
- files: frontend/abilities/configurable.ts
- title: Editing a node's Title in the properties modal loses focus after one char

NOTE: disabled for the dx (jsdom) queue — focus loss is a BROWSER behavior a
jsdom scenario can't drive. The observability seam is laid: `ui.modal.focusedField`
(which field has focus) and `ui.modal.fields` (current values). This task is ready
for the Playwright layout-oracle (README roadmap), not the local loop yet.
Symptom: the node properties modal (⚙ / item.properties.open) Title field
(property id `title`, frontend/model/entities.ts) commits per keystroke
(properties.item.input → item.update → redraw) and the redraw rebuilds the modal
body, blurring the input — you can't type a full title. RED (browser): focus the
Title input, dispatch two input events, assert document.activeElement stays it
(ui.modal.focusedField === 'title'). GREEN: don't rebuild the modal on item.update
for the open item, or restore focus+caret after (see outline.ts's queueMicrotask
refocus after search).

## left-panel-tool-panel
- kind: feature
- disabled: true
- delegate: blocked:tool-panel-registry
- files: frontend/systems/tool-panel.ts, frontend/systems/outline.ts, frontend/types.ts
- title: Left panel should be render-place configurable tool panel

Refactor the outline/left panel into a tool panel whose render place is
configurable: `stage` for floating canvas mode, `left` to preserve the old shell
look. This should not duplicate outline rendering. First build a small panel
registry/config seam in `tool-panel.ts`, then move outline mounting behind that
seam and assert both render places.

## debug-tool-panel
- kind: feature
- disabled: true
- delegate: blocked:tool-panel-registry
- files: frontend/systems/debug.ts, frontend/systems/tool-panel.ts
- title: Debug/event log should be a top-right tool panel when enabled

Extract debug/log UI into a separate tool panel anchored top right. It should
mount only when debug/log is enabled, stay hidden in normal mode, and reuse the
same movable/collapsible panel registry as top/left panels. RED needs a snapshot
field like `ui.toolPanels.debug.mounted`.

## zoom-fit-tool-panel
- kind: feature
- disabled: true
- delegate: blocked:tool-panel-registry
- files: frontend/systems/view-zoom.ts, frontend/systems/tool-panel.ts
- title: Zoom and fit buttons should live in a bottom-right tool panel

Move `view.zoom.*`, `view.fit.all`, and `view.fit.selected` affordances out of
the top toolbar into a bottom-right stage tool panel. Keep existing keyboard
shortcuts. Needs the panel registry plus a way for command affordances to target
named tool panels rather than only `surface:'top'`.

## layout-picker-button
- kind: feature
- disabled: true
- delegate: blocked:picker-or-popover-seam
- files: frontend/systems/layout.ts, frontend/systems/tool-panel.ts
- title: Layout buttons should collapse into one layout picker

Replace separate Tidy/Radial/Grid toolbar buttons with one Layout button. Clicking
it opens a small picker/popover with layout choices; choosing radial or tidy
applies the layout and then emits `view.fit.all`. Keep direct command ids for
palette/keyboard. Needs a deterministic popover/picker seam before delegation.

## event-log-collapse
- kind: feature
- disabled: true
- delegate: blocked:tool-panel-registry
- files: frontend/systems/log.ts, frontend/styles.css, frontend/core/snapshot.ts
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
- files: frontend/systems/outline.ts, frontend/systems/containers.ts
- title: Container collapse icon is dead

T3 localization task. The outline/container collapse affordance renders but
clicking it does not toggle the expected nested view. Repro should assert a
visible nested child under `ui.outline` before/after the click. Likely root is
click routing or row precedence in the outline; localize with the browser oracle
before delegating the fix.

## panel-click-focus-fit
- kind: feature
- disabled: true
- files: frontend/systems/outline.ts, frontend/systems/view-zoom.ts
- title: Clicking a panel item should focus and fit the item

T3 design call. `view.fit.item` already exists. Decide whether this behavior is
outline-panel-only or a universal selection side effect. Once decided, add a
small task that clicks/selects an outline row and asserts focus plus viewport fit
through the browser/layout oracle.

## graph-properties-name
- kind: feature
- disabled: true
- files: frontend/systems/graph.ts, frontend/model/entities.ts
- title: Graph should have editable Name properties

T3 seam task. The properties modal is data-shape driven, but graph itself has no
item-store seam for renaming. Add storage support for `kind: graph`, graph
properties, and a Name field; then the existing configurable ability/modal can
handle the UI.

## feature-generator-wizard
- kind: feature
- disabled: true
- files: dx/gen.mjs, dx/dx.mjs
- title: Feature/system generator wizard for future delegation

Tooling/meta-lever. Build a DX wizard that asks for system/feature/ability name,
events, commands, surfaces, tests, and projection slices, then writes a small
scaffold with TODOs and a red test. This is for the big model/human to build,
then smaller models fill the generated blanks.

## floating-tool-panels
- kind: feature
- disabled: true
- delegate: blocked:big-model-seam
- files: frontend/systems/item-toolbar.ts, frontend/types.ts
- title: Floating movable tool panels

T4 foundation. The top toolbar is now a movable/collapsible stage tool panel in
`frontend/systems/tool-panel.ts`. Remaining work is the general registry/API for other
panels plus persisted positions. `item-toolbar.ts` remains a partial precedent
for entity-local handles.

## history-undo-redo
- kind: feature
- disabled: true
- delegate: blocked:mutation-journal-seam
- files: frontend/core, frontend/systems/graph.ts, frontend/systems/containers.ts
- title: Implement history, undo, and redo

Add a command/event history seam that records reversible graph/container/item
mutations, then expose `history.undo` and `history.redo` with shortcuts. This is
not a small patch until mutation events have inverse payloads or a snapshot diff
strategy. Start with graph node/edge create/update/delete, then containers.

## graph-persistence
- kind: feature
- disabled: true
- delegate: blocked:io-seam
- files: frontend/systems/graph.ts, frontend/core/io.ts
- title: Persist graphs to localStorage or IndexedDB

T4 Principle 9 debt. Add an IO system with `io.read`, `io.write`, and
`io.changed` events, start with localStorage, then make IndexedDB an adapter.
Only delegate after the persistence seam and serialization contract are clear.

## graph-import-json
- kind: feature
- disabled: true
- delegate: blocked:serializer-contract
- files: frontend/systems/graph.ts, frontend/core/io.ts
- title: Import graph JSON matching the export format
- command: graph.import.json

`graph.export.json` exists. Add the inverse import command after the graph JSON
schema is named/tested in one helper. Import should validate nodes/edges, replace
or create a graph deterministically, emit `graph.imported`, and leave the graph
selected/fitted. Needs malformed JSON tests before delegation.

## deep-links
- kind: feature
- disabled: true
- delegate: blocked:url-state-seam
- files: frontend/systems/scenario.ts, frontend/systems/view-zoom.ts
- title: Deep links for graph, selection, zoom, and pan

T4. `?scenario=` keystroke macros exist, but state links are new. Define URL
serialization for `{ graphId, camera:{x,y,scale}, selected nodes/edges }`, parse
on boot, and update URL after stable changes without noisy history spam.

## node-media-types
- kind: feature
- disabled: true
- delegate: blocked:model-schema-design
- files: frontend/model/entities.ts, frontend/model/graph.ts
- title: Add image, video, and link node types

Introduce typed node variants for image, video, and link content. This needs a
schema decision first: one `node` entity with `Kind`/`Content`, or separate item
kinds. After the schema is chosen, delegate renderers/properties/tests in small
cards per type.

## node-markdown-descriptions
- kind: feature
- disabled: true
- delegate: blocked:description-schema-and-renderer
- files: frontend/model/entities.ts, frontend/abilities/configurable.ts
- title: Markdown descriptions for all node types

Add a markdown description field to node types and render it safely. Needs a
description property schema, collapsed/expanded display rules, and a markdown
renderer/sanitizer decision. Delegate only after the first text-node description
path has a red test and deterministic renderer seam.

## layout-collapsed-container-sizes
- kind: bug
- disabled: true
- delegate: blocked:layout-measurement-seam
- files: frontend/systems/layout.ts, frontend/systems/containers.ts, frontend/core/view.ts
- title: Layout should use actual node sizes when containers are collapsed

Layout currently reasons from model sizes, but collapsed containers and rendered
nodes can have different effective sizes. Add a measurement seam that layout can
query for current rendered bounds, then make tidy/radial respect collapsed
container extents. Needs browser/layout assertions before delegation.

## universal-search
- kind: feature
- disabled: true
- files: frontend/systems/command-modal.ts, frontend/systems/jump.ts
- title: Universal search in the palette

T4. Palette currently searches commands only. Add a `searchSources` registry for
commands, items, settings, and future tools. Reuse the item enumeration patterns
from `jump.ts`, then rank with a small fuzzy scorer.

## split-app-framework
- kind: feature
- disabled: true
- files: frontend/core.ts, frontend/systems/index.ts, frontend/model
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
