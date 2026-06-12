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

Commands `detail.less` (fold selection / zoom out) and `detail.more` exist but are
palette-only — no keyboard binding, which breaks the keyboard-first rule. Add
shortcuts: `[` for detail.less, `]` for detail.more (both unbound today; check
with search for `key: '['`). Follow the pattern of other commands: set
`shortcut` label AND `input: { on: 'keydown', key: '[', prevent: true }`. Red
test: assert `ctx.contexts.commands.get('detail.less').input?.key` is `'['`
and that dispatching the keydown emits the event (see how existing tests drive
keyboard via document.dispatchEvent(new KeyboardEvent('keydown', ...))).

## choose-invert-shortcut
- kind: feature
- files: v2/systems/choose.ts
- title: choose.invert has no keyboard shortcut

`choose.invert` (invert the chosen set) is palette-only. Add the unbound key `i`:
`shortcut: 'I'`, `input: { on: 'keydown', key: 'i', prevent: true }` on the
choose.invert command in v2/systems/choose.ts, following choose.all right above
it. Red test: with two nodes where one is selected, running `choose.invert`
via the `i` keydown selects the complement (assert via
ctx.selection.selectedAll() / ctx.debug.snapshot().selection.count).

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
