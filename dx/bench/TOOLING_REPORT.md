# Tooling performance review

Validated 2026-07-28 on macOS x86_64, 16 logical CPUs, Node v23.7.0.
Source review: `../tmp/ecs-canvas-graph/dx/bench/tooling/REPORT.md` plus its raw
experiment files. Timings below are wall-clock results from this checkout.

## Accepted changes

| Gate | Before | Dev lane | Release lane |
|---|---:|---:|---:|
| TypeScript | `tsc` | `tsgo` | `tsc` |
| Vitest commands | 25.13s | 5.51s, 23 tests | 25.13s, 394 tests |
| Vitest coverage | 37.38s | 7.04s, critical paths | 35.54s, all sources |
| Playwright | 42.7s | 5.72s, 8 checks | 43.12s, 100 checks |

Every local feedback gate is below 8 seconds. Release keeps the exhaustive
tests and stable TypeScript compiler; it is intentionally slower.

- Removed coverage's `--maxWorkers=2` cap.
- Added `@typescript/native-preview` for the local `typecheck` command. The
  release gate explicitly runs stable `tsc` through `typecheck:release`.
- Split unit, coverage, and browser scripts into representative local lanes and
  exhaustive `:full` lanes. `release:check` only calls the exhaustive lanes.
  Fast coverage retains the same 80% thresholds over the event, model, and
  render core (85.61% statements, 83.70% functions, 88.95% lines). Release
  coverage still measures every source, including persistence and telemetry.
- Disabled Vitest module isolation after adding explicit app lifecycle teardown.
  Every boot now tracks its registry and runtime listener; `afterEach` stops all
  entries in reverse order, clears the DOM, clears storage, and restores mocks.
  Multiple boots inside one test remain supported for persistence and overhead
  comparisons.
- Raised local Playwright workers from 2 to 4. CI stays at 1 because hosted CPU
  contention remains less predictable.
- Replaced three fixed Playwright sleeps with frame-loop or persistence events.
- Fixed command-picker focus restoration exposed by 4-worker contention. Nested
  click targets normalize to their focusable command owner; restoration survives
  delayed render replacement and falls back to a stable top control.

## Rejected experiments

- `happy-dom`, `vmThreads`: failures or no repeatable speedup.
- More than 4 Playwright workers: no throughput gain; increases timing pressure.
- Production preview server: measured 53.2s at 4 workers and lost to the focused
  Vite frontend server, so it was reverted.
- Experimental harness and raw JSONL output: useful investigation artifacts, but
  they encode stale worker caps and snapshot-specific broken-bin workarounds. Not
  copied into the maintained tree.

## Verification

- `npm run typecheck` (`tsgo`) and `npm run typecheck:release` (`tsc`).
- `npm run test:commands`: 6 files, 23 tests passed in 5.51s wall.
- `npm run test:commands:coverage`: 6 files, 23 tests passed; thresholds passed
  in 7.04s wall.
- `npm run test:browser`: 8 tagged smoke checks passed in 5.72s wall.
- `npm run test:commands:coverage:full`: 58 files passed, 1 skipped; 387 tests
  passed, 7 skipped; all-source thresholds passed in 35.54s wall.
- `npm run test:browser:full`: 98 passed, 2 skipped in 43.12s wall.
- Focus race stress: 20/20 passes with 4 Playwright workers.
