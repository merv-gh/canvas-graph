# projection: executable automation system

Task-specific, source-backed change workspace. Read once; exact origins remain available
through ordinary file reads only if an edit needs verbatim confirmation.

## Boundary and ownership

New `automation` system owns type registry, per-graph configuration, transient run state,
commands, inspector, badges, snapshot extension. Generic graph owns node/edge mutation.
Composition owns only import/registration. CSS owns badge/inspector presentation. Tests
drive commands and exposed API.

Do not edit generic graph model or core. This avoids coupling drawing-only graphs to one
execution engine and makes future ComfyUI/Blender/n8n adapters independent plugins.

## Slot A: new system

Target: `frontend/systems/automation.ts` (new file).

Minimal plugin form, from `frontend/systems/jump.ts:22-25,35` and
`frontend/core.ts:78-90`:

```ts
import type { Registry } from '../core';

declare module '../types' {
  interface CustomEvents { /* owned request/fact events */ }
  interface CustomExposable { automation?: AutomationApi }
}

export function registerAutomation(system: Registry) {
  system('automation', (ctx) => {
    const { on, emit, graphs, contexts, contribute, declarePanel, origin } = ctx;
    // setup; return teardown when non-origin resources need cleanup
  }, { requires: ['graph', 'render.stage', 'tool.panel', 'modal'] });
}
```

Relevant exact contracts:

```ts
// frontend/model/graph.ts:249-270
graph.registerSnapshotExtension<T>(key, snapshot, restore) // returns disposer
graph.snapshotExtension<T>(key): T | undefined

// frontend/core/decorations.ts:57-72
contexts.decorations.overlays.set(source, Array<{
  ref: { kind: 'node', id: string }, text: string, id?: string, className?: string
}>)

// frontend/systems/graph.ts:486-512
emit('graph.node.create', nodeDraft)
// synchronous owner fact: graph.node.created { graphId, id, hints? }
emit('graph.edge.create', { From, To, EdgeKind: 'sync' })
// synchronous owner fact: graph.edge.created { graphId, id, edge }
```

Recommended state:

```ts
type Status = 'idle' | 'running' | 'success' | 'error';
type NodeConfig = { id: string; type: string; config: Record<string, unknown> };
type NodeRun = NodeConfig & { status: Status; input?: unknown; output?: unknown; error?: string };
type TypeDef = {
  type: string;
  label: string;
  execute(input: unknown, config: Record<string, unknown>): unknown;
};
```

Use maps keyed by graph ID. `attach(graph)` registers extension `automation` once per
graph; attach all graphs at boot and on `graph.created`/`graph.switched`. Persist only
configuration, not run status. Restore must replace that graph's configuration and redraw
badges. Remove config on `graph.node.deleted`.

Exact pitfalls: `graphs.all()` is a method returning `Graph[]` (never iterate
`graphs.all`). Read existing stored data with `graph.snapshotExtension('automation')`
before registration. Register with three arguments:
`graph.registerSnapshotExtension('automation', () => storedValue, value => restore(value))`;
do not pass an object containing `snapshot`.

Built-ins: `manual` returns `config.value`; `set` returns `config.value`; `uppercase`
returns `String(input ?? '').toUpperCase()`; `output` returns input.

Example creation: queue four specs, listen to synchronous `graph.node.created` to capture
IDs, emit four node-create requests, then three edge-create requests. Labels and types:
`Manual Trigger/manual`, `Set Message/set`, `Uppercase/uppercase`, `Output/output`.
Set config value to `hello from canvas`. Give positions or allow current placement.

Run algorithm: configured-node subgraph only. Build incoming/outgoing maps and indegrees
from `graphs.current.edges()`. Stable Kahn topological queue ordered by canvas node order.
For each ready node set running, gather predecessor outputs (single input = scalar; many =
array), call registered executor, set success/output. Missing type sets error. Remaining
nodes after queue indicate cycle and become error without execution. Record
`lastRun = { status, order, output?, error? }`. Refresh badges and emit completion/failure
fact. Synchronous execution is acceptable for this slice.

Badge source should be `origin`, with stable IDs `automation-status-${node.id}`, text such
as `manual · idle` / `uppercase · success`, and classes
`automation-status automation-status-${status}`.

Inspector body: `.automation-inspector`; each `.automation-node-row` carries
`data-node-id`, `data-status`, visible label/type/status/output/error. Open through
`automation.inspector.open` and `modal.open`.

Required commands: `automation.example.create`, `automation.run`, `automation.reset`,
`automation.inspector.open`. Declare a movable `automation` stack panel anchored
`middle-right`; contribute all four commands into it.

## Slot B: composition

Target: `frontend/systems/index.ts`.

Exact seams:

```ts
import { registerCancellation } from './cancellation';
// insert: import { registerAutomation } from './automation';

export function registerSystems(system: Registry) {
  registerRender(system);
  // ...
  registerToolPanel(system);
  // insert registerAutomation(system) after tool panel and after graph is declared in
  // registry ordering; registry starts after all declarations, so physical placement is
  // not dependency execution order. Prefer near registerGraph for readability.
```

## Slot C: CSS

Target: append one marked section to `frontend/styles.css`.

Existing base overlay is `.item-overlay` at lines 529-538. Add concise status variants:
idle muted, running accent, success green, error red. Style inspector grid/rows/output.
Do not restyle generic nodes.

## Slot D: focused test

Target: `tests/commands/automation.test.ts` (new file).

Imports:

```ts
import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
```

Exact testkit usage (`bootApp` and `runCommand` are synchronous; `bootApp` returns AppCtx
itself, not an object containing `app`):

```ts
const ctx = bootApp();
expect(runCommand(ctx, 'automation.example.create')).toBe(true);
await settle();
expect(ctx.automation?.snapshot().nodes).toHaveLength(4);
expect(runCommand(ctx, 'automation.run')).toBe(true);
await settle();
expect(ctx.automation?.snapshot().nodes.at(-1)?.output).toBe('HELLO FROM CANVAS');
```

Test through required commands. Assert 4 nodes/3 edges, types/config, final uppercase
output, topological order length, reset preserving config, `.automation-inspector`, four
status overlays, custom type registration/unregister, extension round-trip, and failure.

## One-operation projection edit

`apply_projection` accepts complete Slot A source, complete Slot D source, and CSS to
append. It writes both new files and deterministically inserts Slot B import/call. This is
the preferred edit: one semantic change operation, no fragile cross-file text surgery.
