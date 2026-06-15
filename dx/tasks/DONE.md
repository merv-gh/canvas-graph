# dx done

Completed tasks live here so `TASKS.md` stays the active local-model queue.
Keep enough context to understand what landed, but do not keep setup/re-break
scripts for finished work.

## zen-canvas
- kind: bug
- files: frontend/styles.css, frontend/systems/main.ts
- title: Zen mode makes the canvas disappear
- done: 2026-06-13
- recorded: tests/commands/recorded/canvas-disappears-on-zen.test.ts

Toggling zen mode used to hide the canvas completely because the stage fell into
collapsed grid tracks. The fix pins the shell slots/stage so zen and fold modes
keep the canvas mounted and visible.

## choose-invert-shortcut
- kind: feature
- files: frontend/systems/choose.ts
- title: choose.invert has no keyboard shortcut
- done: 2026-06-13
- recorded: tests/commands/recorded/choose-invert-shortcut.test.ts

`choose.invert` now has `shortcut: 'I'` and a keydown binding for `i`. The red
test asserts the command spec directly instead of relying on fragile selection
side effects.

## detail-shortcuts
- kind: feature
- files: frontend/systems/detail.ts
- title: detail.less / detail.more have no keyboard shortcuts
- demo: A;A;A;Z;wait;[;wait;]

Commands `detail.less` (fold selection / zoom out) and `detail.more` exist but
are palette-only — no keyboard binding, breaking the keyboard-first rule. Add
shortcuts in frontend/systems/detail.ts: `[` for detail.less, `]` for detail.more —
set both `shortcut` label AND `input: { on: 'keydown', key: '[', prevent: true }`
(read the file; copy the input shape from any bound command via
inspect commands). Red scenario asserts:
{"command":"detail.less","has":"input.key","value":"["} and
{"command":"detail.more","has":"input.key","value":"]"} — both fail today;
gen_test renders them. GREEN: edit frontend/systems/detail.ts only.

## properties-title
- kind: bug
- files: frontend/styles.css
- title: Properties modal title field looks uneditable (invisible input)

Properties Title uses `input.editable-inline`, whose global border is transparent
at rest; users cannot tell it is editable. This is a CSS affordance bug only.
Do NOT create/select/open modal commands. RED: no steps; use `gen_test` with a
file assert on `frontend/styles.css` requiring a `.properties input.editable-inline`
rule with visible dashed `border-bottom`. GREEN: use `add_css_rule` after
`.properties input`, selector `.properties input.editable-inline`, declaration
`border-bottom: 1px dashed var(--line-strong)`; then `run_test`.

## reverse-edge
- kind: feature
- files: frontend/systems/graph.ts
- title: Reverse the selected edge
- command: graph.edge.reverse

There is no way to flip an edge's direction. Add command `graph.edge.reverse`
(group `edge`, shortcut `Shift+E`, available only when an edge is selected) that
swaps the selected edge's `From` and `To`, then emits `graph.edge.updated`. Use
`inspect commands edge` and `graph file frontend/systems/graph.ts`; `graph.edge.delete`
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
- files: frontend/systems/main.ts
- title: Left panel (outline) has no keyboard shortcut to collapse
- command: view.left.toggle
- demo: A;A;wait;b

The left panel can only be collapsed by clicking the ☰ hamburger — no keyboard
shortcut, breaking the keyboard-first rule (Principle 17). The fold machinery is
already there: the panel toggles via fold id `outline.panel` (LEFT_PANEL_FOLD_ID
in frontend/systems/main.ts), the shell mirrors it as `ui.shell.leftFolded`, and the
hamburger is the existing mouse affordance. Add command `view.left.toggle`
(group `view`, shortcut `B`) so the keyboard can do it too. GREEN: use
add_fold_toggle {"system":"frontend/systems/main.ts","id":"view.left.toggle",
"foldId":"outline.panel","key":"b","shortcut":"B"} — the fold.toggle event and
payload are wired for you; no `surface` (the hamburger covers the mouse). RED:
assert the SPEC, not a side effect — {"command":"view.left.toggle",
"has":"input.key","value":"b"} fails today, passes once bound.

## top-panel-collapse
- kind: feature
- files: frontend/systems/main.ts, frontend/styles.css, frontend/core/snapshot.ts
- title: Top panel needs collapse shortcut and UI affordance
- command: view.top.toggle
- done: 2026-06-14

