# Changelog

All notable changes to this project will be documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/merv-gh/canvas-graph/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/merv-gh/canvas-graph/releases/tag/v0.1.1
[0.1.0]: https://github.com/merv-gh/canvas-graph/releases/tag/v0.1.0
