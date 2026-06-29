# TODO (mine) — graph perf/UX follow-ups

Branch `perf/graph-scale` is merged to `main` (indices + patch renderer + grid cull +
z-layering). Evidence: `dx/bench/COMPARISON.md`, `dx/bench/OPTIMIZATION_PLAN.md`.

## 1. PRIORITY — fluid movement (nudge + drag feels like stepped teleport)

User report: arrow-key nudge and fast mouse-drag aren't fluid — node "teleports and
stops", visible latency between steps. Wants easing/interpolation.

Diagnosis so far (browser-probed self-map): a node move recreates **only the moved
element** (correct, patch works), 0 animation restarts. So it's NOT a rebuild problem —
it's that movement is **discrete with no tween**:
- **Nudge** = `item.nudge` → +24px `Position` patch → element jumps 24px instantly. No
  easing → stepped.
- **Drag** = each `pointermove` → `item.update` Position → `patchOne` does
  `renderer.draw()` + `replaceWith` → a **brand-new element each frame**, so any CSS
  transition has no previous state to ease from → teleport per frame. Also wasteful.

### Plan
1. **In-place position fast path (enables everything else).** In `render-stage.ts`
   `patchOne`, when the only change is Position, DON'T `replaceWith` a fresh element —
   move the existing one. Options:
   - Add an optional `reposition(el, item)` hook to the entity renderer
     (`EntityDef.render`); node renderer implements it as a transform/left-top update.
     `patchOne` calls it when present and the element exists; falls back to full redraw
     otherwise. Keeps render-stage kind-agnostic.
   - Detect "position-only" by diffing against a cached per-id snapshot, or just always
     try `reposition` for `*.updated` facts and let kinds opt in.
2. **Easing.** Once the element persists across moves, add
   `transition: transform var(--duration-fast) var(--ease-default)` to `.node` (or only
   while a `.nudging` class is present) so the 24px nudge glides. Drag should NOT ease
   (must track pointer 1:1) — gate easing to keyboard nudge only, e.g. nudge adds a
   transient class, drag doesn't.
3. **Latency.** Confirm input→paint is one rAF (coalesced). If drag feels laggy after (1),
   check we're not double-scheduling. Measure in a *foreground* browser tab — preview/
   headless throttles rAF to ~2s/frame, so timing there is meaningless (recreation counts
   are still valid).

Verify visually in the real app (`npm run dev`), not jsdom. Keep 908 green.

## 2. Selection triggers a full stage rebuild
`selection.changed` carries a ref *set*, so the scheduler can't localize it →
`fullNodes=true` → full rebuild on every select. Fine at viewport scale, wasteful for big
selections. Fix: patch only the refs whose selected-decoration changed (diff previous vs
new selected set; re-draw just those). Touches `render.ts` (extract refs from
`selection.changed.refs`) + `render-stage` patch path.

## 3. Bench gate is over-conservative at 10k for move/select+delete
They show `🚫` (projected) but are now patch-bound and would likely run. Relax
`GATE_MS`/projection in `tests/bench/harness.ts` for those two, or special-case, and get
real 10k/100k numbers for `move-multiple` and `select+delete`. Consider a batched-removal
fast path for delete (currently one element removed per fact).

## 4. Playwright paint pass
`npm run test:browser` for real layout/paint regression (I verified via DOM probes, not
paint). Add a perf-ish screenshot/interaction check for the self-map.

## 5. WebGPU backend (future ceiling)
DOM ceiling now ≈ visible-element count. For whole-CPG zoom-out across 100k+, swap
`render.stage` (already swappable) for a canvas/WebGPU painter; keep model+indices+cull+
patch. See OPTIMIZATION_PLAN.md §Phase 5.

## Housekeeping
- `dx/bench/runs/*` and `snapbench.sh` worktrees: per-phase artifacts committed. Prune
  stale worktrees with `git worktree prune` if any linger.
- `handoff.md` covers the fit-to-view small stuff for a smaller model.
