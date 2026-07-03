# ecs-canvas-graph

The app is **`frontend/`** Read `frontend/CLAUDE.md` before touching it; `README.md` is the project hub + automation/DX guide.

- `frontend/` — TypeScript event-driven graph editor (systems/abilities/features plugins).
- `dx/` — local-model TDD loop + app-aware tooling (`node dx/cli/apptool.mjs` for
  commands/events/flows/scenario/graph queries — see `dx/README.md`).

## Commands

```bash
npm run dev                    # app at http://127.0.0.1:5174 (alias: dev:frontend)
npx vitest run                 # fast jsdom suite (tests/commands/, ~545 tests, <60s)
npx vitest run -t "<name>"     # one test by name — prefer this while iterating
npm run test:commands:coverage # + frontend-only V8 coverage (80% line/stmt/func gates)
npm run typecheck              # tsc --noEmit
npm run test:browser           # Playwright (slow; layout/screenshots only)
```

## Rules of engagement

- Verify with `npx vitest run` + `npm run typecheck` before claiming done. The DX validator
  runs inside boots — a contract violation throws in tests; you don't need to eyeball it.
- Tests live in `tests/commands/` (jsdom, command-driven; see its README for the 4-helper
  testkit). UI-regression repros go in `tests/commands/recorded/` — generated from in-app
  recordings, keep that style.
- `tests/commands/principles.test.ts` enforces architecture (core ≤400 lines,
  ≤14 contexts, no `document.querySelector` outside render files, one-system-off boots).
  If it fails, fix your design, not the test.
