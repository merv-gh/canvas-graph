# systems/ — one file per system; open only the owner

- `render.ts` — shell mount, named places, slot flush, RAF redraw scheduler (facts → dirty scopes). Not the painter.
- `render-stage.ts` — stage painter: iterates `model.entities()` renderers, overlays, empty state, culling.
- `outline.ts` — left-pane tree (sections per collection, nested by hierarchy, per-section search).
- `main.ts` — toolbar render from affordances, hamburger, zen mode (`\`, fold id `shell.zen`).
- `input.ts` — starts the DOM→command router (`core/commands.ts` owns the logic).
- `graph.ts` — node/edge/graph commands, lifecycle handlers, storage for node/edge, hierarchy source.
- `containers.ts` — container kind end-to-end: entity, nesting, drag-cascade, commands (Y/M), storage. *The* exemplar for a new kind.
- `collections.ts` — derives create/delete/select commands from collection declarations.
- `choose.ts` — set-building commands (Ctrl+A all, invert, follow edges, radius, search) + group (Ctrl+G).
- `jump.ts` — vimium-style `g` + letter overlay navigation.
- `command-picker.ts` — multi-step letter-pick driver for `CommandSpec.picker`.
- `command-form.ts` — modal form driver for `CommandSpec.form`.
- `command-modal.ts` — Palette (`p`) + Help (`?`): search, numbered rows, flag toggles, DX doctor, shortcut editor.
- `modal.ts` — generic modal place/open/close/Escape.
- `view-zoom.ts` — wheel/key zoom, fit-all `z`, fit-selected `Z`, animated fit-item.
- `view-pan.ts` — background drag pan.
- `layout.ts` — explicit-only tidy `t` / grid / radial `r`, partitioned per container scope.
- `foldable.ts` — `[data-fold-id]` click → `fold.toggle` → `core/fold.ts` store.
- `detail.ts` — polymorphic less/more detail verb (fold selection or zoom).
- `focus.ts` — focus store writes.
- `selection`-related: see `abilities/selectable.ts` (commands live with the ability).
- `cancellation.ts` — Escape/background-click → topmost active Cancellable.
- `tool-panel.ts` — stage tool-panel **registry**: systems `declarePanel({id,anchor,foldId?,movable?,layout?,mountWhen?})` and route a top button to it via `SystemAffordance.panel`. Owns top toolbar + drag/collapse for every panel. *The* seam for new floating panels (zoom/debug/log).
- `item-toolbar.ts` — floating toolbar above selected item, built from entity affordances.
- `log.ts` — event log panel.
- `demo.ts` — renders the app's own plugin graph as a demo doc.
- `debug.ts` — in-app recorder → snapshot → assert-picker → generated `.test.ts` (the agent pipeline).
- `dx.ts` — boot-time contract validator (`runDx`); errors throw, warnings log.

Adding one: export `register<Name>(system: Registry)`, call `system('name', ctx => {...},
{ requires: [...] })`, wire into `index.ts`. Return a disposer for anything the contexts
don't already teardown by origin.
