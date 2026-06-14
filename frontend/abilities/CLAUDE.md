# abilities/ — one capability per file: metadata builder + `register<Id>` system

Pattern per file: `export const <id> = <T>() => ability<T>(...)` (declares actions +
affordances an entity opts into) AND `register<Id>(system)` (commands + event handlers).
Both halves live together so toggling `ability.<id>` removes UI + behavior atomically.

- `selectable.ts` — pointer select, Shift+toggle, Tab/Shift+Tab cycle, `x` delete fan-out, `selection.choose` seam.
- `draggable.ts` — pointer drag → `item.update` Position patches.
- `nudgeable.ts` — arrow-key moves (separate modality from drag, toggle independently).
- `resizeable.ts` — pointer resize handle → Size patches.
- `editable.ts` — Enter / dblclick inline title edit on `[data-editable-title]` → Label patch.
- `collapsible.ts` — `c` collapse toggle (writes the fold store, not item data).
- `configurable.ts` — properties modal from `entity.properties` schema → typed patches.
- `shared.ts` / `shapes.ts` — `ability()`/`action()` builders; structural item types (Identified, Labeled…).

Mutations always go `emit('item.update', { ref, patch })` — never touch a store directly.
An ability that needs an entity's DOM hook documents the convention (e.g. editable needs
`[data-editable-title]` in the renderer; resizeable needs a `data-slot="resize"` hole).
