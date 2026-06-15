# frontend — read this, then ONLY the files your task touches

One sentence: a typed event bus where **entities** declare **abilities**, abilities bring
commands + UI + behavior, **systems** provide infrastructure, **features** choreograph
cross-system flows, and render places DOM into named slots.

Authority chain: `PRINCIPLES.md` (22 enforced rules) > this file > `../README.md` (project hub + automation).
The 7-noun ladder lives at the top of `types.ts` (MODEL MAP) — skim it once, it's the
whole mental model: Renderable → ItemRef → AppEvents → CommandSpec → AbilityDef →
EntityDef → CollectionDef/ModelDef.

## Task router — open only what's listed

| Task | Files (usually sufficient) |
|---|---|
| New keyboard command / shortcut | the owning `systems/<x>.ts` or `abilities/<x>.ts` only |
| New entity kind | copy `systems/containers.ts` (entity+commands+storage in 1 file) |
| New system | copy `systems/jump.ts` (minimal exemplar), wire in `systems/index.ts` |
| New ability | copy `abilities/nudgeable.ts`, wire in `abilities/index.ts` + entity `abilities:[...]` |
| Cross-system flow (A's fact → B's request) | `features.ts` only — never inside a system |
| Node/edge data, CRUD | `model/graph.ts` (store) + `systems/graph.ts` (events/commands) |
| Node/edge appearance | `model/entities.ts` (renderers) + `styles.css` |
| Stage paint / culling / overlays | `systems/render-stage.ts` |
| Redraw scheduling / slots / shell | `systems/render.ts` (don't touch for paint changes) |
| Left panel tree | `systems/outline.ts` + `core/hierarchy.ts` |
| Palette / Help / shortcut editing | `systems/command-modal.ts` |
| Letter-pick flows | `systems/command-picker.ts` (multi-step) or `systems/jump.ts` (nav) |
| Pan/zoom/fit | `systems/view-zoom.ts`, `systems/view-pan.ts`, `core/view.ts` |
| Fold/collapse/zen anything | `core/fold.ts` (store) + `systems/foldable.ts` (click/event) + owner |
| Multi-select / bulk ops | `systems/choose.ts` + `core/selection.ts` + `abilities/selectable.ts` |
| Boot / flags / plugin lifecycle | `core.ts` (registry) + `runtime.ts` + `app.ts` |
| DX rules | `systems/dx.ts` |
| Record/replay/snapshot/test-gen | `core/sim.ts`, `core/snapshot.ts`, `core/test-gen.ts`, `systems/debug.ts` |

Each of `core/`, `systems/`, `abilities/` has a `CLAUDE.md` index — one line per file.

## Hard rules (DX/tests WILL fail you otherwise)

- Events: imperative = request (`graph.node.create`), past-tense = fact (`.created`,
  emitted by the data owner after the change). Subscribe to facts, never to requests.
  Fact suffixes auto-trigger redraw (`core/redraw.ts`) — **never emit render events yourself**.
- Mutate domain state only inside an event handler (replayability is the undo/test seam).
- Item mutation = `emit('item.update', { ref, patch })`. The kind's storage handler
  (`contexts.storage.register`) applies it and emits the fact. Abilities never know stores.
- New events: `declare module '../types' { interface CustomEvents { ... } }` next to the owner.
- Commands are data (`contexts.commands.register([...])`) — the registry auto-tags your
  `origin` for flag teardown. Every user action needs a command AND a UI affordance.
- No `document.querySelector` outside render-adjacent files — use `contexts.places.el(place)`.
- Don't add a 15th `ctx.contexts` entry or grow `core.ts` past 400 lines (ratchet: merge first).
- Selection/fold/camera are presentation stores, never fields on graph data.

## Verify loop (fast)

```bash
npx vitest run tests/commands/<relevant>.test.ts   # seconds
npx vitest run && npm run typecheck                # before done
```

Test pattern (`tests/commands/testkit.ts`): `bootApp(flags?)` boots the real app in
jsdom with memory IO; `runCommand(ctx, id)`, `await settle()`, then assert on
`ctx.graphs.current` / `ctx.debug.snapshot()` / DOM. A UI bug repro = replay a trace:
`ctx.sim.replay([{ name, data, at: 0 }])` — see `tests/commands/recorded/*` for the idiom.

Debug surfaces (browser console or tests): `window.app` = AppCtx; `app.debug.snapshot()`
(structured user-visible state, each leaf maps to a TS assertion); `app.dx.run()`
(contract issues); `app.sim.record()/replay()`; `app.flags` + Help modal toggles any
system/ability/feature live. Automated dev/debug/fix loop + DX roadmap: `../README.md`; harness: `dx/README.md`.

App-aware queries — prefer these over grep for discovery (each boots the real app):
`node dx/cli/apptool.mjs commands [filter]` (all commands + shortcuts/origins),
`… events [filter]` / `… flows <event>` (who fires/handles, downstream chain),
`… scenario '<json>'` ({steps,asserts} against a fresh boot — instant behavior check),
`… gen-test '<json>' [out]` (scenario → vitest file), `… graph find|callers|file <q>`
(code index → file:line), `… locate <anchor>` (grep + verbatim numbered context).
Shapes and local-model delegation guidance live in `dx/README.md`.
