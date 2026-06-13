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
