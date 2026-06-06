# ECS Graph v2

Small TypeScript proof of concept for a composable, event-driven graph app.

This iteration tries a stricter rule: data declarations imply UI and commands. Entities declare abilities, collections declare CRUD/search/order, and a DX system checks that those declarations are actually surfaced.

## Mental Model

One sentence: v2 is a typed event app where systems register command arrays and react to bus events, while entities and collections declare enough data for render, palette/help, shortcuts, CRUD/search, and DX checks to be generated consistently.

One paragraph: `Graph` owns graph data, `appModel` describes what that data can do, systems plug into a shared context, commands translate raw DOM input into typed app events, and render places DOM into named slots from templates and ability metadata. Cross-system workflows live in `feature(...)`, not inside individual systems. The only direct DOM event listeners are app boot and the input adapter; every other interaction should be a command or bus event so input, hotkeys, palette, help, and UI affordances stay overrideable from the same registry.

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
- `ctx.contexts.commands` owns command metadata and raw input mapping; systems register command arrays.
- `ctx.contexts.places` exposes named render places without leaking DOM queries everywhere.
- `ctx.contexts.view` owns pan/zoom state plus screen/space coordinate utilities.
- `ctx.model` indexes entity and collection declarations by kind/id.
- `ctx.graphs.current` is the active graph aggregate.
- `Graph` owns nodes, selected/focused state, CRUD, and graph switching boundaries.
- `model.ts` declares graph entities, collections, abilities, properties, and graph storage.
- `types.ts` holds shared nouns: events, commands, modal visuals, entities, collections, abilities, and geometry.

## Systems

- `render`: owns shell slots, render placement, and node DOM drawing.
- `input`: starts the command-backed input router.
- `main`: emits base shell and toolbar.
- `log`: observes events and renders the event log.
- `outline`: renders collection lists/search/create/delete from `ctx.model.collections()`.
- `modal`: registers modal commands and renders modal contents.
- `commandModal`: renders Palette and Help from the same searchable grouped command modal definition.
- `domain`: registers commands implied by collections and abilities.
- `view`: owns canvas pan/zoom and emits `view.changed`.
- `graph`: adapts graph CRUD/switch events to the current `Graph`.
- `selection`: writes current graph selection.
- `focus`: writes current graph focus.
- `drag`: registers drag commands and requests graph node updates.
- `properties`: renders item properties from entity property schemas and applies declared patches.
- `dx`: validates model declarations against registered commands.

## Architectural Decisions

- Domain declarations live in `model.ts`; runtime contexts and systems live in `app.ts`.
- Raw DOM events enter through the input adapter only; systems register commands and listen to bus events.
- Systems register command arrays, even when they currently own one command.
- Render reads entity metadata through `ctx.model.entity(kind)`, not imported entity constants.
- Configurable UI comes from entity `properties`; the properties system renders schema fields and applies schema patches.
- Templates expose structural slots; entity abilities decide what controls and handlers fill those slots.

## Model Rule

The core rule is:

```ts
entity + abilities -> actions -> palette command + UI affordance
collection -> list + CRUD + order + search
```

The current model declares:

```ts
const nodeEntity = entity('node', {
  abilities: [
    selectable(),
    draggable(),
    collapsible(),
    editable(),
    configurable(),
  ],
  properties: [
    { id: 'title', input: 'text', patch },
    { id: 'width', input: 'number', patch },
    { id: 'height', input: 'number', patch },
    { id: 'collapsed', input: 'checkbox', patch },
  ],
});

const appModel = {
  collections: [
    collection('graphs', { crud, search: true, order: 'created' }),
    collection('nodes', { entity: nodeEntity, crud, search: true, order: 'created' }),
  ],
};
```

`dx` checks this contract at app start:

- every ability action has a visible palette command
- every ability action has at least one UI affordance
- every affordance points to a registered command
- every collection has create/delete commands
- every collection has search and order
- every configurable entity has declared properties

Editable affordances use the same visual cue everywhere: dashed underline plus edit-in-place. Node titles and Help hotkeys already share that rule.

Configurable affordances use the item properties command. Nodes expose it as a header gear button and as the `Open item properties` command when a node is selected. The properties modal is schema-driven: fields, labels, inputs, values, and patches come from `entity.properties`.

Entity templates expose structural slots, not hardcoded abilities. The node template has `header:start`, `title`, and `header:end`; render fills those slots from ability affordance metadata.

## Modal Model

`modal` is the abstract container:

- trigger: command or event opens it
- close ability: `Escape`, backdrop, or close button
- render place: `Places.Modal`, above the app
- container: `tpl-modal`
- visual: `panel`, `command`, or `properties`

Palette and Help are both command modals. Their only definition differences are title, shortcut, availability filter, and whether hotkeys are editable:

```ts
palette = { title: 'Palette', editableHotkeys: false, availableOnly: true }
help = { title: 'Help', editableHotkeys: true, availableOnly: false }
```

Both have search. Help reuses the same grouped command collection but swaps the command button row for an editable hotkey row.

## Features

`nodeLifecycle` is the current complex feature slice. It is intentionally the place where cross-system behavior lives.

Node creation flow:

