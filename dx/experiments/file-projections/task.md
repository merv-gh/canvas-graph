# Automation-node vertical slice with headless backend

Turn the existing canvas graph into a small executable, n8n-like automation editor
without weakening drawing-only graph behavior.

## Backend contract

- Add a DOM-free module at `backend/automation.ts`. It owns the custom node registry,
  deterministic topological execution, input/output propagation, missing-type errors,
  downstream blocking, and cycle detection.
- Export a reusable long-lived backend for server adapters and a stateless execution
  convenience. It must not import `frontend/`, access DOM globals, or depend on canvas
  state.
- Public contract: export `AutomationBackend`, `createAutomationBackend`, and
  `executeAutomation`. Workflows use `{ nodes: [{ id, type, config? }], edges: [{ from,
  to }] }`; results expose per-node `status`, `input`, `output`, and `error` plus
  `lastRun: { status, order, output?, error? }`.
- Ship `manual`, `set`, `uppercase`, and `output` node types. Support registering and
  unregistering custom types.

## Canvas adapter and UI

- Add origin-scoped system plugin `automation` in `frontend/systems/automation.ts` and
  register it through `frontend/systems/index.ts`.
- Keep generic node/edge storage unchanged. Persist plugin metadata under
  `extensions.automation` using `Graph.registerSnapshotExtension`.
- Expose `ctx.automation` with `registerType`, `configure`, `run`, `reset`, and
  `snapshot`.
- `automation.example.create` creates `Manual Trigger -> Set Message -> Uppercase ->
  Output`; running it produces `HELLO FROM CANVAS`.
- Add `automation.run`, `automation.reset`, and `automation.inspector.open`. Use typed
  request/fact events, existing command/affordance APIs, decoration overlays, a real
  `.automation-inspector`, and `.automation-status-*` styling.
- Missing types and cycles fail visibly; blocked downstream nodes must not succeed.

## Verification

- Add focused headless-backend and command-driven canvas tests.
- Include `backend/**/*.ts` in typechecking.
- Run both focused tests, `npm run typecheck`, and the full Vitest suite.
- Do not weaken existing tests or add dependencies.
