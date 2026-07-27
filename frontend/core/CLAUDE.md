# core/ — small adapters behind `ctx.contexts.*`; open only the one you need

- `commands.ts` — command registry + dispatch + the DOM→command input router (typing/modal guards).
- `shortcuts.ts` — `Ctrl+Shift+P` string parsing/matching.
- `selection.ts` — selected/focused set store (per-graph, deep-equal refs, fan-out facts).
- `fold.ts` — persisted open/closed map: panels, zen, item collapse. `itemFoldId`, `foldHidden`.
- `hierarchy.ts` — read side: sources + parent providers → `tree/roots/parentChain/targets`; `createNesting` = mutable engine.
- `decorations.ts` — transient per-item visual state: modes (classes) + overlays (screen chips).
- `affordances.ts` — system + entity affordance contributions (toolbar/entity slots).
- `interaction.ts` — who owns the interaction: `.keys` (exclusive capture, `keyboard.ts`), `.editing` (inline-edit claim read by the input router + command guards), `.cancel` (Cancellable registry, `cancellation.ts`; Escape routes to highest-priority active).
- `view.ts` — pan/zoom math, screen⟷space, visibleRect.
- `geometry.ts` — rect union/expand/center helpers.
- `pointer-gesture.ts` — low-level pointer tracking + shared move-intent predicate; gesture systems keep their own mode state.
- `markdown.ts` — safe Markdown block parse/render (`parseMarkdown`, `renderMarkdown`, `markdownPlainText`) + `parseMarkdownOutline` (headings + indent-nested lists → outline entries for import).
- `storage.ts` — `item.update` dispatcher: kind → registered patch handler.
- `io.ts` — persistence adapter (`localStorageIo` / `memoryIo`), STORAGE_KEYS.
- `telemetry-core.ts` — DOM-free span aggregation: `SpanRing` columns, causality counting, OTLP `resourceSpans`, the compact persistence blob. Runs in `systems/telemetry.worker.ts` (or in-process as a fallback); never on the interaction path.
- `flags.ts` — feature flags (+ persisted overrides, kinds, requires).
- `model-registry.ts` — entity/collection/node-type registration + resolution (live, flag-filtered).
- `collection-commands.ts` — collection → derived command ids.
- `templates.ts` — `<template id="tpl-*">` clone/slot/text + emptyState/kbdHint.
- `dom.ts` / `item-ref.ts` — `data-item-*` tagging/parsing; ref equality.
- `redraw.ts` — `factScope(eventName)` → which scopes a fact dirties.
- `sim.ts` — bus recorder/replay, orphan-emit/silent-listener probes.
- `snapshot.ts` — structured user-visible state; each leaf carries the TS expression to assert it.
- `test-gen.ts` — trace + picked assertions → runnable vitest file.
- `introspect.ts` — systems/events/contributions as a graph (powers demo).

`core.ts` (parent dir) = bus + registry + contexts assembly only. It is size-ratcheted:
≤400 lines, ≤13 contexts — merge before adding (see PRINCIPLES 1/19).
