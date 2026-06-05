# ECS Graph v2

Small TypeScript proof of concept for a composable, event-driven graph app.

This iteration tests whether systems can stay small and independent while sharing typed infrastructure: bus, commands, archetypes, places, and data.

## Run

From the repository root:

```bash
npm run dev:v2
```

Or from this folder:

```bash
npm run dev
```

V2 serves at `http://127.0.0.1:5174/`.

## Current Shape

- `system(name, setup)` registers a system.
- `systems.start(ctx, () => ctx.bus.emit('app.start'))` wires all systems and starts the app.
- `ctx.bus` is the only semantic communication path between systems.
- `ctx.contexts.commands` owns command metadata and raw input mapping.
- `ctx.contexts.archetypes` lets systems contribute entity defaults/capabilities.
- `ctx.contexts.places` exposes named render places without leaking DOM queries everywhere.
- `world` stores entity data; only the `data` system mutates node CRUD.

## Systems

- `render`: owns shell slots, render placement, node DOM drawing, and render-time default centering.
- `input`: starts the command-backed input router.
- `main`: emits base shell and toolbar.
- `log`: observes events and renders the event log.
- `modal`: registers modal commands and renders modal contents.
- `palette`: registers the palette command and renders command rows.
- `editing`: registers the create-node command and label payload.
- `data`: owns node create/update and emits data facts.
- `selection`: contributes `Selectable`, registers selection commands, owns selection state.
- `drag`: contributes `Draggable`, registers drag commands, requests data updates.

## Event Convention

Events are namespaced by owning system or domain.

- Commands/request events use imperative names, for example `data.node.create`, `selection.node.select`.
- Facts use past-tense names, for example `data.node.created`, `selection.node.selected`.
- Render adapter events live under `render.*`.

The current event flow for node creation:

1. `editing.node.create` command runs from `A` or toolbar.
2. Command emits `data.node.create`.
3. `data` creates the node from archetype defaults plus command payload.
4. `data` emits `data.node.created`.
5. `render` requests centering through `data.node.update` if needed.
6. `selection` auto-selects created selectable nodes.
7. `render` redraws on data/selection facts.

## Commands

Commands are registered as data:

```ts
contexts.commands.register({
  id: 'editing.node.create',
  label: 'Create node',
  event: 'data.node.create',
  input: { on: 'keydown', key: 'a', prevent: true },
  payload: () => ({ Label: { text: nextName() } }),
});
```

The same registry drives keyboard shortcuts, `data-command` buttons, and palette rows. This should make shortcut editing/export possible later without rewriting systems.

## Capabilities

Capabilities are contributed by systems through archetypes:

```ts
contexts.archetypes.extend('node', { Selectable: true });
contexts.archetypes.extend('node', { Draggable: true });
```

The data system does not know which systems contributed those defaults. It only composes the node archetype when constructing data.

## Render Boundary

`render.view.set` accepts a `Renderable`:

```ts
type Renderable = string | Node | (() => string | Node);
```

This keeps render as an adapter boundary. Today it accepts DOM strings or DOM nodes; later we can add JSX/React adapters without forcing every system to learn a new component model.

## Open Questions

- Should `world.selected` move out of `world` into a selection-owned store?
- Should render be allowed to request default centering, or should layout become its own system?
- Should command ids and event names share a generated type to avoid string duplication?
- How much command metadata is needed for user-editable shortcuts: category, scope, conflict policy, display order?
- Should data updates become patch operations, component operations, or command transactions?
