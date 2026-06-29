# Graph rendering — architecture review & optimization plan

Goal: show full, traceable CPG graphs spanning **hundreds of microservices** —
1 → 100 → 1k → 10k → 100k nodes with edge-dense (≈1.5×) topologies — in multiple
projections, interactively. Target: every op under a 120 s hard budget today, and
60 fps-class interaction once optimized.

Companion: `RESULTS.md` (live benchmark) · `COMPARISON.md` (per-phase deltas).

> **Status (branch `perf/graph-scale`):** Phases 1–5 (DOM track) **landed**. At 1k:
> zoom **242×**, pan **283×**, collapse **507×** faster; at 10k: load 42 s → **7.3 s**,
> zoom/pan from unrunnable → sub-0.5 s. Phase 5 (WebGPU) remains the future ceiling.
> Per-phase evidence in `COMPARISON.md`.

---

## 1. What the benchmark already proves

From `RESULTS.md` (jsdom, isolates **JS + DOM-construction** cost — no GPU paint):

| Nodes | load | zoom (5×) | pan (5×) | move 1k | collapse | select+delete |
|--:|--:|--:|--:|--:|--:|--:|
| 1 | 77 ms | 0.3 s | 0.3 s | — | 29 ms | 47 ms |
| 100 | 0.5 s | 1.4 s | 1.7 s | 0.6 s | 0.4 s | 67 ms |
| 1,000 | 3.1 s | **51 s** | **46 s** | 13.8 s | 12.9 s | 2.0 s |
| 10,000 | **42 s** | 🚫 ~31 min | 🚫 ~21 min | 🚫 ~5.5 min | 🚫 ~6 min | 🚫 ~1 min |
| 100,000 | 🚫 ~9.5 min | 🚫 ~19 hr | 🚫 ~10 hr | 🚫 — | 🚫 — | 🚫 — |

