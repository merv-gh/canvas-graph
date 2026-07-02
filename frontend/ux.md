# ux.md — UX manifest

Goal: make the editor **calmer, touch-native, and presentable**. Every change is
observable (snapshot field), reversible, and reachable by both keyboard and touch.

North star: the canvas is the product. Chrome earns its pixels or it goes.

---

## 1. Remove outline + event log

**Why:** left pane split attention from the canvas; the event log is a dev
surface, not a user one. Both are dead weight for a *reader/presenter*.

**How:** unregister `outline` + `log` from `systems/index.ts`. Files stay (type
augmentations, revival). Snapshot `ui.outline.*` reads still resolve to 0 — no
test breaks; they just report "not shown".

**Observable:** `ui.outline.rows === 0`, no `.log` panel in `left`.

---

## 2. Gestures: two-finger = move, one-finger drag = rectangle select

**Why:** touch/trackpad users expect two-finger to pan (like every map). A bare
click-drag on empty canvas should *select a region*, the single most-requested
missing gesture. This makes multi-select discoverable without a modifier key.

**Model (pointer count is the switch):**
- **Pan** starts only when the gesture is "move-intent": second touch pointer
  down, OR middle-button, OR space-held, OR (desktop convenience) a modifier.
  Trackpad two-finger scroll already routes through `wheel` → keep pan-by-wheel.
- **Rectangle select** starts on a *single primary pointer down on empty stage*.
  Drag paints a rubber-band; on up, choose every node whose rect intersects the
  band. Shift = add to set; plain = replace. A click with no drag (< 4px) clears
  selection (existing background-cancel behavior).

**Fluidity:** rubber-band is a screen-space div (no graph rerender); selection
commits once on pointer-up. rAF-free — it's cheap.

**Observable:** `ui.select.marquee` (bool, band visible), `selection.count`
after commit. New events `select.box.start/move/end`.

**Edge cases:** a pointer that started on a node → item drag (unchanged, it has
`stop:true` and fires first). Two-finger during a marquee → cancel marquee,
begin pan (move-intent wins). Escape cancels an in-progress band.

---

## 3. `select.all` command

**Why:** parity/discoverability — `select.all` is the name people search in the
palette; today only `choose.all` exists.

**How:** register `select.all` with `event: 'choose.all'` (alias, hidden from
duplicating the button, but palette-visible). No new behavior.

**Observable:** `ctx.contexts.commands.get('select.all')` exists; running it →
`selection.count === nodes`.

---

## 4. Layouts account for label sizes

**Why:** multi-line edge labels sit at edge midpoints; today spacing is derived
from node sizes only, so a tall label lands *under* the next node. Layouts must
budget vertical room for the labels an edge carries.

**How:** compute a per-scope `labelPad` = max over edges of
`(lineCount * lineH)` and widen `GAP_Y` (tidy) / `rowSize` (grid) / ring radius
(radial) by it. Cheap, deterministic, keeps "no overlap" promise for labels too.

**Observable:** after `layout.apply.tidy` on a graph with a 3-line label, the two
levels it connects are ≥ label-height apart (Playwright geometry / snapshot
Positions).

---

## 5. Edge labels sit to the right of edge direction

**Why:** centered-on-line labels collide with the line and with each other on
bidirectional pairs. Offsetting to the **right of the travel direction**
(consistent side) declutters, and mirrors road-sign / flow convention.

**How:** in the edge renderer, after computing mid + direction `d=(to-from)`,
offset the label block by the right-normal `n=(dy,-dx)/|d|` times a constant
(~ half label height + 6). Right-normal in screen coords (y-down) = `(-dy, dx)`
— pick the sign that lands on the visual right of the arrow and keep it uniform.

**Observable:** label `tspan` x/y are offset from midpoint by the normal; unit
test asserts offset sign matches direction.

---

## 6. DX warns on edge ↔ label intersections

**Why:** the app's contract is "bugs are observable". A label overlapping a
*different* edge is a layout smell the DX validator should surface, not the eye.

