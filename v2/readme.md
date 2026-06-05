# ECS Graph v2

Small TypeScript proof of concept for a composable, event-driven graph app.

This iteration favors obvious data and explicit cross-system features over hidden defaults. Systems stay small; complex behavior is named as a feature slice.

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

- `system(name, setup)` registers an independent system.
- `feature(name, setup)` registers a cross-system workflow.
- `systems.start(ctx); features.start(ctx, () => ctx.bus.emit('app.start'))` wires everything and starts the app.
- System bodies receive `on` and `emit` directly, so they read as event handlers rather than plumbing.
- `ctx.contexts.commands` owns command metadata and raw input mapping.
- `ctx.contexts.places` exposes named render places without leaking DOM queries everywhere.
- `world` stores plain node data plus small UI state (`selected`, `focused`).

## Systems

- `render`: owns shell slots, render placement, and node DOM drawing.
- `input`: starts the command-backed input router.
- `main`: emits base shell and toolbar.
- `log`: observes events and renders the event log.
- `modal`: registers modal commands and renders modal contents.
- `palette`: registers the palette command and renders commands from command metadata.
- `editing`: registers the create-node command and label payload.
- `data`: owns node create/update and emits data facts.
- `layout`: handles layout commands such as centering a node.
- `selection`: registers selection commands and owns selection state.
- `focus`: owns focused-node state.
- `drag`: registers drag commands and requests data updates.

## Features

`nodeLifecycle` is the current complex feature slice. It is intentionally the place where cross-system behavior lives.

Node creation flow:

1. `editing.node.create` command runs from `A`, toolbar, or palette.
2. `nodeLifecycle` translates it into `data.node.create`.
3. `data` saves the node and emits `data.node.created`.
4. `nodeLifecycle` emits:
   - `layout.node.center`
   - `selection.node.select`
   - `focus.node.focus`
5. `layout`, `selection`, and `focus` each handle their own events.
6. `nodeLifecycle` reacts to data/selection/focus facts and emits `render.nodes.draw`.
7. `render` draws from current world state.

This is more verbose than a direct function call, but the debug story is much cleaner: the event log shows the lifecycle.

## Event Convention

Events are namespaced by owning system or feature domain.

- Commands/request events use imperative names, for example `data.node.create`, `selection.node.select`.
- Facts use past-tense names, for example `data.node.created`, `selection.node.selected`.
- Cross-system orchestration belongs in `feature(...)`, not in individual systems.

## Commands

Commands are registered as data:

```ts
contexts.commands.register({
  id: 'editing.node.create',
  label: 'Create node',
  event: 'editing.node.create',
  input: { on: 'keydown', key: 'a', prevent: true },
  payload: () => ({ Label: { text: nextName() } }),
});
```

The same registry drives keyboard shortcuts, `data-command` buttons, and palette rows. Palette contents are no longer hardcoded.

## Data

Nodes are plain data:

```ts
type NodeEntity = {
  id: Id;
  kind: 'node';
  Label: Label;
  Size: Size;
  Position?: Position;
};
```

There are no hidden archetype defaults or capability merges. If a future capability needs data, it should be visible as data. If it is behavior, keep it in that behavior's system.

## Render Boundary

`render.view.set` accepts a `Renderable`:

```ts
type Renderable = string | Node | (() => string | Node);
```

This keeps render as an adapter boundary. Today it accepts DOM strings or DOM nodes; later we can add JSX/React adapters without forcing every system to learn a new component model.

## Open Questions

- Should `selected` and `focused` move out of `world` into small system-owned stores?
- Should layout own all visual defaults, including size?
- Should features be typed separately from systems so only features can listen across domains?
- Should command ids and event names share generated types to avoid string duplication?
- How much command metadata is needed for user-editable shortcuts: category, scope, conflict policy, display order?
