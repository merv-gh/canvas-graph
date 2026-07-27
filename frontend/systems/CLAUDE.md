# systems/ — one file per system; open only the owner

- `render.ts` — shell mount, named places, slot flush, RAF redraw scheduler (facts → dirty scopes). Not the painter.
- `render-stage.ts` — stage painter: iterates `model.entities()` renderers, overlays, empty state, culling.
- `render-stage-gpu.ts` — WebGPU stage painter for huge graphs (10k+): instanced node cards / edges / arrows, no text (nav mode). Dormant until `render.gpu.toggle`; hot-swaps `render.stage` via `flag.toggle`, auto-resumes on boot, `app.gpuStage.probe()` reads pixels back. CPU side in `core/gpu-scene.ts` (pure, tested).
- `outline.ts` — left-pane tree. **Unregistered** (removed from `index.ts` for release); file kept for its type augmentations + possible revival.
- `main.ts` — zen mode only (`\`, fold id `shell.zen`); toolbar chrome lives in `tool-panel.ts`.
- `share.ts` — graph share/import: `?g=` (compressed, `~`-prefixed) round-trip codec, `?in=` + paste mermaid import (incl. mermaid.live `pako:` links), Markdown outline import (headings → section-headers, nested lists → nested containers opening right, `.md` file picker), `graph.share.copy` / `graph.import.mermaid` / `graph.import.markdown`.
- `input.ts` — starts the DOM→command router (`core/commands.ts` owns the logic).
- `graph.ts` — node/edge/graph commands, lifecycle handlers, storage for node/edge, hierarchy source.
- `history.ts` — bounded per-graph undo/redo over versioned full-document snapshots; coalesces gesture facts.
- `containers.ts` — container kind end-to-end: entity, nesting, drag-cascade, commands (Y/M), storage. *The* exemplar for a new kind.
- `collections.ts` — derives create/delete/select commands from collection declarations.
- `choose.ts` — set-building commands (Ctrl+A all, invert, follow edges, radius, search) + group (Ctrl+G).
- `jump.ts` — vimium-style `g` + letter overlay navigation.
- `command-picker.ts` — multi-step letter-pick driver for `CommandSpec.picker`.
- `command-form.ts` — modal form driver for `CommandSpec.form`.
- `command-modal.ts` — Palette (`⌘K` / `?`, search icon top-right): universal command + node search, arrow-key nav (Enter runs), per-result `Alt+<first unique char after the query>` accelerators. (Help modal removed for release.)
- `node-autosize.ts` — sizes text-owned nodes to content; yields to manual resize and catalog types with `autoSize:false`.
- `modal.ts` — generic modal place/open/close/Escape.
- `view-zoom.ts` — wheel/key zoom, fit-all `z`, fit-selected `Z`, animated fit-item.
- `view-pan.ts` — background drag pan.
- `layout.ts` — tidy `t` / grid `Shift+G` / radial `r`, spaced by real node sizes (no overlap); own bottom-left `layout` panel, separate from the top editing bar.
- `presets.ts` — IO-owned per-graph collections as declarative `PresetDef`s (`{label,layout?,defaultNodeType,defaultEdgeKind?,types}`): `data-preset` shell attr plus edge defaults. No process-global custom registry. Collection changes never move camera or run layout.
- `palette.ts` — universal searchable node/pattern catalog, separately rendered saved types, native scroll ownership, and the single owner of new-node defaults/arm state. No collection tabs/current-collection block.
- `node-visuals.ts` — per-node type + color AND per-edge kind on the selection: `node.type.*` / `node.color.*` / `edge.kind.*` palette commands (union of all preset vocabularies), `edge.select` letter-picker (edges aren't in the Tab cycle), picker modals (preset-modal pattern), top-bar `Type` / `Color` buttons.
- `foldable.ts` — `[data-fold-id]` click → `fold.toggle` → `core/fold.ts` store.
- `detail.ts` — polymorphic less/more detail verb (fold selection or zoom).
- `focus.ts` — focus store writes.
- `selection`-related: see `abilities/selectable.ts` (commands live with the ability).
- `cancellation.ts` — Escape/background-click → topmost active Cancellable.
- `tool-panel.ts` — stage tool-panel **registry**: systems `declarePanel({id,anchor,foldId?,movable?,layout?,mountWhen?})` and route a top button to it via `SystemAffordance.panel`. Top toolbar is fixed + centered (`top-center`, not movable/collapsible); start-slot buttons cluster into `.tool-group`s via `SystemAffordance.group` (`edit`/`layout`). *The* seam for new floating panels (zoom/log).
- `item-toolbar.ts` — floating toolbar above selected item, built from entity affordances.
- `log.ts` — event log panel.
- `demo.ts` — canonical examples for every built-in collection, plus Transformer, game-map, app self-graph, and graph-native agent-run observability.
- `ghost-node.ts` — dashed node-sized placeholder at the spot the active layout mode would put the selected node's next item; click → connected node, then the ghost re-anchors (chain building). Screen-space overlay, item-toolbar pattern.
- `ink.ts` — free-form marker/annotation kind end-to-end: `ink` entity (svg `<path>`, midpoint-quadratic smoothing), storage handler, snapshot extension. Mutually exclusive top-bar `Draw`/`Erase` switches own pointer gestures; Erase uses a visible × cursor and click-deletes ink, nodes, edges, or containers through their owning events. Selection delete, Select all drawings, and color/width properties remain keyboard-reachable. No ink collection (annotations aren't outline content).
- `onboarding.ts` — first-visit field guide, `showDemo` cookie, example launcher, Mermaid workbench.
- `debug.ts` — recorder behavior and generated-test actions; DOM builders live in `debug-views.ts`.
- `container-entity.ts` — container data shape, entity declaration, renderer, and properties; behavior/storage stay in `containers.ts`.
- `dx.ts` — boot-time contract validator (`runDx`); errors throw, warnings log.

Adding one: export `register<Name>(system: Registry)`, call `system('name', ctx => {...},
{ requires: [...] })`, wire into `index.ts`. Return a disposer for anything the contexts
don't already teardown by origin.
