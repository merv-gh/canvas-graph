# Extending the node catalog

Node types are catalog data. A normal addition changes one file and automatically gains:

- categorized palette search;
- an arm-and-place command;
- type label and property-picker support;
- default geometry;
- a stable `data-node-visual` render contract;
- DX validation and catalog tests.

## Add a type by reusing a visual primitive

Add one row to `frontend/model/node-types.ts`:

```ts
{
  id: 'tool-call',
  label: 'Tool call',
  category: 'Autonomous systems',
  keywords: ['function', 'api', 'latency', 'result'],
  visual: 'artifact',
  defaultSize: { w: 230, h: 100 },
  autoSize: false,
}
```

Use `autoSize: false` when the visual owns its geometry. Omit it when the box should
grow with title/description text.

Do not add another renderer for a semantic alias. Reuse one of the existing primitives:
`card`, `rounded`, `pill`, `circle`, `diamond`, `parallelogram`, `operator`, `caption`,
`list`, `section`, `table`, `switch`, `timeline`, `artifact`, `agent`, or `approval`.

## Add a genuinely new visual grammar

Only when no primitive expresses the shape:

1. Add its literal to `NodeVisual` in `frontend/types.ts`.
2. Add the catalog row in `frontend/model/node-types.ts`.
3. Style `.node-visual-<visual>` in `frontend/styles.css`.
4. Add a render assertion beside the node catalog tests.

The generic node renderer already writes `data-node-visual` and the matching class.
It should not gain a type-specific branch.

## Build a graph-native run report

The `Autonomous systems` collection demonstrates the reusable vocabulary:

| Type | Intended signal |
|---|---|
| `agent` | worker identity, role, state, current action |
| `timeline-step` | duration, phase, wait, retry iteration |
| `data-table` | verification, budgets, metrics |
| `toggle` | visible run/report mode or display choice |
| `artifact` | Markdown/code/report output and lineage |
| `approval-gate` | human decision, scope, unblock action |

Open the guide and choose **Autonomous systems · Run report**, or load
`?demo=agent-observability`. The example includes parallel agents, handoffs, an artifact,
a retry loop, a metrics table, a raw-reasoning display switch, and an approval gate.

## Deterministic gates

Run:

```bash
npx vitest run tests/commands/principles.test.ts tests/commands/palette.test.ts tests/commands/demo-presets.test.ts
npm run typecheck
```

These fail on duplicate/invalid catalog entries, unknown visual primitives, multiple
new-node default owners, peer-system runtime-state imports, missing palette reachability,
wrong default geometry, or an incomplete observability preset.