**How:** in `runDx`, for the current graph, build each visible edge's segment and
each label's rect (mid + offset + measured line box), warn when a label rect
crosses a non-owning edge segment. Bounded: O(edges·labels), skip when > N edges
(perf guard). Rule id `layout.label-overlap`.

**Observable:** `ctx.contexts.dx.run()` includes a `warn` with rule
`layout.label-overlap` on a crafted overlap; none on a clean graph.

---

## 7. Framed presentation mode (headline)

**Why:** the editor is where you *write* a graph; presentation mode is where you
*walk someone through it* — on a phone, in a meeting, full-screen. A big graph is
illegible zoomed-out and disorienting zoomed-in. The fix is a **lens**: show one
focus node and its immediate neighborhood in a fixed, readable frame, and *move*
through the graph one hop at a time with fluid transitions.

**Entering:** command `present.toggle` (`p`), top button "▣". On enter:
- reuse zen darkening (`shell.zen`) + set `shell.dataset.present="true"`.
- mount a **frame overlay**: a centered rounded rectangle with small paddings
  over a darkened backdrop. Mobile-friendly: frame is `min(...)`-sized, controls
  are large touch targets, layout reflows under 640px.

**The lens (what's inside the frame):**
- **Center cell** = focus node (selected node, else first). Big card: title +
  (toggle) description.
- **Directional neighbors:** partition edges incident to focus into 4 buckets by
  the real geometric direction to the neighbor (up/down/left/right). Each side
  shows **up to 3** neighbor cards at fixed slots (a 3×3 compass feel), *regardless
  of their real distance on the big canvas* — this is a synthesized local view,
  not a camera crop. If a side has > 3, append an **ellipsis chip ("+N")**.
- Connector lines from center to each shown neighbor, arrow following real edge
  direction (in→out).

**Toggle — node text vs edge labels:** a switch flips the frame between
- *nodes* mode (default): neighbor cards show node title/description; edge labels
  hidden.
- *edges* mode: connectors show their edge label; node cards shrink to titles.
Edge labels are **off by default** (nodes mode).

**Movement (fluid):**
- On-frame buttons ◀ ▲ ▼ ▶ move focus to the nearest neighbor in that direction;
  center dot / Esc exits. Clicking any neighbor card focuses it. Each move
  **cross-fades** the frame (opacity+slight translate, 180ms) — the "fluid"
  requirement — and *also* gently fits the real canvas behind the frame to the
  new focus (so exiting present mode leaves you where you navigated to:
  "selective fit-to-view with fluid movements").
- Keyboard arrows drive the same moves while present.

**Observable (snapshot `ui.present`):** `active`, `focusId`, `mode`
('nodes'|'edges'), `up/down/left/right` neighbor counts, `overflow` bools.
Reads off `shell.dataset.present*` + `.present-frame` DOM so jsdom sees it.

**Reversibility:** `p`/Esc/close button exits; restores prior zen state.

---

## Cross-cutting principles applied
- Every new capability = a command on `window.app` (palette + touch button).
- Every new visual fact = a snapshot leaf (else it can't be tested/auto-fixed).
- Mutations stay events; presentation focus is presentation state (a store/flag),
  never graph data.
- Nothing added to `ctx.contexts` (budget 14); present mode is a plain system.

## Revision 2 — presentation as a real sub-graph + gesture bug fixes

Follow-up feedback reshaped presentation mode and surfaced two gesture bugs.

**Presentation is now a rendered sub-graph in the modal, not ad-hoc cards.**
- The lens draws a genuine sub-graph with the model's *own* node/edge renderers
  (`model.entity('node'|'edge').render.draw`) over a positioned item set — real
  cards, real edges/arrows/labels, a gridded background, no panels. It's a core
  use of the graph renderer, not a bespoke widget.
- It mounts in the **modal** (`modal.open`, `visual:'present'`). The modal chrome
  is built once; navigation swaps only the inner `.present-substage` layer
  (`replaceChildren` + a fade) → **no flicker** (the frame never re-mounts).
- **Navigation never moves the main canvas.** Hopping between focus nodes only
  re-renders the lens. So Escape/Close leaves the real view exactly as it was.
- **"Open in canvas"** is the one bridge out: it selects + focuses + fits the
  current node on the main canvas, then exits — an explicit jump, not a side
  effect of browsing.
- Nav buttons ◀▲▼▶ are a fluent hop to the nearest neighbour on that side; the
  lens cross-fades. Content toggle (node text ⟷ edge labels) unchanged; labels
  off by default. Ellipsis "+N" for crowded sides. Observable via
  `shell[data-present*]` dataset (jsdom-safe, no layout needed).

**Bug — pan breaks moving two fingers same direction.** Two touch pointers both
emit `pointermove`; responding to both made the view jump between their
positions. Fix: pin the pan to the pointer that started it (`panPointerId`) and
drop moves/ups from any other finger. ([systems/view-pan.ts](systems/view-pan.ts))

**Bug — edge labels dance on zoom.** The label glyph was sized in CSS `px`
(screen-fixed) while its perpendicular offset is in graph units (scales with
zoom), so the gap between label and line grew/shrank as you zoomed. Fix: move the
font size to an SVG `font-size` attribute in *user units* so glyph + offset sit
in the same coordinate space as the geometry they annotate — they co-scale and
the label stays glued to its edge. ([model/entities.ts](model/entities.ts), styles.css)

## Revision 3 — fit/layout/pan/label fixes

- **Fit skewed right.** The empty left place still occupied a fixed 260px, so
  fit-to-view reserved a phantom panel. `.left:empty { display:none }` collapses
  it → fit centers exactly (verified bbox-center == stage-center, dx 0).
- **Layouts didn't fit and walked away.** User layout commands now route through a
  `layout.fit` event = apply + `view.fit.all`, so every Tidy/Grid/Radial re-frames
  the graph centered. The bare `layout.apply.*` events stay fit-free, so the
  autoLayout-on-create feature (which tidies on every node add) doesn't yank the
  camera. ([systems/layout.ts](systems/layout.ts))
- **tidy→radial→tidy not idempotent.** Layout shape is deterministic and fit
  re-centers each time, so the sequence lands on the same framed result as a lone
  Tidy (verified: normalized positions identical).
- **Pan broken (zoom worked, pan didn't).** Trackpad two-finger scroll arrives as
  `wheel`, which only zoomed. Now plain wheel **pans** (x/y by delta) and pinch
  (ctrl+wheel) **zooms** — the map/Figma model. Touch two-finger pan (pointer
  path) already fixed in Rev 2. ([systems/view-pan.ts](systems/view-pan.ts), view-zoom.ts)
- **Edge labels legibility.** Each label now has an opaque backdrop `<rect>`, and
  the text is appended after both the edge line and the backdrop, so within its
  own edge the label always paints on top with a clean background where it crosses
  the line. ([model/entities.ts](model/entities.ts), styles.css)

## Second-thought revisions (review pass)
1. **Rect-select vs pan ambiguity on desktop with no touch:** originally "drag =
   select, always". But users with no second finger still need to pan. Resolution:
   keep wheel-pan (already primary on trackpad), add **space-drag** and
   **middle-drag** pan, and a Pan/Select toggle is *not* needed — wheel covers it.
   Documented in §2.
2. **Presentation "3×3 grid at predefined places even if far":** confirmed this
   means a *synthesized* lens, not a camera fit — otherwise far neighbors would be
   off-frame. Camera still gently follows underneath for continuity on exit. Kept.
3. **Edge-label-right offset could push labels off-screen for near-vertical
   edges:** clamp offset to a constant and keep it small (½ label height); it's a
   nudge, not a relocation. Kept small.
4. **DX overlap check cost on the 25k-edge demo:** guard with an edge-count cap so
   the validator stays sub-frame. Added to §6.
