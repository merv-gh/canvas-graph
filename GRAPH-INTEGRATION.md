# file-projections → ecs-canvas-graph integration

Render **file-projections** (the Go "joern-varflow" analyzer) program graphs —
service graphs, entrypoint maps, cross-repo CPGs, control flows — inside this
canvas as a **read-only viewer**. Two goals:

1. **Benchmark** — this app becomes a real graph-rendering benchmark, fed by
   file-projections' real cross-repo analysis output.
2. **Performant graph app** — drive layout/render toward large graphs.

Status: **working end-to-end** — small real graph, styled, big graph (627n/1132e),
plus a packaged **library** embedded in file-projections' UI with interactive
click-to-jump and a split code|graph view. All reviewed in preview.

---

## Part 2 — embeddable library + file-projections UI integration

The viewer now ships as a drop-in library and is wired into file-projections'
own UI as an **Interactive graph** tab: graph on the left, source on the right,
click a node → the code pane opens its file and scrolls to the line.

### Library API (`frontend/lib.ts` → `dist-lib/graph-viewer.js`)

`npm run build:lib` bundles one self-contained IIFE (~440 KB) exposing
`window.GraphViewer`:

```js
const v = GraphViewer.createGraphViewer({
  target: '#mount',                 // element or selector; contents replaced
  onNodeClick: info => {...},        // { id, label, file, line, service, kind, effects, raw }
  onEdgeClick: info => {...},        // { id, from, to, kind, label, cross, source, target }
  onSelect:    info => {...},        // node | edge | null
});
v.load(graph, { layout: 'flow' });   // 'flow' = top-down (control-flow); default clusters by service
v.fit(); v.select(id); v.clear(); v.destroy();
```

Self-contained: injects its own CSS and DOM templates. Two things make it safe
to embed in a host page:

- **Mount indirection** (`core/mount.ts`): the renderer resolves a settable root
  instead of a hard-coded `#app`. One viewer per page (global root).
- **Scoped styles** (`scopeCss` in `lib.ts`): the injected stylesheet is rewritten
  under `.graph-viewer-host` — `html`/`body` page rules dropped, `:root`/`.varflow`
  remapped to the scope, everything else prefixed. **Without this the app's global
  `body`/`*`/`button` rules wrecked the host UI.**

### file-projections side

- `tools/update-graph-lib.sh` (gitignored — machine-specific path): builds the lib
  and copies `graph-viewer.js` into `src/ui/`, where `go:embed` serves it. The
  vendored `src/ui/graph-viewer.js` **is** committed so the binary always builds;
  the script is the local dev convenience. Future: swap for `npm i`.
- `src/ui/igraph.js` + `#igpane` (index.html) + CSS (app.css): the Interactive tab.
- **Control-flow graph**: `AnalyzeControlFlow` now also emits a `graph` fact — the
  branch paths merged into a CFG (nodes keyed by source line, guard out-edges
  labelled true/false). `/api/graph` is generalized to serve any graph-emitting
  lens (`service-graph` | `control-flow`) and returns `kind`.
- **Code pane**: `/api/source?root=&file=` returns file lines; the click handler
  highlights + scrolls to the node's line.

### Verified in preview

- Host UI unchanged (no style leak).
- Service graph: 10n/9e, clustered, cross-repo `DI→RealPaymentService` seam.
- Control-flow (`shop-checkout-paths`): renders **top-down** (entry → guards with
  true/false edges → sink); clicking `channel.equals("web")` opened
  `OrderController.java` and highlighted line 32.

### Honest UX assessment

**Good / intuitive:**
- Click-to-jump is immediate and obvious; the highlighted line + auto-scroll reads
  clearly. Split layout is the right mental model (structure ↔ source).
- Control-flow in `flow` layout is genuinely readable — true/false labels make the
  branch logic legible without opening the file.
- Design matches the host (paper theme), so it doesn't feel bolted on.

**Rough edges (not blockers):**
- **Edge labels overlap the edge line** at some zooms (`fa|se`) — needs a label
  background/offset.
- **Fit leaves slack** — the graph uses ~60% of the pane; fit could zoom tighter.
- **First-open depends on the pane having size** — handled with a `whenSized` gate
  in `igraph.js` (the viewer must not boot into a 0px container or it never builds
  its node layer). Works in a real browser; in the headless preview the viewport
  is 0 until a screenshot forces layout.
- **Service-graph click-to-jump is best-effort** — cross-repo nodes are relative to
  their service root, not the single `source_root`, so some files won't resolve.
  Control-flow (single file) always resolves.
- **Code pane doesn't wrap** long lines (horizontal scroll only); no syntax colour.
- Edge click is wired (`onEdgeClick`) but the UI does nothing with it yet.

**Verdict:** the core promise — *self-sufficient file-projections with interactive,
click-through graphs* — is met and usable. The remaining items are polish.

## How to run

```bash
npm run dev:frontend            # or the "ecs-graph" launch config (vite :5180)
# then open one of:
#   /?varflow=sample:entrypoints              embedded demo, no backend
#   /?varflow=/graphs/shop-cross-repo.json    real shop cross-repo graph
#   /?varflow=/graphs/big-synthetic.json      627-node stress graph
#   /?varflow=<url>&lens=<name>               live file-projections server
```

