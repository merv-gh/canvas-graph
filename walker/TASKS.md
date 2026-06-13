# walker tasks

Format: `## <id>` then `- key: value` bullets, then free-text prompt (this is what
the model sees — keep it under ~120 words). Keys: `kind` (bug | feature | walk),
`files` (≤3 hints), `title`, `command` (new feature command id), `disabled` (skip).

Suggested next local-model queue: `detail-shortcuts`, `properties-title`,
`reverse-edge`, then `duplicate-node`.

## detail-shortcuts
- kind: feature
- files: v2/systems/detail.ts
- title: detail.less / detail.more have no keyboard shortcuts
- demo: A;A;A;Z;wait;[;wait;]

Commands `detail.less` (fold selection / zoom out) and `detail.more` exist but
are palette-only — no keyboard binding, breaking the keyboard-first rule. Add
shortcuts in v2/systems/detail.ts: `[` for detail.less, `]` for detail.more —
set both `shortcut` label AND `input: { on: 'keydown', key: '[', prevent: true }`
(read the file; copy the input shape from any bound command via
inspect commands). Red scenario asserts:
{"command":"detail.less","has":"input.key","value":"["} and
{"command":"detail.more","has":"input.key","value":"]"} — both fail today;
gen_test renders them. GREEN: edit v2/systems/detail.ts only.

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

## properties-title
- kind: bug
- files: v2/styles.css
- title: Properties modal title field looks uneditable (invisible input)

Properties Title uses `input.editable-inline`, whose global border is transparent
at rest; users cannot tell it is editable. This is a CSS affordance bug only.
Do NOT create/select/open modal commands. RED: no steps; use `gen_test` with a
file assert on `v2/styles.css` requiring a `.properties input.editable-inline`
rule with visible dashed `border-bottom`. GREEN: use `add_css_rule` after
`.properties input`, selector `.properties input.editable-inline`, declaration
`border-bottom: 1px dashed var(--line-strong)`; then `run_test`.

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

## reverse-edge
- kind: feature
- files: v2/systems/graph.ts
- title: Reverse the selected edge
- command: graph.edge.reverse

There is no way to flip an edge's direction. Add command `graph.edge.reverse`
(group `edge`, shortcut `Shift+E`, available only when an edge is selected) that
swaps the selected edge's `From` and `To`, then emits `graph.edge.updated`. Use
`inspect commands edge` and `graph file v2/systems/graph.ts`; `graph.edge.delete`
is the closest sibling (`selectedEdgeId()`, `available`, `payload`). Red scenario
must use EVENTS for setup, not invented commands:
`{"event":"graph.node.create","data":{"id":"e1"}}`,
`{"event":"graph.node.create","data":{"id":"e2"}}`,
`{"event":"graph.edge.create","data":{"From":"e1","To":"e2"}}`, then
`{"event":"selection.item.select","data":{"kind":"edge","id":"r1"}}`, then run
NEW command `graph.edge.reverse`, assert `graph.edges[0].From == 'e2'`. GREEN:
use `add_edge_reverse {}`; it adds the command, handler, and EdgePatch typing.

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

## export-json
- kind: feature
- files: v2/core/io.ts, v2/systems/graph.ts
- title: Export the current graph as JSON
- command: graph.export.json

Sharing is impossible: no export at all. Add command `graph.export.json`
(group `graph`, palette-visible) that serializes the current graph —
`{ nodes: [{id, Label, Position, Size}], edges: [{id, From, To, Label}] }` —
and emits a new fact `graph.exported { json }` (declare it via CustomEvents next
to the handler), plus writes it to `navigator.clipboard` when available (guard
it — jsdom has no clipboard). Red test: create two nodes via scenario, run the
command through a test that subscribes to `graph.exported`, parse the payload,
assert it contains both node ids. Keep it one system: storage stays untouched.

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

## left-panel-shortcut
- kind: feature
- files: v2/systems/main.ts
- title: Left panel (outline) has no keyboard shortcut to collapse
- command: view.left.toggle
- demo: A;A;wait;b

The left panel can only be collapsed by clicking the ☰ hamburger — no keyboard
shortcut, breaking the keyboard-first rule (Principle 17). The fold machinery is
already there: the panel toggles via fold id `outline.panel` (LEFT_PANEL_FOLD_ID
in v2/systems/main.ts), the shell mirrors it as `ui.shell.leftFolded`, and the
hamburger is the existing mouse affordance. Add command `view.left.toggle`
(group `view`, shortcut `B`) so the keyboard can do it too. GREEN: use
add_fold_toggle {"system":"v2/systems/main.ts","id":"view.left.toggle",
"foldId":"outline.panel","key":"b","shortcut":"B"} — the fold.toggle event and
payload are wired for you; no `surface` (the hamburger covers the mouse). RED:
assert the SPEC, not a side effect — {"command":"view.left.toggle",
"has":"input.key","value":"b"} fails today, passes once bound.