(`🚫` = projected by power-law from the measured sizes; not run because a single jsdom
redraw can't be interrupted. See `RESULTS.md` for the live, exact numbers.)

Three facts jump out:

1. **Camera ops (zoom/pan) cost as much as a full load.** Zooming a 1k-node graph
   takes 51 s for 5 steps (~10 s/frame). Absurd: pan/zoom change *nothing* about the
   graph — only the camera — yet they trigger a full N-element DOM rebuild.
2. **Everything is super-linear.** zoom 100→1k grows **36×** for a 10× node bump
   (≈ O(n^1.5)). 10k load is already 42 s; 100k can't even *load* (projected ~9.5 min).
3. **The model layer alone wastes ~125 s of the run.** The burn profile (below) shows
   `Graph.getItem` called **555k times for 69 s total** (124 µs/call — a linear scan that
   should be an O(1) Map hit), plus `itemsOfKind` 33 s and `nodes()` 22 s — all pure
   per-call allocation + scanning.

The current architecture cannot display 10k nodes interactively, and cannot display 100k
at all.

---

## 2. Root causes (ranked by blast radius)

### A. Every redraw rebuilds the entire DOM — including for camera-only changes
`systems/render.ts` `flush()` does `slot.replaceChildren()` then re-appends; `systems/
render-stage.ts` `drawItems()` reconstructs **every** node + edge element from scratch
on each `render.stage.draw`. The redraw scheduler (`bus.onAny → factScope`) coalesces
to one rAF (good) but each frame is a full teardown+rebuild of N elements.

Worse: `core/redraw.ts` maps any `.changed` fact to scope `'nodes'`, and pan/zoom emit
`view.changed`. So **panning/zooming triggers a full N-element DOM rebuild** even though
the layer already moves via a single CSS `transform` (`render-stage.ts:97`). This is the
single highest-ROI bug: the transform is all that's needed; the rebuild is pure waste.

### B. The model hands out fresh arrays and does linear scans
`model/graph.ts`:
- `itemsOfKind()` → `[...store()]` — a new array **every call**.
- `getItem(ref)` → `itemsOfKind(kind).find(...)` — **O(n) scan + allocation per lookup**,
  even though `nodes`/`edges` are already `Map`s with O(1) access. The burn profile shows
  `getItem` as the #1 hot path (hundreds of thousands of calls).
- `nodes()` / `edges()` → spread-copy the whole collection per call.
- `edgesOf(id)` → `edges().filter(...)` — O(E) per node; `deleteNode` scans all edges O(E).
  No `nodeId → incident edges` adjacency index.

These turn naturally-linear operations quadratic:
- `item.nudge` (move N selected) calls `getItem` per member → **O(k·n)** (`abilities/
  nudgeable.ts:59`).
- `select+delete` of all nodes → per-node `edgesOf` + cascade → **O(n·E)**.
- The hierarchy source (`systems/graph.ts:184`) rebuilds full node+edge arrays on every
  jump/outline/fit query.

### C. Culling is a linear scan with no spatial index
`render-stage.ts` calls `view.isVisible(bounds)` per item every frame, but only *after*
iterating all N items; there is no spatial structure, so cost is O(n) per frame
regardless of how few nodes are on screen. Hit-testing (pointer-select) likewise relies
on the full DOM existing.

---

## 3. Optimization sequence (correct order matters)

Principle: **fix the algorithm before the backend.** GPU rendering on top of an O(n²)
model is still O(n²). Eliminate rebuilds and quadratics first; only swap to WebGPU once
the DOM path saturates at its real ceiling (visible-element count, not total).

### Phase 1 — Model decoupling + indices *(cheap, no public API change, unblocks everything)*
Files: `model/graph.ts` (+ callers via `item.update` seam — already centralized).

1. `getItem` → direct `Map` lookup by kind+id (O(1)); delete the linear scan.
2. Stop per-call allocation: `itemsOfKind`/`nodes`/`edges` return a **cached array** with a
   version/dirty bump on mutation, or expose a readonly iterator. Callers that only iterate
   stop paying a copy.
3. Add adjacency index `nodeId → Set<edgeId>`, maintained in `createEdge`/`deleteEdge`/
   `updateEdge`. `edgesOf` → O(deg); `deleteNode` cascade → O(deg) not O(E).
4. Audit hot callers (`nudgeable`, `selectable`, hierarchy source, `boundsOfRef`) to use the
   O(1) accessors.

**Impact:** move-multiple, select+delete, hierarchy queries drop from quadratic to near-linear.
The top-3 burn rows (`getItem`, `itemsOfKind`, `nodes`) collapse.

### Phase 2 — Patch-driven renderer *(biggest single win for the DOM ceiling)*
Files: `systems/render.ts`, `systems/render-stage.ts`, `core/redraw.ts`.

1. **Split camera facts from entity facts.** A `view.changed` must update only the layer's
   CSS `transform` (and `--grid-*`), never rebuild elements. This alone makes pan/zoom O(1)
   (today: 44 s @ 1k → target sub-ms).
2. **Element reconciliation.** Keep an `itemId → HTMLElement` map per kind. On a fact, apply a
   delta instead of a teardown:
   - `*.updated` → mutate that one element's transform/attrs.
   - `*.created` → build + insert one element.
   - `*.deleted` → remove one element.
   Move = patch only the changed elements; add/delete = one element. No `replaceChildren`.
3. Keep `render.stage` swappable (it already is, per its header comment) so Phase 5 only
   replaces paint.

**Impact:** camera ops O(1); mutations ∝ changed elements; collapse/expand = visibility toggles.

### Phase 3 — Spatial index for culling + hit-testing *(R-tree / uniform grid)*
Files: `core/view.ts` (+ a new `core/spatial.ts`), `render-stage.ts`, `abilities/selectable.ts`.

1. Index node bounds in an **R-tree** (dynamic, good for clustered CPG layouts) or a **uniform
   grid** (simpler, great when layout is near-uniform). Maintain on create/move/delete.
2. Redraw queries `visibleRect` → builds/patches **only visible** nodes. Pan diffs entering/
   leaving viewport. Render cost becomes ∝ on-screen nodes, independent of total.
3. Pointer hit-testing queries the index instead of relying on full DOM / O(n) scan.

**Impact:** a 100k-node graph with ~200 visible nodes renders like a 200-node graph.

### Phase 4 — Z-order / layering *(z-tree)*
Stable draw-order layers (containers → edges → nodes → overlays) so z changes don't reflow;
maintain order incrementally instead of re-sorting per frame.

### Phase 5 — WebGPU/canvas backend *(only after the DOM path saturates)*
Once Phases 1–3 land, the DOM ceiling is the count of *visible* elements (~2–10k). Beyond
that (massive zoom-out showing the whole CPG):
- Swap `render.stage` for a WebGPU/canvas painter: instanced quads for nodes, batched lines
  for edges, SDF/atlas text for labels. Model, indices, culling, and the patch-delta stay.
- Picking via GPU id-buffer, or keep the Phase-3 R-tree for CPU hit-testing.

**Why last:** GPU only helps once per-element JS overhead and quadratic model work are gone.
Doing it earlier would paint an O(n²) model very fast — still O(n²).

---

## 4. Verification loop

- `npm run bench` after each phase; diff `RESULTS.md`. Each phase should move a column from
  `🚫`/`⚠️` to real, sub-budget numbers and let a larger size run.
- `npm run bench:burn` to confirm the targeted hot path collapsed.
- `npx vitest run && npm run typecheck` — correctness gate (the `item.update` seam keeps
  Phase 1 behavior-preserving; redraw conventions are enforced by `redraw-convention.test.ts`).
- Playwright pass (`npm run test:browser`) for real layout/paint once Phase 2+ lands.

## 5. Expected trajectory

| After | 100k load | 100k pan/zoom | 100k move-N | Backend |
|---|---|---|---|---|
| Today | 🚫 (days) | 🚫 | 🚫 | DOM, full rebuild |
| Phase 2 | minutes | **O(1)** | ∝ changed | DOM, patch |
| Phase 3 | ∝ visible | O(1) | ∝ changed | DOM, culled |
| Phase 5 | ∝ visible | O(1) | ∝ changed | WebGPU |