`?varflow` present ⇒ `body.varflow` viewer theme (paper palette + editor chrome
hidden). Add `&io=memory` to skip localStorage.

## Architecture

One self-contained system: [`frontend/systems/varflow.ts`](frontend/systems/varflow.ts).
Nothing else in the editor changed except the registration line and a scoped CSS
block. The plug-in points already existed:

| ecs hook | used for |
|---|---|
| `graph.import.snapshot` event | load a `GraphSnapshot` (same path the built-in demos use) |
| `view.fit.all` event | frame the graph after import |
| `body.varflow` CSS scope | viewer theme + hide editor chrome, editor untouched otherwise |

Flow: `?varflow` → fetch/sample → `sgGraphToSnapshot` (map + **layout**) →
`graph.import.snapshot` → `view.fit.all`.

## Data contract

file-projections `/api/graph` (and every `service-graph` projection) emits
`sgGraph` (see file-projections `src/servicegraph.go`):

```jsonc
{ "services": [{ "name", "root", "lang" }],
  "nodes":    [{ "id", "label", "service", "lang", "kind", "file", "line", "op", "method", "effects" }],
  "edges":    [{ "from", "to", "kind", "label", "cross" }] }
```

The adapter also accepts the server's `{ lens, graph, ... }` wrapper (unwraps `.graph`).

### Node mapping (`kind` + `effects` → `NodeType`)

| file-projections | canvas `NodeType` | why |
|---|---|---|
| `effects` has `db` | `database` | a file that hits a DB **reads as** a DB (wins over kind) |
| `kind: entrypoint` | `gateway` | HTTP/route entry surface |
| `kind: router` | `service` | registers routes |
| `kind: file` + `network` fx | `service` | calls out |
| `kind: file` + io fx | `index` | reads/writes storage |
| `kind: file` (plain) | `square` | leaf module |

Label = `label ‖ method ‖ id`. Description = `svc · file:line · fx: …`.

### Edge mapping (`kind` + `cross` → `EdgeKind`)

| file-projections | canvas `EdgeKind` | render |
|---|---|---|
| `api-call`, or any `cross` | `async` | dashed |
| `import`, `registers` | `sync` | solid |

## Layout (the important bit)

sgGraph nodes arrive **position-less**. The generic `tidy` layout lays every
in-degree-zero root on one row, so a 45-service graph spreads ~50k px wide and
cross-service edges fling outliers — `fit` then frames the outliers and the dense
middle renders **off-screen (blank canvas)**.

Fix: `assignPositions` computes a **bounded, service-clustered** layout up front —
cluster by `service`, grid each cluster (router→entrypoint→file order),
shelf-pack the clusters (`ROW_TARGET ≈ 5200px`). Nodes ship with positions;
import + `fit` just works. Verified: 627n/1132e frames cleanly; zoom-in is fully
readable (type kickers, `svc·file:line·fx`, labeled edges).

## Benchmark assets

`frontend/public/graphs/`:
- `shop-cross-repo.json` — **real** file-projections output (shop-app + billing-lib,
  10n/9e, 3 cross-repo edges incl. the `DI→RealPaymentService` seam).
- `big-synthetic.json` — 627n/1132e, 45 services, realistic sgGraph topology.

Regenerate the real one from file-projections repo:
```bash
./file-projections -config config.json      # writes .projections/shop-service-graph.projection
grep service-graph.graph: .projections/shop-service-graph.projection | sed 's/^.*graph: //' \
  > <ecs>/frontend/public/graphs/shop-cross-repo.json
```

## Caveats

- **No camera-side culling.** All nodes stay in the DOM regardless of zoom (the
  spatial grid prunes only on structural redraw, not pan/zoom). Fine at 627; a
  5k+ graph will bloat the DOM. TODO: viewport-cull on camera move, or virtualize.
- **Overview is a hairball.** Cross-service `api-call` edges cross freely at the
  bird's-eye. Reading mode = zoom into a cluster. TODO: edge bundling / fade
  cross edges until a cluster is focused.
- **Straight edges.** No orthogonal/curved routing → crossings. Cosmetic.
- **Real *large* graph is synthetic-topology.** The real sample is small (fixtures);
  the big one is generated in the real wire shape. TODO: wire a genuinely large
  real graph — Java `service-graph` over petclinic currently resolves 0 files
  (needs `src/main/java` root handling); Go call-graph has a different wire shape
  (`Caller/Callee`, no `from/to`) and needs its own adapter branch.
- **CORS for live server.** `?varflow=<abs-url>` to a running Go server (`:7777`)
  is cross-origin. TODO: Vite `server.proxy` or a CORS header on file-projections
  `/api/graph`. The static `public/graphs/*.json` path avoids this today.

## TODO (next)

- [ ] Camera-side viewport culling / virtualization for 5k+ nodes.
- [ ] Control-flow + Go call-graph adapters (`analyzer: control-flow` / callgraph shape).
- [ ] Live-server mode (Vite proxy) + a graph/lens picker in the viewer.
- [ ] Optional per-service containers (would let the built-in scoped layout pack clusters).
- [ ] Fade/bundle cross-service edges until a cluster is focused.