1. `editing.node.create` command is generated by the `nodes` collection and runs from `A`, toolbar, outline, or palette.
2. `nodeLifecycle` translates it into `graph.node.create`.
3. `graph` asks `ctx.graphs.current.node(...)` to create and save the entity.
4. The current graph places the node beside the selected node, or near the view center fallback.
5. `graph` emits `graph.node.created`.
6. `nodeLifecycle` selects and focuses the new node.
7. `render` draws from `ctx.graphs.current`.

This is more verbose than a direct function call, but the debug story is much cleaner: the event log shows the lifecycle.

## Event Convention

Events are namespaced by owning system or feature domain.

- Commands/request events use imperative names, for example `graph.node.create`, `selection.node.select`.
- Facts use past-tense names, for example `graph.node.created`, `selection.node.selected`.
- Cross-system orchestration belongs in `feature(...)`, not in individual systems.

## Commands

Commands are registered as data:

```ts
contexts.commands.register([
  {
    id: 'editing.node.create',
    label: 'Create node',
    event: 'editing.node.create',
    input: { on: 'keydown', key: 'a', prevent: true },
    payload: () => ({ Label: { text: nextName() } }),
  },
]);
```

The same registry drives keyboard shortcuts, form inputs, focus-out commits, pointer gestures, `data-command` buttons, command modal rows, and the help shortcut editor. Command modal contents are searched from command metadata, not hardcoded.

Shortcut edits are checked against the registry before saving. Duplicate hotkeys are highlighted in red and stay unsaved until the user chooses a free key.

Useful command fields:

- `group`: where the command appears in palette/help, usually the owning system.
- `shortcut`: display label for the help editor.
- `hidden`: keeps pointer/internal commands out of user-facing lists.
- `available`: hides selected-only commands from palette and blocks unavailable UI actions.
- `input.global`: allows shortcuts such as `Escape` to work while a text field is focused.

## Graph Domain

`Graph` is the aggregate root. It owns relationships between nodes and graph-level UI state:

```ts
const graph = ctx.graphs.current;
const node = graph.node({ Label: { text: 'A' } }, { at: ctx.contexts.view.spaceCenter(Places.Stage) });

graph.updateNode(node.id, { Position: { x: 100, y: 100 } });
graph.deleteNode(node.id);
ctx.graphs.switch('g2');
```

`GraphNode` keeps a `graph` reference, so the entity knows the aggregate it belongs to. Public creation goes through `graph.node(...)`, which both constructs and saves the node.

Visible graph commands:

- `N`: create a graph.
- `G`: switch to another graph, creating `g2` on first use.
- `Delete`: delete the selected node from the current graph.

There are no hidden archetype defaults or capability merges. If a future capability needs data, it should be visible as entity data. If it is behavior, keep it in that behavior's system.

## Size Note

The declaration/validation layer grew the code. Recent passes moved shared vocabulary into `types.ts`, merged Palette/Help into one command-modal system, added shortcut conflict checks, made configurable properties first-class, moved node header controls behind ability metadata, routed DOM input through commands, and split the domain model into `model.ts`:

- baseline before these passes: `v2/app.ts` was `1,084` lines / `44,127` bytes
- current `v2/app.ts`: `1,147` lines / `47,675` bytes
- extracted `v2/model.ts`: `254` lines / `8,053` bytes
- extracted `v2/types.ts`: `148` lines / `5,837` bytes

So the main runtime file is closer to the original size again, while the overall v2 code is larger because the model and shared vocabulary are explicit. The payoff depends on future entities reusing the same CRUD/list/search/palette/UI/modal/property plumbing instead of adding one-off systems.

## Render Boundary

`render.view.set` accepts a `Renderable`:

```ts
type Renderable = string | Node | (() => string | Node);
```

This keeps render as an adapter boundary. Today it accepts DOM strings or DOM nodes; later we can add JSX/React adapters without forcing every system to learn a new component model.

The default adapter uses native `<template>` elements from `index.html`:

- `ctx.contexts.templates.clone(name)` clones `#tpl-${name}`.
- `templates.text(root, name, value)` fills `[data-text="name"]`.
- `templates.slot(root, name)` finds `[data-slot="name"]` for child renderables.

Systems still emit renderables, not framework components. The template adapter is just the current default.

## View And Space

Node positions are graph-space coordinates. The stage is screen-space. The `view` context bridges them:

- `view.get()` returns `{ x, y, scale }`, where `x/y` are the graph-space point at the top-left of the stage.
- `view.screenToSpace(point)` and `view.spaceToScreen(point)` convert coordinates.
- `view.clientToSpace(place, point)` converts pointer events into graph-space.
- `view.visibleRect(place, margin)` returns the graph-space area currently visible.
- `view.isVisible(place, rect, margin)` lets render skip offscreen entities.

Render keeps HTML nodes in graph space, then transforms the node layer with the current view. Wheel zoom anchors at the cursor; background drag pans the view. Dragging nodes uses `clientToSpace`, so node movement stays correct at any zoom level.

## Open Questions

- Should `selected` and `focused` stay graph-owned, or move into small system-owned stores later?
- Should graph creation own all visual defaults, including size?
- Should features be typed separately from systems so only features can listen across domains?
- Should command ids and event names share generated types to avoid string duplication?
- How much command metadata is needed for user-editable shortcuts: category, scope, conflict policy, display order?
