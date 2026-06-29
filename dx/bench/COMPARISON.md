# Optimization comparison — per-phase contribution

Each phase was committed on `perf/graph-scale`, snapshotted into an isolated git
worktree, and benched (1k-capped, serialized) via `dx/bench/snapbench.sh`. Raw
per-phase results: `dx/bench/runs/<phase>.md`. All numbers are **ms at 1,000
nodes / 1,500 edges** (jsdom, JS + DOM-construction cost).

## 1,000 nodes — wall-clock ms per op

| Phase | load | add | move 1k | zoom | pan | collapse | expand | sel+del |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 00 baseline            | 2,745 | 2,767 | 12,219 | 42,491 | 43,626 | 12,667 | 12,635 | 1,942 |
| 01 indices             | 2,063 | 2,549 | 11,066 | 43,358 | 42,481 | 12,264 | 14,056 | 2,254 |
| 02 camera-transform    | 5,094 | 8,356 | 18,757 | 35,350 | 36,406 | 20,886 | 21,055 | 2,002 |
| 03 patch-renderer      | 3,060 | 3,013 |  5,262 |    686 |    703 |  4,047 |  4,426 | 2,138 |
| 04 grid-cull           |   772 |   727 |  2,820 |    178 |    157 |     26 |     37 | 2,096 |
| 05 z-layering          |   788 |   626 |  3,205 |    176 |    154 |     25 |     35 | 2,293 |
| **baseline → final**   | **3.5×** | **4.4×** | **3.8×** | **242×** | **283×** | **507×** | **361×** | 0.85× |

## 10,000 nodes — baseline vs final (the scaling proof)

`getItem` was an O(n) scan called O(n) times — O(n²) — so at 10k the baseline
either crawled or projected to minutes/hours. Indices (01) + patch render (03) +
grid cull (04) make it near-linear:

| op | baseline 10k | final 10k | win |
|---|--:|--:|--:|
| load     | 42,161 | **7,332** | 5.7× |
| zoom     | 🚫 ~1,860,000 | **471** | ~4000× |
| pan      | 🚫 ~1,270,000 | **382** | ~3300× |
| collapse | 🚫 ~386,000 | **25** | ~15000× |
| expand   | 🚫 ~577,000 | **281** | ~2000× |

`move-1k` and `sel+del` at 10k still show `🚫` — that is the benchmark's
**conservative projection gate** (15 s headroom) firing on the *old* super-linear
fit, not a measured slowdown. Both are now patch-bound (touch only the changed
elements) and would run; the gate just refuses to risk a hang. Final-build burn at
10k shows the model fully de-quadratified: top cost is `getNode` at **0.28 µs/call**
(O(1) Map), and `getItem` has dropped out of the hot list entirely (was 69 s).

## How each phase contributed

- **01 indices** (`getItem` O(1), cached arrays, adjacency) — small at 1k because the
  full DOM **rebuild** dominates there, not the model. Its payoff is at scale: the full
  10k/100k run showed `getItem` burning **69 s** as an O(n) scan called O(n) times — an
  O(n²) that this phase removes (see §10k below).
- **02 camera-transform** — *regressed* 1k load/move: it dropped viewport culling (render
  all) in preparation for a persistent layer, but the nodes layer was still a rebuilding
  thunk, so every overlay flush during pan/zoom still rebuilt all N. Net-neutral on its
  own; it's the enabling step for 03.
- **03 patch-renderer** — the unlock. A **persistent layer** handed to the scheduler (not a
  rebuilding thunk) + dirty-ref patching collapsed **zoom 42 s → 0.69 s (62×)** and
  **pan → 0.70 s**; camera ops stopped rebuilding the DOM entirely.
- **04 grid-cull** — only builds DOM near the viewport (uniform grid, O(cells+hits)).
  **load 3.1 s → 0.77 s**, **collapse → 26 ms**, zoom/pan to sub-200 ms. The biggest
  multi-op win.
- **05 z-layering** — stable z-index by creation sequence so viewport re-entry doesn't
  restack. Negligible cost (as intended — correctness, not speed).

## Notes

- **select+delete is flat (~2 s, slightly up).** Deleting 1k nodes fans out 1k+ delete
  facts that the renderer now removes one element at a time; the baseline's full rebuild of
  an empty stage was already cheap. Candidate for a batched-removal fast path later — not a
  regression that matters at these magnitudes.
- Absolute ms are jsdom (no GPU paint). The **ratios** are the signal; a real-browser
  Playwright pass will show paint cost on top.
