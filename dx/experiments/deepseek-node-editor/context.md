# ecs-canvas-graph compressed context

## Mental model

`frontend/` is a typed event-driven graph editor. Entities declare abilities; systems
own infrastructure/state; features connect facts from one owner to requests of another.
The event bus and registries compose plugins at boot. Canvas nodes/edges remain generic.

Dependency direction: model data -> core contracts -> systems/abilities -> composition.
Avoid adding task-specific state to `frontend/core.ts`, `frontend/types.ts`, or generic
graph classes when a system-owned snapshot extension works.

## Change map

- New system: copy the shape of `frontend/systems/jump.ts`; export
  `register<Name>(system: Registry)`; wire import + call in
  `frontend/systems/index.ts`.
- Commands/events/UI/state for one capability can stay in that single system file.
- Graph requests/facts live in `frontend/systems/graph.ts`. Create through
  `graph.node.create` / `graph.edge.create`; observe `graph.node.created` to learn IDs.
- Current document: `graphs.current`; nodes via `nodes()` / `getNode(id)`; directed
  edges via `edges()` with `From` and `To`.
- Plugin document data: `graphs.current.registerSnapshotExtension(key, snapshot,
  restore)`. Unknown extensions survive when a plugin is absent.
- Transient per-node UI: `contexts.decorations.overlays.set(source, overlays)` where an
  overlay is `{ ref: {kind:'node', id}, text, id?, className? }`.
- Commands: `contexts.commands.register([{id,label,group,...}])`, then
  `on('request.name', handler)`. `contribute(...)` adds a command button.
- Custom panel: `declarePanel({id, anchor, movable, layout, order})`; route button with
  `contribute({surface:'top', panel:id, command, kind:'button', text})`.
- Rich UI: construct DOM inside a `() => HTMLElement` body and emit
  `modal.open`; do not query the global document from non-render code.
- Typed test/plugin API: augment `CustomExposable`, call `ctx.expose('key', api)`.
- New events: augment `CustomEvents` beside their owner. Imperative request,
  past-tense fact. Facts trigger redraw; never emit render events manually.

## Tests

Command tests use `bootApp`, `runCommand`, `settle` from
`tests/commands/testkit.ts`. They inspect `ctx.graphs.current`, exposed APIs,
`ctx.debug.snapshot()`, and DOM. Prefer one focused file, then full suite + typecheck.

## Guardrails

- Every user action has a command and UI affordance.
- Mutate owned state only in event handlers.
- Cross-owner mutation goes through request events.
- No `document.querySelector` outside render-adjacent code.
- System teardown must remove origin-scoped UI/state subscriptions.
- Do not add a new core context or dependency.

