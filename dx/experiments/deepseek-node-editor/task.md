# Automation-node vertical slice

Turn the existing canvas graph into a small executable, n8n-like automation editor
without weakening its generic graph behavior.

## Product behavior

- Add an origin-scoped system plugin named `automation` in
  `frontend/systems/automation.ts`; register it through `frontend/systems/index.ts`.
- Keep generic node/edge storage unchanged. Automation metadata belongs to the plugin
  and persists through graph snapshots under `extensions.automation` using
  `Graph.registerSnapshotExtension`.
- Support a registry of custom automation node types. Ship four built-ins:
  `manual`, `set`, `uppercase`, `output`.
- Expose `ctx.automation` for plugins/tests with:
  - `registerType({ type, label, execute })`, returning an unregister function;
  - `configure(nodeId, type, config?)`;
  - `run()` and `reset()`;
  - `snapshot()`, returning `{ types, nodes, lastRun }`.
- Each node snapshot must contain `id`, `type`, `config`, `status`, plus available
  `input`, `output`, or `error`. Status is `idle | running | success | error`.
- `automation.example.create` creates this directed four-node workflow on the current
  graph: `Manual Trigger` -> `Set Message` -> `Uppercase` -> `Output`. The set node
  uses `hello from canvas`; a successful run produces `HELLO FROM CANVAS`.
- `automation.run` executes configured nodes once in deterministic topological order,
  passing predecessor output forward. Cycles and missing node types fail visibly and
  must not execute blocked downstream nodes.
- `automation.reset` clears transient execution state but keeps node configuration.
- `automation.inspector.open` opens a real UI view with class
  `.automation-inspector`; it lists configured nodes, type, status, and output/error.
- Add visible controls for create-example, run, reset, and inspector using existing
  command/affordance APIs. Show a status badge on every configured canvas node using
  the decorations overlay API and `.automation-status-*` CSS classes.
- Emit typed request/fact events. Imperative names are requests; past tense names are
  facts. Domain mutation stays in owning event handlers.

## Required commands

- `automation.example.create`
- `automation.run`
- `automation.reset`
- `automation.inspector.open`

## Verification

- Add focused command-driven tests in `tests/commands/automation.test.ts` covering:
  example creation, execution/output/order, reset, UI, custom type registration,
  snapshot persistence, and a cycle or missing-type failure.
- Run the focused test, full Vitest suite, and `npm run typecheck`.
- Do not edit existing tests to weaken contracts. Do not add dependencies.

