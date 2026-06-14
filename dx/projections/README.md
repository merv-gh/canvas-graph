# dx feature projections

Feature projections are editable local views over source-owned slices. They are
for context compression, not new ownership: the source files keep the structure,
while the projection gives a smaller model or human one focused surface.

## Built-in projections

```bash
npm run dx -- project generate commands
npm run dx -- project show commands detail.less
npm run dx -- project show flows graph.edge.create
npm run dx -- project sync commands
npm run dx -- project watch commands
npm run dx -- project generate events
npm run dx -- project generate flows
npm run dx -- project generate command-ui
npm run dx -- project generate render
```

- `commands` -> `views/commands.proj.ts`: every command spec from
  `contexts.commands.register(...)` as one compilable `CommandSpec[]` array.
- `events` -> `views/events.proj.ts`: editable event declaration lines
  from `CustomEvents` / `BuiltinEvents`.
- `flows` -> `views/flows.proj.md`: read-only event streams from origin
  command/event through handlers and downstream emits, plus an event index.
- `command-ui` -> `views/command-ui.proj.ts`: editable
  `contribute({ surface, command, ... })` affordance objects as one
  `SystemAffordance[]` array.
- `render` -> `views/render.proj.md`: editable shell fold render seams:
  dataset mirrors in `main.ts`, `ui.shell` snapshot fields, and CSS rules.

### commands: a compilable array (no markers)

The `commands` projection is one valid TypeScript file — a single
`export const commands: CommandSpec[]` array, grouped by source file with a
`// ── <file> ──` header per group:

```ts
// @ts-nocheck — @dx-projection commands frontend. Source files still own these slices.
import type { CommandSpec } from '../frontend/types';

export const commands: CommandSpec[] = [
  // ── frontend/systems/detail.ts ──
  { id: 'detail.less', label: 'Less detail (fold / zoom out)', group: 'view' },
  ...
];
```

Edit a field on any element, then `sync`. **Routing is by `id`** — command ids
are globally unique, so sync re-scans the source, finds the literal that declares
that id, and replaces only its slice. No `file:line` marker is stored or needed.
`@ts-nocheck` is set because the command bodies close over system-local helpers
(`refFromSource`, `graphs`, …) that don't resolve in isolation; the file still
reads as real, valid TS (no sea of red) and the loop's VERIFY step (`vitest` +
`tsc` on the actual source) is the real type/behaviour oracle.

To add a brand-new command, place it directly after an existing sibling in the
projection. Sync anchors on that sibling and inserts the new command into the same
source `register([…])` call. For commands that also need handlers or event
declarations, use the `add_command` constructor.

### events: compilable interface blocks (no markers)

The `events` projection is also one valid TypeScript file — the `CustomEvents` /
`BuiltinEvents` declarations gathered from every `declare module '../types'`,
re-emitted as `interface` blocks grouped by source file:

```ts
// @ts-nocheck — @dx-projection events frontend. Source declares these in `declare module '../types'`.
interface CustomEvents {
  // ── frontend/systems/foldable.ts ──
  'fold.toggle': { id: string };
  ...
}
```

Routing is **by event name** (globally unique). Edit a type, then `sync`. New
events are declared where the owning system augments `CustomEvents`, not here.

### flows: event streams (read-only)

The `flows` projection is read-only. It shows event-driven behavior as paths:
origin command/event -> listeners in source order -> downstream emitted events.
This is the first projection to inspect for bugs where the logic is hidden
between systems:

```md
## stream graph.container.delete
origin commands: graph.container.delete (frontend/systems/containers.ts:260)
- graph.container.delete
  handler frontend/systems/containers.ts:295 emits container.deleted
    - container.deleted -> no static handlers
```

It also ends with an event index that lists declarations, commands, emitters, and
handlers per event. Static analysis is intentionally conservative: explicit
`emit(...)` / `bus.emit(...)` calls are traced, known context seams like
`contexts.fold.toggle(...)` are bridged to their fact event (`fold.changed`),
and same-file helper calls from a handler are expanded when those helpers emit.
Render leaves include compact payload hints such as
`render.view.set {place: Places.Stage, key: 'tool-panel:top'}` so panel/render
bugs have a concrete file and target to inspect next.

### command-ui: a compilable array (no markers)

The `command-ui` projection is one valid TypeScript file — a single
`export const commandUi: SystemAffordance[]` array. It slices only the object
inside each `contribute({ ... })` call; sync re-wraps it with the original call,
indentation, and semicolon.

