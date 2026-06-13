# walker feature projections

Feature projections are editable local views over source-owned slices. They are
for context compression, not new ownership: the source files keep the structure,
while the projection gives a smaller model or human one focused surface.

## Commands projection

```bash
npm run dx -- project generate commands
npm run dx -- project sync commands
npm run dx -- project watch commands
```

The generated file is `walker/views/commands.proj.ts`. Each slice is wrapped in
stable markers:

```ts
// BEGIN command graph.node.create v2/systems/graph.ts:63
{ id: 'graph.node.create', label: 'Create node', ... },
// END command graph.node.create
```

Edit the command literal between the markers, then run `sync`. The sync step
finds the current source literal by command id and replaces only that object.
When `watch` is running, edits to the projection sync back automatically; edits
to source files regenerate the projection.

## Contract

- A projection file is disposable and ignored by git.
- Marker lines are the routing table. Do not edit them unless you mean to move a
  slice to another source file.
- The source slice must still contain the same top-level id as the marker.
- Projection sync is intentionally narrow: it replaces known slices, not whole
  files.

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
