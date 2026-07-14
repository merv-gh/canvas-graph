# Release 0.1 readiness

## Release target

Version 0.1 is a focused graph-drawing and graph-writing application. Ship one
artifact from the tagged commit:

- `frontend/dist/` — static web application, built with `npm run build`.
The package remains `private`; npm-registry publication is outside the 0.1
scope. The experimental IIFE library is also outside 0.1. Quest, workflow,
word-map, and math-story experiments are preserved on
the `codex/noncore-quest-learning-archive` branch and are not release inputs.

## Current evidence

- TypeScript typecheck: passing.
- Command suite with V8 coverage: 197 passing, 1 skipped; 83.08% statements,
  82.44% functions, and 85.91% lines.
- Production app build: passing; about 210 kB JavaScript (67 kB gzip) and 43 kB
  CSS (9 kB gzip) at the time of this audit.
- Dependency audit: zero known vulnerabilities at moderate severity or higher.
- DX/CLI self-test: 42 checks passing.
- Browser suite: 26 passing, 2 intentionally skipped.
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

- The unused 996-line system-design subsystem is removed. Debug behavior is now
  below 400 lines after extracting its views; container behavior is down from
  702 to 558 lines after extracting entity/render/property policy. Container
  storage and interaction remain the largest concentration point.
- Browser coverage is Chromium-only. Safari/WebKit and Firefox compatibility are
  not release claims for 0.1.
- Several low-level files are excluded from coverage thresholds. Their risks are
  partly covered through integration tests, but exclusions should be reviewed.
- Performance assertions are sensitive to CPU contention. Release verification
  runs them without coverage instrumentation at their real budget, then gives
  the instrumented coverage pass explicit headroom. Avoid unrelated heavy processes.
- Contributor documentation remains more extensive than end-user documentation,
  though the first-visit guide and canonical hosted demos now cover the initial journey.

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
5. Inspect `frontend/dist/`; deploy the static app to a staging URL and test
   relative asset paths.
6. Replace `Unreleased` for 0.1.0 in `CHANGELOG.md` with the release date.
7. Tag `v0.1.0` and publish a checksum with the static release archive.

## Post-0.1 plan

1. Continue splitting container behavior along entity, storage, and interaction boundaries.
2. Add storage schema versioning, migrations, and recovery UX.
3. Add Firefox/WebKit CI after compatibility issues are catalogued.
4. Revisit the embeddable library with minified/source-mapped variants and a documented API.
5. Add accessibility review and expand the keyboard reference.
6. Turn performance baselines into platform-aware reports rather than relying
   only on fixed wall-clock thresholds.
