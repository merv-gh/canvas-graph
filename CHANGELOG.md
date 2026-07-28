# Changelog

All notable changes to this project will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.0.1] - 2026-07-28

### Fixed

- Restored reproducible `npm ci` installs by refreshing transitive lockfile
  metadata and updated PostCSS to the patched advisory-free release.

## [2.0.0] - 2026-07-28

### Added

- Added privacy-preserving interaction telemetry with a worker-backed event
  pipeline, diagnostics portal, performance probes, and regression coverage.
- Added direct canvas manipulation for resizing, reconnecting edges, moving edge
  labels, and editing node descriptions in every supported placement.
- Added a dedicated Text tool, persistent future-node appearance controls, and
  quick Node, Container, and Text creation actions in the workspace rail.
- Restored graph creation beside graph search and expanded first-use guidance,
  help, keyboard, and interaction-state feedback.

### Changed

- Reworked the workspace rail so graph navigation, creation defaults, and
  selected-item properties remain visually stable as selection changes.
- Simplified graph cards and actions, reduced heavy button chrome, removed drag
  handles where the object itself is draggable, and improved compact layouts.
- Made edge labels and their hit targets easier to select and rename, with a
  stable clicked toolbar and clearer appearance-oriented edge styles.
- Switched the development typecheck to tsgo while retaining tsc as the release
  gate, and added parallel fast configurations for Vitest and Playwright.

### Fixed

- Prevented current-graph activation from clearing selection and eliminated
  stale selected-item properties after deletion or deselection.
- Made Text nodes transparent and borderless by default while preserving clear
  selection feedback and type-aware creation previews.
- Prevented contextual toolbars and properties panels from obscuring editing,
  graph navigation, or one another at constrained viewport sizes.
- Improved cancellation, gesture ownership, geometry, command cleanup, and
  render scheduling across canvas interactions.

## [1.0.0] - 2026-07-27

### Added

- Added an extensible node-type registry, searchable categorized catalog,
  favorites, recent types, and reusable saved types.
- Added C4, architecture, flowchart, UML, planning, data, ML, and autonomous
  system primitives with inline SVG controls and editable visual properties.
- Added nested containers, free-form ink, canvas and item context menus,
  switch nodes, conversion between nodes and containers, and viewport-aware
  sharing.
- Added deterministic visual journeys, architecture projections, performance
  probes, and regression gates for interaction and layout behavior.
- Added compact production-shaped guide examples, including a Spring, Kafka,
  PostgreSQL, and Redis checkout architecture.

### Changed

- Rebuilt the desktop interface around a stable icon command bar, collapsible
  workspace drawer, compact left-rail inspector, and nearby item actions.
- Made Add place the first node immediately, continue as a placement mode, and
  place into the deepest container under the pointer.
- Reworked Move item into a visual destination picker that supports nested
  containers and moving nested items back to Canvas.
- Reworked selection, drawing, erase, responsive navigation, onboarding, and
  properties editing for clearer state and smaller interaction cost.

### Fixed

- Preserved connections when converting between nodes and containers.
- Prevented canvas gestures and pinned drawer sections from intercepting catalog
  scrolling or catalog-item activation.
- Kept the command bar, hamburger, Fit control, graph viewport, and canvas
  camera stable while side panels open and close.

## [0.2.0] - 2026-07-16

### Added

- Added a long-press radial action wheel for mobile node editing, linking,
  nesting, folding, and deletion.
- Added simultaneous two-finger pan and pinch zoom gestures.
- Added mobile interaction-budget coverage for touch journeys capped at three
  interactions.

### Changed

- Reworked the mobile shell into a lighter canvas-first Create, Tools, and Fit
  interface with touch-sized controls and a bottom-sheet command menu.
- Replaced mobile keyboard hints with touch guidance and contextual actions.
- Removed persistent layout controls on every viewport and retained only Fit as
  the persistent zoom control.
- Made Rename explicit on desktop and available from the shared item wheel.

## [0.1.1] - 2026-07-16

### Added

- Added Makefile commands for running, testing, and patch/minor/major releases.

### Fixed

- Centered node titles when the node has no description.

## [0.1.0] - 2026-07-16

### Added

- Keyboard-first graph authoring and navigation.
- Nested graphs, layout, selection, sharing, import/export, and local persistence.
- Command-driven tests, event replay, architecture validation, and local-model DX tools.
- Static web-app build.
- First-visit field guide persisted by the `showDemo` cookie.
- Canonical C4, radial expected-value, and delivery-workflow canvases.
- Editable Mermaid conversion workbench and direct `?demo=` hosted-demo routes.

### Changed

- Defined a repeatable 0.1 release gate for types, builds, coverage, and browser tests.
- Isolated browser-test serving from local DX projection watchers.
- Clarified the supported release artifacts and runtime requirements.
- Scoped 0.1 to the static application; the experimental library remains post-0.1 work.
- Removed the unused system-design subsystem and split container/debug rendering policy from behavior.

[Unreleased]: https://github.com/merv-gh/canvas-graph/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/merv-gh/canvas-graph/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/merv-gh/canvas-graph/releases/tag/v2.0.0
[1.0.0]: https://github.com/merv-gh/canvas-graph/releases/tag/v1.0.0
[0.2.0]: https://github.com/merv-gh/canvas-graph/releases/tag/v0.2.0
[0.1.1]: https://github.com/merv-gh/canvas-graph/releases/tag/v0.1.1
[0.1.0]: https://github.com/merv-gh/canvas-graph/releases/tag/v0.1.0
