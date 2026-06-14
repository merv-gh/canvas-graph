# walker done

Completed tasks live here so `TASKS.md` stays the active local-model queue.
Keep enough context to understand what landed, but do not keep setup/re-break
scripts for finished work.

## zen-canvas
- kind: bug
- files: v2/styles.css, v2/systems/main.ts
- title: Zen mode makes the canvas disappear
- done: 2026-06-13
- recorded: tests/commands/recorded/canvas-disappears-on-zen.test.ts

Toggling zen mode used to hide the canvas completely because the stage fell into
collapsed grid tracks. The fix pins the shell slots/stage so zen and fold modes
keep the canvas mounted and visible.

## choose-invert-shortcut
- kind: feature
- files: v2/systems/choose.ts
- title: choose.invert has no keyboard shortcut
- done: 2026-06-13
- recorded: tests/commands/recorded/choose-invert-shortcut.test.ts

`choose.invert` now has `shortcut: 'I'` and a keydown binding for `i`. The red
test asserts the command spec directly instead of relying on fragile selection
side effects.

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

## top-panel-collapse
- kind: feature
- files: v2/systems/main.ts, v2/styles.css, v2/core/snapshot.ts
- title: Top panel needs collapse shortcut and UI affordance
- command: view.top.toggle
- done: 2026-06-14

Implemented through projections only: `commands` added `view.top.toggle` with
`T`/`fold.toggle { id:'shell.top' }`, `command-ui` added the top toolbar
affordance, and `render` added `ui.shell.topFolded`, the shell dataset mirror,
and CSS hiding for `[data-top-folded="true"]`. Verified by scenario asserting the
command spec, `ui.shell.topFolded`, and the CSS seam.
