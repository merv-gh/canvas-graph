# systems/ — one file per system; open only the owner

- `render.ts` — shell mount, named places, slot flush, RAF redraw scheduler (facts → dirty scopes). Not the painter.
- `render-stage.ts` — stage painter: iterates `model.entities()` renderers, overlays, empty state, culling.
- `outline.ts` — left-pane tree. **Unregistered** (removed from `index.ts` for release); file kept for its type augmentations + possible revival.
- `main.ts` — zen mode only (`\`, fold id `shell.zen`); toolbar chrome lives in `tool-panel.ts`.
- `share.ts` — graph share/import: `?g=` (compressed, `~`-prefixed) round-trip codec, `?in=` + paste mermaid import (incl. mermaid.live `pako:` links), `graph.share.copy` / `graph.import.mermaid`.
- `input.ts` — starts the DOM→command router (`core/commands.ts` owns the logic).
- `graph.ts` — node/edge/graph commands, lifecycle handlers, storage for node/edge, hierarchy source.
- `containers.ts` — container kind end-to-end: entity, nesting, drag-cascade, commands (Y/M), storage. *The* exemplar for a new kind.
- `collections.ts` — derives create/delete/select commands from collection declarations.
- `choose.ts` — set-building commands (Ctrl+A all, invert, follow edges, radius, search) + group (Ctrl+G).
- `jump.ts` — vimium-style `g` + letter overlay navigation.
- `command-picker.ts` — multi-step letter-pick driver for `CommandSpec.picker`.
- `command-form.ts` — modal form driver for `CommandSpec.form`.
- `command-modal.ts` — Palette (`⌘K` / `?`, search icon top-right): universal command + node search, arrow-key nav (Enter runs), per-result `Alt+<first unique char after the query>` accelerators. (Help modal removed for release.)
- `node-autosize.ts` — sizes each node's box to its text (title + description + newlines) on create/import; yields to a manual resize.
- `modal.ts` — generic modal place/open/close/Escape.
- `view-zoom.ts` — wheel/key zoom, fit-all `z`, fit-selected `Z`, animated fit-item.
- `view-pan.ts` — background drag pan.
- `layout.ts` — tidy `t` / grid `Shift+G` / radial `r`, spaced by real node sizes (no overlap); own bottom-left `layout` panel, separate from the top editing bar.
- `foldable.ts` — `[data-fold-id]` click → `fold.toggle` → `core/fold.ts` store.
- `detail.ts` — polymorphic less/more detail verb (fold selection or zoom).
- `focus.ts` — focus store writes.
- `selection`-related: see `abilities/selectable.ts` (commands live with the ability).
- `cancellation.ts` — Escape/background-click → topmost active Cancellable.
- `tool-panel.ts` — stage tool-panel **registry**: systems `declarePanel({id,anchor,foldId?,movable?,layout?,mountWhen?})` and route a top button to it via `SystemAffordance.panel`. Top toolbar is fixed + centered (`top-center`, not movable/collapsible); start-slot buttons cluster into `.tool-group`s via `SystemAffordance.group` (`edit`/`layout`). *The* seam for new floating panels (zoom/log).
- `item-toolbar.ts` — floating toolbar above selected item, built from entity affordances.
- `log.ts` — event log panel.
- `demo.ts` — renders the app's own plugin graph as a demo doc.
- `debug.ts` — in-app recorder → snapshot → assert-picker → generated `.test.ts` (the agent pipeline).
- `dx.ts` — boot-time contract validator (`runDx`); errors throw, warnings log.

Adding one: export `register<Name>(system: Registry)`, call `system('name', ctx => {...},
{ requires: [...] })`, wire into `index.ts`. Return a disposer for anything the contexts
don't already teardown by origin.
