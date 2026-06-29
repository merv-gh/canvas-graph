# Handoff — small, well-scoped fixes

Context: the graph renderer was just optimized (indices + patch renderer + grid cull
+ z-layering, all on `main`). See `dx/bench/COMPARISON.md`. These are small follow-ups
that don't need that background. Verify each with `npx vitest run && npm run typecheck`
(all 908 tests pass today — keep it that way). Run the app: `npm run dev` → http://127.0.0.1:5174,
then click **★ Self** (top bar) to load the self-map test graph.

---

## 1. Demos don't frame on render (fit-to-view)

**Symptom:** clicking ★ Self / Java Map renders the graph as a thin band, not framed to
fill the stage. `view.fit.all` IS already emitted at the end of each demo handler
(`frontend/systems/demo.ts:144` self, `:183` java, `:212`, `:228`).

**Likely cause:** `view.fit.all` runs *synchronously* right after the nodes/containers are
created, before container layout has positioned children — so it fits stale/degenerate
bounds.

**Fix to try (smallest first):**
1. Defer the fit one frame: replace the trailing `emit('view.fit.all')` in each demo
   handler with `requestAnimationFrame(() => emit('view.fit.all'))`, OR move it behind a
   settle. Re-test ★ Self — the graph should fill the stage.
2. If still off, log `contexts.view.visibleRect(Places.Stage)` and the fit target bounds at
   fit time (in `systems/view-zoom.ts`, `on('view.fit.all')`, ~line 219) — confirm the
   stage rect is non-zero and bounds cover all nodes.

**Acceptance:** ★ Self loads with the whole graph centered and filling most of the stage.

---

## 2. (optional, if quick) other small polish

- **`view.fit.all` on graph switch/load.** Switching graphs (`graph.switched`) doesn't
  re-fit. If desired, emit a deferred `view.fit.all` from the demo/graph load path only
  (don't auto-fit on every user edit). Confirm with the recorded tests still green.
- **Node enter animation on first paint.** `.node { animation: node-enter … }`
  (`frontend/styles.css:550`) now only plays for genuinely new nodes (good). If a brief
  flash on first load of a big graph is annoying, gate it behind a class the renderer adds
  only for nodes created *after* initial load. Low priority.

Don't touch `frontend/model/graph.ts` or `frontend/systems/render-stage.ts` rendering
internals for these — they're not needed and are covered by my todo.
