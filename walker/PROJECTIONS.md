# walker feature projections

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
```

- `commands` -> `walker/views/commands.proj.ts`: every command spec from
  `contexts.commands.register(...)` as one compilable `CommandSpec[]` array.
- `events` -> `walker/views/events.proj.ts`: editable event declaration lines
  from `CustomEvents` / `BuiltinEvents`.
- `flows` -> `walker/views/flows.proj.md`: read-only map of commands, emitters,
  and handlers per event.
- `command-ui` -> `walker/views/command-ui.proj.ts`: editable
  `contribute({ surface, command, ... })` affordance calls.

### commands: a compilable array (no markers)

The `commands` projection is one valid TypeScript file — a single
`export const commands: CommandSpec[]` array, grouped by source file with a
`// ── <file> ──` header per group:

```ts
// @ts-nocheck — @walker-projection commands v2. Source files still own these slices.
import type { CommandSpec } from '../../v2/types';

export const commands: CommandSpec[] = [
  // ── v2/systems/detail.ts ──
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

To add a brand-new command, use the `add_command` constructor (it splices into the
right `register([…])` and declares the request event); sync only edits slices that
already exist in source.

### events: compilable interface blocks (no markers)

The `events` projection is also one valid TypeScript file — the `CustomEvents` /
`BuiltinEvents` declarations gathered from every `declare module '../types'`,
re-emitted as `interface` blocks grouped by source file:

```ts
// @ts-nocheck — @walker-projection events v2. Source declares these in `declare module '../types'`.
interface CustomEvents {
  // ── v2/systems/foldable.ts ──
  'fold.toggle': { id: string };
  ...
}
```

Routing is **by event name** (globally unique). Edit a type, then `sync`. New
events are declared where the owning system augments `CustomEvents`, not here.

### command-ui: marked slices

`command-ui` still uses `// BEGIN command-ui … / // END` markers, because a
`contribute({ … })` call isn't a single clean array element. Edit between the
markers, then `sync`.

When `watch` is running, edits to a projection sync back automatically; edits to
source regenerate the projection.

## Contract

- A projection file is disposable and ignored by git.
- `commands` routes by `id` and `events` by event name; both must stay unique, and
  each slice must keep its identifying `id:`/`'name':` (sync asserts it).
  `command-ui` routes by its marker lines — don't edit a marker unless you mean to
  move the slice.
- A no-op sync (generate, then sync with no edits) must leave source byte-for-byte
  unchanged; the watcher relies on this. Guarded by `node walker/selftest.mjs`.
- Projection sync is intentionally narrow: it replaces known slices, not whole
  files.
- `flows` is read-only because it is derived from commands, declarations,
  `emit(...)`, and `on(...)`.

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
- to add, use the `add_command` constructor (commands) or declare the event in its
  owning system (events).

True rename-tracking through a projection would require AST-level identity (match a
node across an id change), not text slices — a deliberate future step, not something
the current text-slice sync should fake.

## Adding another projection

Add one definition in `walker/projections.mjs`:

```js
projections.set('name', {
  name: 'name',
  outFile,
  description,
  generate,
  sync,
  watchFiles,
  count,
});
```

The useful shape is:

1. collect source slices with file, line, id, start, end, and text
2. render them with `// BEGIN <kind> <id> <file>:<line>` markers
3. parse the projection blocks
4. rescan source files and replace only matching slices

Good projections are boring and mechanical. If a task needs a long prose prompt,
make a projection or constructor that turns the recurring edit shape into data.
