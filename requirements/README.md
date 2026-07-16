# Requirements operating guide

This directory is the product contract. It keeps release readiness tied to an
approved scope instead of to whichever audit happened most recently.

- [`requirements.md`](requirements.md) defines the mission, Attributes,
  Components, Capabilities, the proposed 0.1 scope, readiness evidence, and the
  current blocker ledger.
- [`RELEASE-0.1.md`](../RELEASE-0.1.md) records transient audit results and
  release execution. It may provide evidence, but it does not silently add
  requirements.

## Model

- **Attribute** — one adjective describing a product value. Keep at most 12.
- **Component** — one noun naming an addressable product part. Keep at most 20.
- **Capability** — one observable sentence at the intersection of exactly one
  Attribute and one Component.

Capability IDs are permanent: `CAP-C<component>-A<attribute>-<sequence>`. Never
reuse a retired ID for a different promise.

## Release markers

- **0.1** — required for 0.1. Missing behavior, missing accepted evidence, or an
  unresolved owner decision blocks release.
- **Later** — relevant to the mission or a plausible extension, but explicitly
  does not block 0.1.

The blocker ledger distinguishes `gap`, `proof`, `decision`, and `release-step`.
That distinction prevents a distribution choice from being reported as an
application bug, while still preventing an incomplete public release.

Evidence rows use permanent `EVD-###` IDs and point to exactly one Capability.
Accepted records require an acceptance date; accepted automated records name an
existing `tests/...#exact assertion`. Do not add placeholder rows for every
Capability: an absent accepted record is deliberately derived as `missing`.

## Operating loop

1. Propose a change in `requirements.md` before changing the release bar.
2. Express it as one observable outcome with one Attribute and one Component.
   Split sentences that need two of either.
3. Mark it `0.1` or `Later`; for `0.1`, add or update its blocker/evidence entry.
4. Get product-owner approval for scope changes. An audit may find evidence or a
   defect, but may not invent a new blocker without this change step.
5. Implement from a failing journey or other reproducible proof, then link the
   passing evidence from the readiness ledger.
6. Release only when every `0.1` capability has accepted evidence and the blocker
   ledger is empty. `Later` rows never fail the 0.1 gate.

## Visual map

Run `npm run requirements:graph` after changing `requirements.md`. It generates
`requirements/requirements.graph.json`, which can be opened through the app's
Import → JSON journey.

The generated map opens as a Mission/root overview with every nested Attribute
folded. Open one Attribute to read its Component sections and Capability cards;
double-clicking a folded Attribute opens it directly, and opening another folds
the previous Attribute. Fit never reduces the reading surface below 80%; a tall
Attribute aligns to the top-centre and continues below the viewport, while a
wide Attribute keeps its leading edge clear and continues beyond the far edge
instead of shrinking its text. Square nodes are 0.1 requirements,
circular nodes are Later, and open blocker conditions are attached to affected
Capability cards. Every card also states its evidence status. The navigator
preserves the Attribute hierarchy, groups Capability rows beneath individually
jumpable Component sections, searches complete descriptions and section names,
and can compose release-scope, readiness, Attribute, and Component filters.
Opening a section unfolds its Attribute and aligns the section to the top reading
edge. Selecting a specific Attribute keeps matching cards prominent, dims
unmatched canvas context, and frames the first match at reading scale without
flattening its Capability results.

This graph is a generated projection, not a second authoring format. The app
directs edits back to `requirements.md` and rejects ordinary mutation commands
while this graph is active. The generator validates the 12-Attribute and
20-Component limits, duplicate IDs, Capability intersections, blocker and
evidence references, evidence enums/dates, and accepted automated proof files
before writing the graph.

[`VISUAL-SOURCE-OF-TRUTH.md`](VISUAL-SOURCE-OF-TRUTH.md) records the Chromium UX
audit and the explicit and implicit requirements for this view. BR-041 now means
incomplete proof coverage—not a missing evidence model—and remains open until
every 0.1 Capability has accepted evidence.

## Quality rules

- Prefer user outcomes over implementation details.
- Include a bound where “fast”, “short”, “complete”, or “safe” would otherwise
  be subjective.
- A user-facing capability root must be reachable through both the visible UI
  and command palette. Low-level gesture phases are not separate capability
  roots, but they must remain registered commands and appear in the readable,
  searchable command catalog so the registry also explains how an interaction
  works. The catalog may group phases separately from ordinary one-shot actions.
- Every user journey must be drivable through the unified test contract. Use a
  real-browser assertion only for facts the DOM-less harness cannot observe.
- If a useful Capability does not fit one Attribute and one Component cleanly,
  revise those lists before adding the Capability; if it is not central enough
  to justify that revision, it is not a product requirement.
- Keep current behavior and intended behavior distinct. A capability says what
  must be true; the blocker ledger says whether it is true now.
- Never close a blocker with prose alone when an automated proof is practical.

## Audit protocol

Audit only the approved `0.1` rows. For each row, record one of: automated test,
manual release proof with date/environment, owner decision, or a blocker. If an
audit discovers a valuable promise not represented here, add it as a proposed
requirement and review its release marker before treating it as blocking.
