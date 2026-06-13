# walker tasks

Format: `## <id>` then `- key: value` bullets, then free-text prompt (this is what
the model sees — keep it under ~120 words). Keys: `kind` (bug | feature | walk),
`setup` (script in walker/setup/ that re-introduces the bug into the workspace),
`files` (≤3 hints), `title`, `disabled` (skip).

## zen-canvas
- kind: bug
- setup: zen-canvas
- files: v2/styles.css, v2/systems/main.ts
- title: Zen mode makes the canvas disappear

Toggling zen mode (command `view.zen`, key `\`) hides the canvas completely —
the user sees a blank page. Zen sets `.shell[data-zen="true"] { grid-template: 0 1fr / 0 1fr }`
and hides `.top` + `.left`. The `.stage` grid item then lands in a collapsed track.
Triage notes: the shell grid rules are near line 47 of v2/styles.css; the `.stage`
layout block is near line 178. Reproduce via the app (`app command view.zen`,
`app screenshot`) or by reading those lines. Encode the symptom as a red test
(CSS rule assertion plus a `fold.toggle {id:'shell.zen'}` replay, like
tests/commands/recorded/canvas-disappears-on-fold.test.ts), then fix the CSS so
the stage survives zen and the toggle round-trips.

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

## choose-invert-shortcut
- kind: feature
- files: v2/systems/choose.ts
- title: choose.invert has no keyboard shortcut
- demo: A;A;A;Ctrl+A;wait;i

`choose.invert` (invert the chosen set) is palette-only — no keyboard binding.
Fix: add `shortcut: 'I'` and `input: { on: 'keydown', key: 'i', prevent: true }`
to the choose.invert command in v2/systems/choose.ts. The cleanest GREEN tool is
`set_command {"id":"choose.invert","props":{...}}`.
Red scenario: NO steps needed — assert the binding on the SPEC:
`{"command":"choose.invert","has":"input.key","value":"i"}` (fails until bound).
Don't assert post-`choose.invert` selection counts — `editing.node.create` on a
selected node also wires an edge, so the chosen set isn't what you'd guess;
the binding assert is the whole bug.

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
- files: v2/styles.css, v2/core/properties.ts
- title: Properties modal title field looks uneditable (invisible input)

In the properties modal (select node → ⚙), Width/Height render as visible input
boxes but Title renders as bare text — its input has class `editable-inline`
whose computed border is fully transparent at rest, so users think the title
cannot be edited there. Convention (readme): editable affordances show a dashed
underline. Fix the styling so `.properties input.editable-inline` is visibly
editable at rest (dashed bottom border like Help's shortcut inputs). Red test:
read v2/styles.css and assert a rule gives `.editable-inline` a visible dashed
border-bottom at rest (not only on :hover/:focus); see
tests/commands/recorded/canvas-disappears-on-fold.test.ts for the CSS-assert style.

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

There is no way to flip an edge's direction. Add command `graph.edge.reverse`
(group `edge`, shortcut `Shift+E`, available only when an edge is selected) that
swaps the selected edge's `From` and `To`, then emits the `graph.edge.updated`
fact. Use `inspect commands edge` and `graph file v2/systems/graph.ts` to see
the pattern (graph.edge.delete is the closest sibling — selection-aware
`available` + `payload`). Red test: create two nodes and an edge via scenario
steps (`graph.edge.create` event with `{From:'e1',To:'e2'}`), select the edge,
run the new command, assert `graph.edges[0].From` is `e2`.

## duplicate-node
- kind: feature
- files: v2/features.ts, v2/systems/graph.ts
- title: Duplicate the selected node

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

Sequence editing lacks the "split this arrow" verb. Add command
`editing.edge.split` (group `edge`, available when an edge is selected): given
selected edge A→B, create a new node N at the midpoint of A and B, delete the
original edge, create edges A→N and N→B, select N. Fan out through EXISTING
events (`graph.node.create` / `graph.edge.create` / `graph.edge.delete`) from a
feature-style listener — no storage changes. Red test: scenario builds A→B,
run the command, assert `graph.nodes` length 3 and `graph.edges` length 2.
