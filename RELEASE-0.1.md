# Release 0.1 readiness

## Release target

Version 0.1 is a focused graph-drawing and graph-writing application. Ship two
artifacts from one tagged commit:

- `frontend/dist/` — static web application, built with `npm run build`.
- `dist-lib/graph-viewer.js` — embeddable IIFE library, built with
  `npm run build:lib`.

The package remains `private`; npm-registry publication is outside the 0.1
scope. Quest, workflow, word-map, and math-story experiments are preserved on
the `codex/noncore-quest-learning-archive` branch and are not release inputs.

## Current evidence

- TypeScript typecheck: passing.
- Command suite with V8 coverage: 194 passing, 1 skipped; 80% statement,
  function, and line gates pass.
- Production app build: passing; about 207 kB JavaScript (66 kB gzip) and 39 kB
  CSS (8 kB gzip) at the time of this audit.
- Library build: passing; about 482 kB JavaScript (127 kB gzip), unminified.
- Dependency audit: zero known vulnerabilities at moderate severity or higher.
- DX/CLI self-test: 42 checks passing.
- Browser suite: 24 passing, 2 intentionally skipped.
- Complete `release:check`: passing on the audited release-preparation tree.

## Strengths

- The typed event bus and command registry make behavior observable, replayable,
  and easy to drive without brittle DOM automation.
- Features, systems, and abilities have explicit boundaries and can be toggled
  independently; architecture rules run as tests.
- Local persistence, import/export, sharing, nested graphs, keyboard navigation,
  and large-graph rendering already form a coherent graph-editor product.
- Fast jsdom tests, browser layout tests, coverage gates, snapshots, scenarios,
  and local-model tooling provide unusually strong diagnosis and regression paths.
- The static build is small enough for inexpensive hosting and has no runtime
  server dependency.

## Weaknesses and release risks

- `system-design.ts`, `containers.ts`, and `debug.ts` are large concentration
  points despite the otherwise modular architecture. Refactor after 0.1 behind
  behavior-preserving tests; do not block the release solely on line count.
- The library build is unminified and materially larger than the app bundle.
  Document this for embedders; add minified and source-map variants in 0.2.
- Browser coverage is Chromium-only. Safari/WebKit and Firefox compatibility are
  not release claims for 0.1.
- Several low-level files are excluded from coverage thresholds. Their risks are
  partly covered through integration tests, but exclusions should be reviewed.
- Performance assertions are sensitive to CPU contention. Release verification
  must run without development watchers or unrelated heavy processes.
- Product documentation is still weighted toward contributor/DX internals.
  A short end-user interaction guide and hosted demo should follow before broad promotion.

## Release blockers requiring an owner decision

- Choose and add a license before distributing source or artifacts publicly.
- Choose the hosting/release destination and canonical public URL.
- Decide whether 0.1 promises only Chromium or expands the browser matrix.
- Confirm the product name and visual identity; the current name is technical.

## Release checklist

1. Resolve the owner decisions above and update README metadata.
2. Run `npm ci` from a clean checkout using Node 20.19, Node 22.12+, or Node 24+.
3. Run `npm run release:check`; retain Playwright failure artifacts if it fails.
4. Smoke-test create, edit, connect, nest, reload, export, import, and share in
   the supported browser.
5. Inspect `frontend/dist/` and `dist-lib/graph-viewer.js`; deploy the static app
   to a staging URL and test relative asset paths.
6. Replace `Unreleased` for 0.1.0 in `CHANGELOG.md` with the release date.
7. Commit generated artifacts if they are part of distribution, tag `v0.1.0`,
   and publish checksums with the release files.

## Post-0.1 plan

1. Split the largest systems along existing event ownership boundaries.
2. Add storage schema versioning, migrations, and recovery UX.
3. Add Firefox/WebKit CI after compatibility issues are catalogued.
4. Produce minified and source-mapped library variants with a documented API.
5. Add accessibility review, keyboard reference, and end-user onboarding.
6. Turn performance baselines into platform-aware reports rather than relying
   only on fixed wall-clock thresholds.
