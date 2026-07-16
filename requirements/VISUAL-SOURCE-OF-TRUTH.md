# Visual requirements source-of-truth report

**Audit date:** 2026-07-15  
**Surface:** generated `requirements/requirements.graph.json` opened in Chromium  
**Canonical authoring source:** `requirements/requirements.md`

## Outcome

The useful product model is not “a large graph containing requirement text.” It
is a two-level reading instrument:

1. **Contract overview** — Mission, source provenance, release legend, counts,
   evidence coverage, and nine folded Attributes.
2. **Focused reading** — one open Attribute at a time, divided into Component
   sections, with complete Capability sentences and current blocker status.

The Markdown file remains canonical because it is reviewable in diffs and the
graph is generated from it. The imported graph identifies itself as a generated
projection, removes normal mutation affordances, rejects mutation commands, and
directs changes back to the Markdown plus `npm run requirements:graph`.

Readiness is now part of that same model. Sparse `EVD-###` rows record only real
accepted, pending, rejected, or stale proofs; generation derives missing state
for every unrecorded 0.1 Capability. The current baseline truthfully reports 25
of 212 release Capabilities proven and 187 missing records.

## What the browser audit found

| Observation | Why it breaks human use | Requirement |
|---|---|---|
| Fit-all opened 9 Attributes and 215 cards at **6%**. | The contract was visible only as a silhouette; labels and hierarchy could not be read. | CAP-C06-A02-02, CAP-C08-A01-04 |
| Choosing `CAP-C11-A02-05` from the navigator left the view at **6%**. | Search found an address but did not complete navigation to readable content. | CAP-C08-A01-04 |
| The navigator listed all nodes before containers and truncated at an entity-kind list. | Attribute/Component structure disappeared, turning an explicit model back into a flat backlog. | CAP-C02-A02-05 |
| Searching `keyboard shortcuts can continue` returned no navigator result. | People remember intent and wording more often than stable IDs. | CAP-C02-A02-01 |
| Cards used a fixed 92-pixel height; audited prose had measurable overflow. | The graph could conceal the end of a normative sentence. Hidden requirement text is data loss at the reading layer. | CAP-C04-A01-06, CAP-C09-A02-03 |
| Open blocker rows were not connected to Capability cards. | Scope and readiness required two separate manual audits, recreating the original release-readiness problem. | CAP-C17-A08-03 |
| The imported graph behaved like an editable ordinary graph. | A local visual edit looked authoritative but did not update the Markdown source. | CAP-C17-A08-04 |
| The compact overview fitted against the full stage while the navigator covered its left edge. | The contract label and start of the Mission were hidden precisely in the view intended to establish context. | CAP-C01-A02-07, CAP-C08-A01-04 |
| Layout, resize, section-resize, Undo, and Redo could remain visible after the projection became read-only. | A visible action that can only be rejected makes the generated-view contract feel broken rather than deliberate. | CAP-C10-A02-01, CAP-C17-A08-04 |
| A filter narrowed the navigator to 3/15 A08 Capabilities but left all 15 canvas cards equally prominent. | The index and visual projection asserted different scopes, making the filtered result untrustworthy. | CAP-C02-A02-06 |
| Filtering A08 fitted the complete Attribute at 29%. | The matching proof-backed cards were still unreadable, so the filter did not complete its own navigation journey. | CAP-C02-A02-06, CAP-C08-A01-04 |
| Reload restored the requirements stage but could leave the navigator without its nine Attribute rows until a search forced another draw. | The same saved document presented two contradictory structures, and the primary navigation appeared incomplete. | CAP-C02-A02-05, CAP-C14-A06-01 |
| Expanding A02 fitted its complete tall container at **17%**. | The transition from readable overview to unreadable detail reversed the purpose of unfolding. | CAP-C08-A01-04, CAP-C08-A02-03 |
| Unfolding required selecting a small badge and then using a floating triangle button. | A common direct gesture was missing, and directional triangles described movement less clearly than maximize/minimize state. | CAP-C06-A02-01, CAP-C06-A07-01 |
| Descriptions were absent from ordinary graph search; Component section titles appeared only as aggregated container copy and could not be opened. | People could neither retrieve remembered prose nor navigate directly to the structural address that explained it. | CAP-C02-A02-01, CAP-C02-A02-03, CAP-C02-A02-05 |
| A Component search could frame the right section while every card remained dim. | Navigator scope and canvas emphasis contradicted each other at the exact destination. | CAP-C02-A02-03, CAP-C02-A02-06 |
| Empty nodes offered fold, while folded described nodes kept the title in its former top slot over an empty body. | The control promised detail where none existed, and the resulting state looked broken instead of reduced. | CAP-C04-A02-02 |
| Description sizing counted literal Markdown markers while the renderer omitted common blocks such as ordered lists, quotes, and fenced code. | Stored content and visible structure produced different geometry, leading to awkward whitespace or clipping after edits. | CAP-C04-A01-04, CAP-C04-A01-06 |
| Nested selected items could lose their selected class, and remaining selected borders were too close to ordinary grayscale boundaries. | The primary interaction state disappeared exactly when hierarchy made the canvas densest. | CAP-C01-A07-03, CAP-C07-A02-02, CAP-C16-A01-01 |