```ts
// @ts-nocheck — @dx-projection command-ui frontend.
import type { SystemAffordance } from '../frontend/types';

export const commandUi: SystemAffordance[] = [
  // ── frontend/systems/main.ts ──
  { surface: 'top', command: 'view.zen', kind: 'button', text: '⛶', order: 80 },
];
```

Routing is **by `command`**. Edit affordance data, then `sync`. Add a new
affordance directly after an existing sibling; sync anchors on that sibling and
inserts the new `contribute({ ... })` call in the same source file.

### render: shell fold seams

The `render` projection is an editable markdown view for shell folds. Each block
represents one fold field and syncs three owned source seams together:

````md
## shell-fold topFolded
field: topFolded
foldId: shell.top
attr: data-top-folded
css:
```css
.shell[data-top-folded="true"] { grid-template-rows: 0 1fr; }
.shell[data-top-folded="true"] .top { display: none; }
```
````

Sync writes:

- `frontend/systems/main.ts`: `shell.dataset.<field>` and the `fold.changed` guard.
- `frontend/core/snapshot.ts`: `ui.shell.<field>` and the assertion expression map.
- `frontend/styles.css`: CSS rules for `[data-<field>]`.

Add a new `## shell-fold <field>` block next to the existing shell folds to
create the whole render seam. This is the missing view layer for panel-collapse
tasks after `commands` and `command-ui` have created the command and button.

When `watch` is running, edits to a projection sync back automatically; edits to
source regenerate the projection.

## Contract

- A projection file is disposable and ignored by git.
- `commands` routes by `id`, `events` by event name, `command-ui` by `command`,
  and `render` by shell field; these identifiers must stay unique, and each slice
  must keep its identifying field.
- A no-op sync (generate, then sync with no edits) must leave source byte-for-byte
  unchanged; the watcher relies on this. Guarded by `node dx/selftest.mjs`.
- Projection sync is intentionally narrow: it replaces known slices, not whole
  files.
- `sync`/`watch` accept `--dry-run` (aka `--no-write`/`--no-sync`): the source
  edits a view change implies are computed and reported (which files, +/- lines)
  but **nothing is written**. This is the views-only dogfood guard — edit only
  `views/`, confirm the whole change is expressible as a clean source diff (✓
  deliverable) or hits a routing error (✗ the view layer can't express it yet =
  the next projection to build). Drop the flag to actually land it.
- `flows` and `data` are read-only because they are derived from commands,
  declarations, `emit(...)`, and `on(...)`.

## Routing & refactors (why id/name, not line:column)

Sync routes a slice to its source by its **identifier** (command `id`, event
name) — deliberately *not* by `file:line`. A line/column locator goes stale the
moment anything above it changes (add a command, reformat a block) and would make
every unrelated edit a routing hazard; an identifier is stable across reorders,
insertions, and deletions, which is the common case. The id is also already in the
slice body, so it costs nothing to store.

The case identifiers *don't* cover is **renames**: if you change an `id`/name in the
projection, sync can't find it in source. That is intentional — a rename also
touches event handlers, tests, `paletteCommand` references, etc., so silently
rewriting just the register/interface slice would leave dangling references. Sync
fails loudly and lists the un-projected source identifiers (the likely rename
source) so you can see what happened, then:

- to rename, use `refactor_tool` (updates all references) and regenerate the view;
- to add command/command-ui/render slices, place the new slice after an existing
  sibling; for new events, declare them in the owning system.

True rename-tracking through a projection would require AST-level identity (match a
node across an id change), not text slices — a deliberate future step, not something
the current text-slice sync should fake.

## Adding another projection

Add the concept in three small pieces:

- `dx/projections/file-to-projection/<name>.mjs`: collect source slices and render
  the view file.
- `dx/projections/projections-to-file/<name>.mjs`: parse edited projection slices
  and sync them back, if the projection is editable.
- `dx/projections/registry.mjs`: wire the projection definition.

The registry shape is:

```js
['name', {
  name: 'name',
  outFile,
  description,
  generate,
  sync,
  watchFiles,
  count,
}]
```

The useful shape is:

1. collect source slices with file, line, id, start, end, and text
2. render them as a small valid file (an array/interface/markdown stream)
3. parse the projection blocks or array/interface elements
4. rescan source files and replace only matching slices

Good projections are boring and mechanical. If a task needs a long prose prompt,
make a projection or constructor that turns the recurring edit shape into data.