Implemented through projections only: `commands` added `view.top.toggle` with
`T`/`fold.toggle { id:'shell.top' }`, `command-ui` added the top toolbar
affordance, and `render` added `ui.shell.topFolded`, the shell dataset mirror,
and CSS hiding for `[data-top-folded="true"]`. Verified by scenario asserting the
command spec, `ui.shell.topFolded`, and the CSS seam.

## export-json
- kind: feature
- files: frontend/systems/graph.ts
- title: Export the current graph as JSON
- command: graph.export.json
- event: graph.exported
- done: 2026-06-14
- recorded: tests/commands/dx/export-json.test.ts

`graph.export.json` serializes the current graph to JSON, emits
`graph.exported { json }`, and writes to the clipboard when the browser API is
available. The jsdom-safe path is covered by the dx regression.

## zen-escape
- kind: feature
- files: frontend/systems/main.ts, frontend/systems/tool-panel.ts
- title: Escape exits zen mode
- command: app.cancel.escape
- done: 2026-06-14
- recorded: tests/commands/frontend-tool-panel.test.ts

Zen mode now registers with the shared cancellation stack, so Escape unfolds
`shell.zen` instead of needing the user to press the zen shortcut again. The
floating top panel also observes zen as collapsed, keeping the canvas focused.

## container-delete-children
- kind: bug
- files: frontend/systems/containers.ts
- title: Deleting a container deletes its children
- done: 2026-06-14
- recorded: tests/commands/frontend-container-commands.test.ts

Container deletion now cascades through direct and nested children by emitting
the child entity's delete event before deleting the container itself. The old
"release children on delete" expectation was updated to the desired graph
cleanup behavior.

## top-floating-tool-panel
- kind: feature
- files: frontend/systems/tool-panel.ts, frontend/systems/main.ts, frontend/styles.css
- title: Top panel is an in-canvas movable/collapsible tool panel
- done: 2026-06-14
- recorded: tests/commands/frontend-tool-panel.test.ts

The top toolbar moved from a hardcoded shell row into a stage-rendered tool
panel with drag and collapse handles. `view.top.toggle` and zen both collapse
the panel, and the debug snapshot exposes `ui.toolPanels.top` for probes.

## dx-binding-duplicates
- kind: bug
- files: frontend/systems/dx.ts, frontend/systems/graph.ts
- title: Clear noisy binding.duplicate warnings
- done: 2026-06-14
- recorded: tests/commands/frontend-branch-commands.test.ts

DX no longer warns for input bindings that are gated by explicit runtime context
(`input.when`), such as independent pointer drag/resize/panel gestures. Real
unscoped key collisions still warn. `graph.switch.next` also moved from the
ambiguous `g/G` path to `Alt+G`.

## item-properties-hotkey
- kind: feature
- files: frontend/abilities/configurable.ts
- title: Pressing . opens item properties
- command: item.properties.open
- done: 2026-06-14
- recorded: tests/commands/frontend-node-commands.test.ts

`item.properties.open` now has the `.` keyboard binding. Qwen produced and
verified the same small patch through dx; the final change is covered in the
node command regression.

## cmd-a-select-all
- kind: feature
- files: frontend/systems/choose.ts
- title: Cmd+A selects graph items instead of browser text
- command: choose.all.cmd
- done: 2026-06-14
- recorded: tests/commands/frontend-choose.test.ts

Added hidden alias command `choose.all.cmd` that forwards to the existing
`choose.all` event with `Cmd+A`. The alias preserves Ctrl+A and avoids creating a
new behavior event.

## zoom-fit-tool-panel
- kind: feature
- delegate: ready
- files: frontend/systems/view-zoom.ts
- title: Zoom and fit buttons should live in a bottom-right tool panel

The tool-panel registry is live. GREEN is ONE call — add_panel does the whole edit
(declares the panel, widens the ctx, AND routes the buttons):
add_panel {"system":"frontend/systems/view-zoom.ts","id":"zoom","anchor":"bottom-right","movable":true,"layout":"stack","order":20,"buttons":["view.zoom.out","view.zoom.reset","view.zoom.in","view.fit.all"]}
The four buttons then render in the bottom-right panel instead of the top bar.
RED — call gen_test with this css/count scenario (do NOT
hand-write a test file): asserts =
[{"css":".tool-panel[data-panel-id=\"zoom\"] [data-command=\"view.zoom.in\"]","op":"count","value":1},
{"css":".tool-panel[data-panel-id=\"top\"] [data-command=\"view.zoom.in\"]","op":"count","value":0}].
It fails now (zoom panel absent → count 0) and passes once the buttons move.
Idiom: tests/commands/tool-panel-registry.test.ts.