## Explicit requirements

These come directly from the requested source-of-truth goal.

- The requirements graph is the primary human review surface.
- Parentless overview containers start open; nested Attribute containers start
  folded.
- Opening an Attribute produces a readable, non-overlapping view.
- Nodes and edge labels receive enough measured layout space for their text.
- Awkward navigation and missing needs are recorded back into the requirements
  model instead of living only in an audit report.
- The result remains file-backed, deterministic, importable, and addressable.

## Implicit requirements

The browser journey makes these necessary even though “draw the requirements”
does not state them by itself.

| Need | Acceptance condition | Current state |
|---|---|---|
| Overview-to-detail navigation | Double-clicking an Attribute opens it, folds siblings, reflows the overview, and frames readable content without dropping below 80%. | Implemented |
| Full-text retrieval | ID, title, full description, Attribute, Component section, Capability sentence, and blocker condition are searchable. | Implemented |
| Hierarchical navigator | Mission/overview, Attributes, jumpable Component section rows, and Capability children retain the conceptual structure. | Implemented |
| Section addressing | Opening a section unfolds its ancestor path, selects its container, top-aligns the requested band, and keeps matching canvas content prominent. | Implemented and regression-tested |
| Reading-scale floor | Fit centres complete bounds only when they remain at least 80%; tall overflow top-centres, while wide overflow keeps its leading edge clear of chrome and continues off-screen at the far edge. | Implemented and regression-tested |
| Honest provenance | The view names its source and regeneration command and cannot silently accept ordinary graph edits. | Implemented |
| Deterministic visual identity | Capability IDs map to stable node IDs; Attribute IDs map to stable container IDs. | Implemented and tested |
| Text-safe geometry | Card height derives from prose; layouts budget node bounds and both dimensions of edge labels. | Implemented |
| Description-aware detail | Fold is absent without a description; folded nodes use title-only bounds with vertically centred titles, and removing the description clears stale fold state. | Implemented and regression-tested |
| Markdown-true geometry | Safe Markdown blocks render semantically and auto-size measures those same parsed blocks after edits. | Implemented and regression-tested |
| Persistent selection identity | Strong grayscale selection follows the same item through nested and canonical reference forms. | Implemented and regression-tested |
| Readiness on the requirement itself | Open blocker IDs, kind, and condition appear on their Capability cards. | Implemented |
| Obstruction-aware framing | Fit and item reveal use the canvas region not covered by the open navigator. | Implemented and regression-tested |
| Honest affordances | Mutation controls are absent as well as command-guarded; document navigation and export remain available. | Implemented |
| Evidence on the requirement itself | Every Capability carries a derived evidence state and links to its authored evidence IDs; absence becomes `missing`. | Implemented; coverage remains incomplete — BR-041 |
| Change review | Regeneration produces a diff in the graph artifact and validation rejects duplicate or dangling IDs. | Implemented; graph diff remains verbose JSON |
| Scale filters | Reviewers can compose 0.1/Later, blocker/evidence, Attribute, Component, and prose filters without changing data or flattening hierarchy. | Implemented: the navigator isolates results, the canvas spotlights matches while retaining dim context, and a specific Attribute filter frames its first match at 90% |
| Source navigation | A card can open the exact Markdown row in a repository-aware environment. | Not yet implemented; static browser imports have no repository URL contract |

## Information model

The visual hierarchy now encodes facts rather than decoration:

```text
Requirements root (open)
├── Mission / provenance / legend / evidence coverage
├── A01 Functional (folded by default)
│   ├── Attribute definition
│   ├── C01 Shell
│   │   └── CAP-C01-A01-01 · 0.1
│   └── …
├── A02 Usable
└── … A09 Local-first
```

- **Square:** 0.1 Capability.
- **Circle:** Later Capability.
- **Text card:** Mission or Attribute definition.
- **Open blocker text:** unresolved release work attached to that Capability.
- **Evidence line:** accepted proof names its `EVD-###` IDs; missing, pending,
  rejected, stale, and not-required states remain explicit prose on the card.

## Remaining work before this can prove release readiness alone

BR-041 remains the material gap, but its data-model and review-UX portions are
now implemented. Continue adding real evidence rows until every 0.1 Capability
has at least one accepted automated proof or dated manual proof. The remaining
work is evidence production and acceptance, especially:

- filling the 187 Capabilities that currently have no evidence record;
- resolving or explicitly rejecting stale/pending records as the implementation
  changes; and
- recording evidence changed since the last accepted release baseline.

The graph is now the single place to understand mission, scope, hierarchy,
known blockers, and proof coverage. It still cannot honestly claim the release
is ready while 187 release Capabilities remain unproven.
