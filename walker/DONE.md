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
