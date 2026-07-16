# Canvas Graph product requirements

**Status:** Draft for product-owner review

**Baseline date:** 2026-07-15

**Rule:** Every row marked **0.1** is a proposed release blocker until accepted
evidence proves it. Rows marked **Later** do not block 0.1.

## Mission

Canvas Graph is a keyboard-first visual editor for **writing and navigating
structured graphs** that explain systems, concepts, sequences, workflows, and
nested maps of memory. A person should be able to open the web app without prior
instruction, create nodes and relationships, organize them spatially and
hierarchically, keep the work locally, and deliberately hand another person an
independent copy through a direct link or portable file.

The product is local-first and single-user. Sharing means “send a copy that the
recipient can open”; accounts, servers, and real-time collaboration are not part
of this mission.

## 0.1 release contract

0.1 compresses the mission to one static web application in which a new user can:

1. discover the product at a public URL and understand its purpose without
   external guidance;
2. create, edit, connect, select, arrange, navigate, and nest graph content;
3. use short, clear journeys on keyboard-first desktop and touch-friendly mobile;
4. reload, undo, recover, import, export, and share without silent data loss;
5. use a responsive, accessible baseline whose important journeys are observable
   and regression-tested through one test contract; and
6. receive a versioned, licensed, reproducible static artifact with an explicit
   browser-support promise.

Not in 0.1: accounts, backend sync, collaboration, npm publication, the
embeddable library, presentation mode, a public debug/performance workbench,
schema-v2 migrations before schema v2 exists, or optional WebGPU navigation.

## Approved 0.1 decisions

- **Browser:** Chromium-only is the explicit 0.1 compatibility promise. The
  release documentation must still name the tested Chromium version and desktop
  and touch-sized viewport coverage; Firefox and WebKit are non-goals for 0.1.
- **Hosting:** the first canonical production target is GitHub Pages. The build,
  direct demo routes, and embedded-graph share links must work from its project
  base path and through a direct page load.
- **License:** use [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html).
  It gives recipients an explicit copyright and patent grant. The released 0.1
  source remains Apache-2.0, while owner-authored future editions may use paid or
  proprietary terms; accepting outside contributions must not compromise that
  future option.
- **Product name:** “Canvas Graph” remains a working label. The final public name
  may be chosen at the last release step, but it must be applied consistently
  before the release commit is tagged or promoted to the canonical URL.
- **Commands:** UI/palette parity applies to user-facing capability roots. Every
  low-level gesture phase also remains a registered, inspectable command and is
  present in the readable command catalog because that catalog doubles as help.
- **Test contract:** unified pointer streams and scenario-level real-layout
  assertions are required for 0.1; separate bespoke browser tests do not close
  those gaps.

## Attributes

There are 9 Attributes; the limit is 12.

| ID | Attribute | Meaning and sub-attributes |
|---|---|---|
| A01 | Functional | Correct, complete, lossless end-to-end behavior: it should work. |
| A02 | Usable | Discoverable, clear, convenient, visually coherent, focused, and reachable in at most three interactions; keyboard-first on desktop, touch-friendly on mobile, with UI/palette parity and genuinely hideable clutter. |
| A03 | Testable | Observable, reproducible, drivable through one journey contract, and regression-covered; this is the DX promise. |
| A04 | Releasable | Publicly discoverable, understandable without guidance, deployable, versioned, supported, and legally distributable. |
| A05 | Fast | Immediate for ordinary work and bounded for large graphs, with explicit regression budgets. |
| A06 | Durable | Locally persistent, reversible where practical, confirmed when destructive, recoverable, and format-compatible. |
| A07 | Accessible | Perceivable, semantically named, focus-safe, keyboard-operable, and touch-operable. |
| A08 | Extensible | Composable, independently replaceable, mechanically inspectable, and cheap to change or debug. |
| A09 | Local-first | Useful without an account or runtime server; data stays in the browser unless the user explicitly exports or shares it. |

## Components

There are 20 Components; the limit is 20.

| ID | Component | Boundary |
|---|---|---|
| C01 | Shell | App frame, toolbars, panels, modals, notices, theme, and zen state. |
| C02 | Graph documents | The named, switchable collection of graphs. |
| C03 | Canvas | The spatial writing surface and its direct manipulation. |
| C04 | Nodes | Graph concepts and their content, geometry, and appearance. |
| C05 | Edges | Directed relationships, labels, geometry, and actions. |
| C06 | Containers | Nested groups, sections, and parent-child structure. |
| C07 | Selection | Focus, single/multiple choice, set growth, and bulk actions. |
| C08 | Viewport | Pan, zoom, fit, jump, and spatial navigation. |
| C09 | Layout engine | Vertical and horizontal nested lists, trees, radial maps, and style-aware placement. |
| C10 | Commands and palette | Command registry, shortcuts, search, forms, pickers, help, and cancellation. |
| C11 | Inspector and editors | Context actions, properties, inline editing, and typed fields. |
| C12 | Import and export | JSON, Mermaid, SVG, PNG, validation, preview, and downloads. |
| C13 | Sharing | Direct-link copy exchange and its codec. |
| C14 | Storage and history | Browser persistence, backups, recovery, undo, and redo. |
| C15 | Onboarding and demos | First-run guide, examples, and canonical demo routes. |
| C16 | Renderer | DOM/SVG stage, culling, redraw, semantic zoom, and optional GPU stage. |
| C17 | Test and DX harness | Scenarios, snapshots, replay, generation, coverage, browser checks, and local-model loop. |
| C18 | Plugin architecture | Systems, abilities, features, events, registries, flags, and model boundaries. |
| C19 | Release artifact and site | Static build, CI gate, hosting, compatibility, license, tag, and archive. |
| C20 | Product documentation and metadata | Name, mission copy, end-user help, support statement, changelog, and page metadata. |

## Capabilities

An omitted Attribute/Component intersection is intentionally not a requirement.
Each included row intersects exactly one Attribute and one Component.

### C01 — Shell

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C01-A01-01 | A01 Functional | **0.1** | The shell loads the graph stage, registered controls, panels, modal place, and notice place as one usable application. |
| CAP-C01-A02-01 | A02 Usable | **0.1** | An empty shell presents a clear first-node action directly on the canvas. |
| CAP-C01-A02-02 | A02 Usable | **0.1** | Primary create, connect, search, import, export, share, guide, and theme journeys begin from visible controls and take no more than three interactions. |
| CAP-C01-A02-03 | A02 Usable | **0.1** | Zen mode removes nonessential chrome from the usable stage without hiding the canvas, reserving its old space, or changing selection, camera, or work state. |
| CAP-C01-A02-04 | A02 Usable | **0.1** | Desktop chrome does not overlap, while a 390-pixel-wide phone starts canvas-first without horizontal overflow, a multi-row primary toolbar, or competing fixed controls. |
| CAP-C01-A02-05 | A02 Usable | **0.1** | The app starts in a legible grayscale light theme and offers an immediately reversible grayscale dark-theme control; neither theme introduces chromatic status cues. |
| CAP-C01-A01-02 | A01 Functional | **0.1** | Canvas pan, zoom, layout, selection, and history never translate, clip, or move shell chrome away from its viewport anchors. |
| CAP-C01-A02-06 | A02 Usable | **0.1** | Buttons, icons, labels, pressed states, typography, and spacing follow one documented control grammar in every toolbar, panel, navigator, and modal. |
| CAP-C01-A02-07 | A02 Usable | **0.1** | Each viewport anchor exposes at most one visible and focusable contextual control group, and notices, prompts, item tools, and fixed panels never obscure one another. |
| CAP-C01-A07-01 | A07 Accessible | **0.1** | Every modal exposes dialog semantics, isolates background controls, receives predictable initial focus, closes by an explicit control or Escape, and restores focus. |
| CAP-C01-A07-02 | A07 Accessible | **0.1** | Primary phone controls have touch targets at least 40 CSS pixels high and remain inside the viewport. |
| CAP-C01-A07-03 | A07 Accessible | **0.1** | Text, borders, focus rings, selected states, warnings, and destructive action labels remain perceivable in both themes and are never conveyed by color alone. |
| CAP-C01-A07-04 | A07 Accessible | **0.1** | Hidden or visually replaced panels are removed from focus order, and every toggle exposes its current state semantically. |
| CAP-C01-A05-01 | A05 Fast | **0.1** | The application boot completes below 500 ms in the isolated release performance harness. |

### C02 — Graph documents

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C02-A01-01 | A01 Functional | **0.1** | A user can create a new empty graph without changing existing graphs. |
| CAP-C02-A01-02 | A01 Functional | **0.1** | A user can switch among graphs and always see which named graph is active. |
| CAP-C02-A01-03 | A01 Functional | **0.1** | A user can rename the active graph and the new name is used by navigation and persistence. |
| CAP-C02-A01-04 | A01 Functional | **0.1** | A user can duplicate the active graph as an independently editable named copy. |
| CAP-C02-A06-01 | A06 Durable | **0.1** | Deleting a graph requires explicit confirmation that distinguishes deletion from cancellation. |
| CAP-C02-A02-01 | A02 Usable | **0.1** | The graph navigator shows the editable current name, orders recent graphs predictably, and filters graph items by IDs, human names, full descriptions, and meaningful semantic text. |
| CAP-C02-A02-02 | A02 Usable | **0.1** | Creating, switching, duplicating, renaming, and deleting a graph are each reachable through the palette and an understandable UI path. |
| CAP-C02-A02-03 | A02 Usable | **0.1** | The navigator lists and filters nodes, edges, containers, and individually addressable sections with human names and correct counts; opening a section unfolds its path and aligns that section to the top reading edge. |
| CAP-C02-A02-04 | A02 Usable | **0.1** | A navigator filter distinguishes an empty whole result from a graph with no local matches and always explains what scope has no matches. |
| CAP-C02-A02-05 | A02 Usable | **0.1** | A structured requirements document preserves Mission → Attribute → Component → Capability hierarchy in navigation, with jumpable Component section rows, instead of flattening the contract into one undifferentiated item list. |
| CAP-C02-A02-06 | A02 Usable | **0.1** | A requirements reviewer can compose release-scope, readiness, Attribute, Component, and full-text filters; filtered counts remain grouped by Attribute and opening a result preserves the one-Attribute reading path. |
| CAP-C02-A09-01 | A09 Local-first | **0.1** | A user can manage multiple graph documents without an account or network connection. |

### C03 — Canvas

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C03-A01-01 | A01 Functional | **0.1** | The canvas provides a stable spatial coordinate system in which items can be created, moved, resized, connected, and rendered together. |
| CAP-C03-A01-02 | A01 Functional | **0.1** | Direct manipulation changes only the intended graph items and keeps their relationships visually attached. |
| CAP-C03-A02-01 | A02 Usable | **0.1** | Canvas background interactions have predictable select, pan, cancel, and empty-state meanings without requiring prior knowledge. |
| CAP-C03-A02-02 | A02 Usable | **0.1** | Nonessential visual chrome is flat, grayscale, gradient-free, boundary-light, quiet, and hideable so graph content remains the dominant surface. |
| CAP-C03-A03-01 | A03 Testable | **0.1** | Canvas state and user-visible mode changes are exposed through snapshots or real-layout assertions. |
| CAP-C03-A05-01 | A05 Fast | **0.1** | Creating 100 nodes averages less than 100 ms per node in the release performance harness. |

### C04 — Nodes

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C04-A01-01 | A01 Functional | **0.1** | A user can create a node with a default title at a visible position; the first standalone node replaces the empty-state invitation at the exact same stage centre. |
| CAP-C04-A01-02 | A01 Functional | **0.1** | A user can create an attached node from a selected node and receive the connecting edge in the same journey. |
| CAP-C04-A01-03 | A01 Functional | **0.1** | A user can edit a node title inline and commit by Enter or focus change. |
| CAP-C04-A01-04 | A01 Functional | **0.1** | A user can edit node title, Markdown description, and text, square, or circle presentation through supported fields; safe headings, paragraphs, emphasis, links, lists, quotes, rules, inline code, and fenced code render as structured content. |
| CAP-C04-A01-05 | A01 Functional | **0.1** | A user can drag, keyboard-nudge, and manually resize a node without corrupting its data. |
| CAP-C04-A01-06 | A01 Functional | **0.1** | A node auto-sizes to its title and rendered Markdown block geometry after each content edit until the user explicitly chooses a manual size. |
| CAP-C04-A01-07 | A01 Functional | **0.1** | A user can delete a node and all now-invalid incident edge references are resolved consistently. |
| CAP-C04-A02-01 | A02 Usable | **0.1** | Node shape names are identical in canvas actions, inspectors, navigator labels, palette commands, documentation, and accessible names. |
| CAP-C04-A02-02 | A02 Usable | **0.1** | A node exposes fold only when it has a non-empty description; folding hides that detail, compacts to title-only geometry, and centres the title, while clearing the description restores the open title-only state. |
| CAP-C04-A07-01 | A07 Accessible | **0.1** | Each rendered node has a semantic role, an accessible name describing its title and type, and a keyboard focus target. |
| CAP-C04-A06-01 | A06 Durable | **0.1** | Node content, extensions, geometry, and appearance survive reload, history, JSON, and share round-trips. |

### C05 — Edges

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C05-A01-01 | A01 Functional | **0.1** | A user can create a directed edge between two valid nodes by selecting a source and picking a target. |
| CAP-C05-A02-01 | A02 Usable | **0.1** | Edge creation explains its active mode and accepts either a target click or the target's displayed letter. |
| CAP-C05-A01-02 | A01 Functional | **0.1** | An edge remains geometrically attached when either endpoint moves, resizes, nests, or is laid out. |
| CAP-C05-A01-03 | A01 Functional | **0.1** | A user can select an edge and edit its label through the same item-editing model as other graph content. |
| CAP-C05-A01-04 | A01 Functional | **0.1** | A user can reverse the direction of a selected edge without recreating it. |
| CAP-C05-A01-05 | A01 Functional | **0.1** | A user can delete a selected edge without deleting its endpoint nodes. |
| CAP-C05-A01-06 | A01 Functional | **0.1** | Invalid endpoints and unsupported self-connections are rejected without partially changing the graph. |
| CAP-C05-A01-07 | A01 Functional | **0.1** | Deleting an edge closes or invalidates every open editor for that edge so no stale action can mutate a deleted relationship. |
| CAP-C05-A07-01 | A07 Accessible | **0.1** | A selected edge exposes a nearby, named editor with understandable reverse and delete actions. |
| CAP-C05-A02-02 | A02 Usable | **0.1** | The complete connection-mode instruction and cancellation route remain visible above shell chrome on desktop and at 390 CSS pixels. |
| CAP-C05-A02-03 | A02 Usable | **0.1** | An edge is identified by its label or human-readable endpoints; raw storage IDs and duplicated fallback labels are not used as public titles. |

### C06 — Containers

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C06-A01-01 | A01 Functional | **0.1** | A user can create a named container and see its boundary on the canvas. |
| CAP-C06-A01-02 | A01 Functional | **0.1** | A user can move nodes or containers into and out of a container without duplicating or losing them. |
| CAP-C06-A01-03 | A01 Functional | **0.1** | Nested structure rejects cycles and represents every child through one coherent parent relationship. |
| CAP-C06-A01-04 | A01 Functional | **0.1** | Moving a container moves its descendants while preserving their internal relative positions. |
| CAP-C06-A01-05 | A01 Functional | **0.1** | A user can add, remove, rename, and resize named container sections. |
| CAP-C06-A01-06 | A01 Functional | **0.1** | A user can change a container's section direction and move a child to another section. |
| CAP-C06-A02-01 | A02 Usable | **0.1** | A container can be folded to reduce clutter and unfolded without changing graph data; a folded item opens by double-click and fold controls use state-correct maximize/minimize icons. |
| CAP-C06-A02-02 | A02 Usable | **0.1** | A structured document can declare a deterministic initial fold policy; nested containers start folded, parentless overview containers stay open, and opening a hidden descendant reveals its ancestor path. |
| CAP-C06-A06-01 | A06 Durable | **0.1** | Deleting a populated container warns about consequences and offers cancellation or ungrouping that preserves its contents. |
| CAP-C06-A06-02 | A06 Durable | **0.1** | Container hierarchy, sections, extensions, and child positions survive reload, history, JSON, and share round-trips. |
| CAP-C06-A07-01 | A07 Accessible | **0.1** | Container labels, section labels, fold controls, and item actions are named and keyboard reachable. |
| CAP-C06-A07-02 | A07 Accessible | **0.1** | Section-direction and structure controls expose their current state semantically and remain legible in both themes. |

### C07 — Selection

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C07-A01-01 | A01 Functional | **0.1** | A user can select one item, toggle additional items, clear the set, and see the focused member. |
| CAP-C07-A01-02 | A01 Functional | **0.1** | A user can box-select visible items without moving the canvas. |
| CAP-C07-A01-03 | A01 Functional | **0.1** | A user can choose all, none, or the inverse of the current set. |
| CAP-C07-A01-04 | A01 Functional | **0.1** | A user can grow a chosen node set along edges, by spatial radius, or by text search. |
| CAP-C07-A01-05 | A01 Functional | **0.1** | A user can group a multi-selection into one new container. |
| CAP-C07-A01-06 | A01 Functional | **0.1** | A user can delete a mixed selection through one consistent bulk action. |
| CAP-C07-A02-01 | A02 Usable | **0.1** | Tab and Shift+Tab cycle node selection predictably and retain visible DOM focus. |
| CAP-C07-A02-02 | A02 Usable | **0.1** | Grouping is offered only when the current selection can actually form a container; node, container, edge, nested, and multi-selection states remain unmistakable in grayscale. |
| CAP-C07-A06-01 | A06 Durable | **0.1** | Selection and focus are isolated per graph and never mutate graph content by themselves. |

### C08 — Viewport

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C08-A01-01 | A01 Functional | **0.1** | A user can pan with a trackpad or wheel, background drag, Space-drag, middle-drag, or supported touch gesture without moving graph items. |
| CAP-C08-A01-02 | A01 Functional | **0.1** | A user can zoom with pinch or modified wheel input and with explicit zoom-in, zoom-out, and reset commands. |
| CAP-C08-A01-03 | A01 Functional | **0.1** | A user can fit the whole graph or current selection inside the stage with resulting bounds centred on the stage centre, independent of overlay chrome. |
| CAP-C08-A01-04 | A01 Functional | **0.1** | Focusing an off-screen or overview-scale item never fits below 80%; unreadably tall bounds are top-centred, while unreadably wide bounds keep their leading edge outside obstructing chrome and let only the far content continue off-screen. |
| CAP-C08-A01-05 | A01 Functional | **0.1** | Jump mode labels focusable items and moves focus to the chosen node or edge by letter. |
| CAP-C08-A01-07 | A01 Functional | **0.1** | Camera transforms apply only to stage content and interaction overlays expressed in graph coordinates, never to viewport-anchored controls. |
| CAP-C08-A02-01 | A02 Usable | **0.1** | The viewport exposes its current zoom percentage and keeps zoom, fit, pan, and jump within three interactions. |
| CAP-C08-A02-02 | A02 Usable | **0.1** | Escape or an invalid jump key exits the active navigation mode without changing content. |
| CAP-C08-A02-03 | A02 Usable | **0.1** | Fit stays between an 80% reading floor and a 125% enlargement ceiling; it centres complete readable bounds, top-centres tall overflow, and protects the leading edge of wide overflow instead of shrinking text or hiding it under chrome. |
| CAP-C08-A05-01 | A05 Fast | **0.1** | Ten camera pans on a 10,000-node graph average below 150 ms per render flush in the CI scale probe. |
| CAP-C08-A01-06 | A01 Functional | **Later** | A presentation lens can navigate a synthesized local subgraph without changing the main canvas until the user explicitly opens an item there. |

### C09 — Layout engine

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C09-A01-01 | A01 Functional | **0.1** | A user can arrange the current graph as a vertical nested list, horizontal nested list, top-down tree, or radial map. |
| CAP-C09-A01-02 | A01 Functional | **0.1** | A manual layout uses actual item sizes and avoids unintended overlap among laid-out items. |
| CAP-C09-A01-03 | A01 Functional | **0.1** | A manual layout fits the resulting graph to the viewport after positions settle. |
| CAP-C09-A01-04 | A01 Functional | **0.1** | Directed relationships become visible structure: vertical lists indent descendants to the right, horizontal lists drop descendants below, trees layer relationship depth, and radial maps preserve a chosen hub. |
| CAP-C09-A06-01 | A06 Durable | **0.1** | Reapplying the same layout to unchanged content is deterministic and does not make the graph drift. |
| CAP-C09-A06-02 | A06 Durable | **0.1** | Each graph stores its active layout style in its versioned snapshot so switching, duplication, import, export, and reload retain the intended creation grammar. |
| CAP-C09-A02-01 | A02 Usable | **0.1** | Each release layout is available through a labeled control, the palette, and a documented shortcut where assigned. |
| CAP-C09-A02-02 | A02 Usable | **0.1** | Automatic placement gives a new node a readable position without moving existing nodes; adding or deleting content never runs an implicit whole-graph layout, while section assignment may position content only inside its edited container. |
| CAP-C09-A02-03 | A02 Usable | **0.1** | Automatic and manual layouts reserve the measured width and height of node content and edge labels so ordinary text does not overlap, clip, or become the spacing unit's accidental casualty. |
| CAP-C09-A02-04 | A02 Usable | **0.1** | In Vertical mode, A creates the next unconnected item below and moves selection there, while Shift+A creates a connected indented child to the right and keeps its parent selected; Horizontal mode mirrors those directions. |
| CAP-C09-A02-05 | A02 Usable | **0.1** | In Tree mode, A continues a connected child path and Shift+A fans sibling branches from the retained parent; in Radial mode, A drills outward and Shift+A adds spokes while retaining the hub. |
| CAP-C09-A05-01 | A05 Fast | **0.1** | Layout completion stays inside the real-browser performance budgets for the supported release fixtures. |

### C10 — Commands and palette

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C10-A02-01 | A02 Usable | **0.1** | Every 0.1 user-facing capability root is reachable both from an understandable visible UI path and from the command palette, with matching availability and naming. |
| CAP-C10-A02-02 | A02 Usable | **0.1** | The palette opens from its visible search control and documented keyboard entry point. |
| CAP-C10-A01-01 | A01 Functional | **0.1** | Palette search finds enabled commands and graph items, and Enter runs or navigates to the highlighted result. |
| CAP-C10-A02-03 | A02 Usable | **0.1** | Arrow keys and displayed accelerators navigate palette results without requiring a pointer. |
| CAP-C10-A02-04 | A02 Usable | **0.1** | An empty palette search reports that no command or item matches and offers a clear way to return to all results. |
| CAP-C10-A02-05 | A02 Usable | **0.1** | Command labels use one public verb for each selection operation and do not expose duplicate aliases as separate indistinguishable actions. |
| CAP-C10-A01-02 | A01 Functional | **0.1** | Context-dependent commands report unavailable rather than running with missing or stale inputs. |
| CAP-C10-A01-03 | A01 Functional | **0.1** | Forms and letter pickers gather required command inputs, explain their active mode, and cancel cleanly. |
| CAP-C10-A01-04 | A01 Functional | **0.1** | Escape and background cancellation route to the highest-priority active interaction and do not leak into later graphs or modals. |
| CAP-C10-A06-01 | A06 Durable | **0.1** | Custom shortcut edits persist, reject ambiguous collisions, and never replace protected text-entry behavior. |
| CAP-C10-A07-01 | A07 Accessible | **0.1** | Help presents a readable command catalog in understandable groups, distinguishes user actions from gesture phases, and shows shortcuts where assigned. |
| CAP-C10-A07-02 | A07 Accessible | **0.1** | Typing in a field, modal, inline editor, or exclusive keyboard mode does not trigger unrelated canvas shortcuts. |
| CAP-C10-A03-01 | A03 Testable | **0.1** | Every command declares stable identity, origin, input metadata, and an observable dispatch path. |
| CAP-C10-A03-02 | A03 Testable | **0.1** | Every pointer, drag, resize, wheel, pinch, and cancellation phase is a registered inspectable command visible in the command catalog and runnable by the unified scenario contract. |

### C11 — Inspector and editors

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C11-A01-01 | A01 Functional | **0.1** | A selected item exposes only actions and typed properties supported by its entity definition. |
| CAP-C11-A02-01 | A02 Usable | **0.1** | The nearby item toolbar, period shortcut, palette, and context path open one consistent actions-and-properties experience. |
| CAP-C11-A02-02 | A02 Usable | **0.1** | Common title, description, shape, relationship, and structure edits take no more than three interactions from selection. |
| CAP-C11-A02-03 | A02 Usable | **0.1** | The public inspector is compact and omits raw width and height controls that duplicate direct resize. |
| CAP-C11-A02-04 | A02 Usable | **0.1** | Inspectors use human item names and expose only product-relevant fields by default; schema-specific or advanced metadata is absent or explicitly disclosed. |
| CAP-C11-A02-05 | A02 Usable | **0.1** | Live-applied edits clearly indicate that they are already saved, initial modal focus favors the primary editable field over Close when safe, and Enter finishes title editing so keyboard shortcuts can continue. |
| CAP-C11-A02-06 | A02 Usable | **0.1** | Single-line editable text remains integrated with its surface at rest and reveals one underline on hover or focus instead of mounting a nested input box. |
| CAP-C11-A01-02 | A01 Functional | **0.1** | Editing a supported field applies the correct typed patch and updates the rendered item without a reload. |
| CAP-C11-A01-03 | A01 Functional | **0.1** | Deleting the edited item closes its inspector or replaces it with an explicit deleted state before any further action is accepted. |
| CAP-C11-A07-01 | A07 Accessible | **0.1** | Every editor field has a persistent accessible label, predictable focus, and an understandable validation state. |
| CAP-C11-A07-02 | A07 Accessible | **0.1** | Inspector toggles expose pressed or expanded state semantically, and all explanatory text meets the release contrast baseline. |
| CAP-C11-A06-01 | A06 Durable | **0.1** | Canceling an editor leaves committed graph data unchanged and history records only accepted edits. |

### C12 — Import and export

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C12-A01-01 | A01 Functional | **0.1** | JSON export downloads the complete active graph in the same versioned snapshot shape used by persistence. |
| CAP-C12-A01-02 | A01 Functional | **0.1** | Importing the app's JSON export recreates the complete graph, including extensions, containers, and sections. |
| CAP-C12-A01-03 | A01 Functional | **0.1** | A user can import supported Mermaid flowcharts and mermaid.live payloads with node shapes and labeled directed edges. |
| CAP-C12-A06-01 | A06 Durable | **0.1** | Invalid or incomplete import is rejected atomically and leaves the current graph unchanged. |
| CAP-C12-A06-02 | A06 Durable | **0.1** | A valid destructive import shows type and item counts, requires confirmation, and can be undone and redone. |
| CAP-C12-A02-01 | A02 Usable | **0.1** | Import provides a labeled source dialog and export provides explicit format choices even when clipboard access is absent or denied. |
| CAP-C12-A02-02 | A02 Usable | **0.1** | Export emphasizes the format action and keeps raw JSON and browser-save recovery as clearly labeled secondary or advanced paths rather than the default visual focus. |
| CAP-C12-A01-04 | A01 Functional | **0.1** | A user can download an editable JSON backup, a vector SVG, or a bitmap PNG from one export journey. |
| CAP-C12-A01-05 | A01 Functional | **0.1** | SVG and PNG exports contain the visible graph content and use recognizable file extensions and names. |
| CAP-C12-A06-03 | A06 Durable | **0.1** | Unknown snapshot extension keys survive JSON import and export unchanged for forward compatibility. |
| CAP-C12-A07-01 | A07 Accessible | **0.1** | Import previews, errors, confirmation choices, and export formats are announced with labels rather than color or icon alone. |

### C13 — Sharing

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C13-A01-01 | A01 Functional | **0.1** | A user can generate a direct link containing a complete independent copy of the active graph. |
| CAP-C13-A01-02 | A01 Functional | **0.1** | Opening a valid share link loads the copied graph without requiring the sender to remain online. |
| CAP-C13-A01-03 | A01 Functional | **0.1** | Shared copies preserve nodes, edges, containers, sections, geometry, appearance, and supported extensions. |
| CAP-C13-A09-01 | A09 Local-first | **0.1** | Creating a share link performs no upload and sends no graph content until the user explicitly transmits the link. |
| CAP-C13-A02-01 | A02 Usable | **0.1** | Share opens a labeled link preview with an explicit copy action and a manual fallback when clipboard access fails. |
| CAP-C13-A06-01 | A06 Durable | **0.1** | The share codec reads current compressed links and the documented legacy uncompressed format. |
| CAP-C13-A06-02 | A06 Durable | **0.1** | A graph too large for a reliable browser URL is rejected with a clear export-file alternative rather than a truncated link. |
| CAP-C13-A02-02 | A02 Usable | **0.1** | Sharing clearly means recipient-owned copy, not live collaboration or synchronized state. |

### C14 — Storage and history

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C14-A09-01 | A09 Local-first | **0.1** | Graph documents save automatically in the current browser without an account or runtime server. |
| CAP-C14-A02-01 | A02 Usable | **0.1** | A visible save state distinguishes saved, saving, memory-only, and failed persistence states. |
| CAP-C14-A06-01 | A06 Durable | **0.1** | Reload restores all graphs, their names and order, the active graph, and complete versioned graph snapshots. |
| CAP-C14-A06-02 | A06 Durable | **0.1** | Debounced saving and page-exit saving do not lose the latest accepted edit. |
| CAP-C14-A06-03 | A06 Durable | **0.1** | A rejected write is reported and never falsely described as saved. |
| CAP-C14-A06-04 | A06 Durable | **0.1** | A malformed primary save recovers the last valid backup, and the user can explicitly restore the previous browser save. |
| CAP-C14-A06-05 | A06 Durable | **0.1** | Per-graph bounded undo and redo restore complete document snapshots across ordinary edits, imports, and container changes. |
| CAP-C14-A06-06 | A06 Durable | **Later** | Every future schema change ships with explicit forward migration and corrupted-storage recovery for all supported older versions. |

### C15 — Onboarding and demos

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C15-A04-01 | A04 Releasable | **0.1** | A first-time visitor sees an in-app explanation of what Canvas Graph is and the shortest useful first journey. |
| CAP-C15-A02-01 | A02 Usable | **0.1** | The guide lets a visitor create a first node or open a meaningful example without prior product knowledge. |
| CAP-C15-A02-02 | A02 Usable | **0.1** | The Guide control always reopens onboarding after the automatic first visit. |
| CAP-C15-A06-01 | A06 Durable | **0.1** | Dismissing onboarding suppresses automatic reopening without making the guide unavailable. |
| CAP-C15-A01-01 | A01 Functional | **0.1** | Canonical C4, math, workflow, and expanded Game-design examples open as complete editable graphs; Game uses the vertical nested-list style across Narrative, Audio, Visuals, Game Design, and their detailed child topics. |
| CAP-C15-A04-02 | A04 Releasable | **0.1** | Canonical demo query routes open deterministic examples suitable for product links and smoke tests. |
| CAP-C15-A01-02 | A01 Functional | **0.1** | The onboarding workbench can preview a supported Mermaid source and requires confirmation before replacing work. |
| CAP-C15-A02-03 | A02 Usable | **0.1** | Onboarding copy uses product language and examples rather than contributor or architecture terminology. |
| CAP-C15-A02-04 | A02 Usable | **0.1** | Onboarding calls editable demonstrations examples or templates and reserves shape terms for node appearance. |
| CAP-C15-A02-05 | A02 Usable | **0.1** | Onboarding teaches the shortest pointer or touch journey as well as keyboard shortcuts, and every replacement warning is adjacent to the action that replaces work. |
| CAP-C15-A02-06 | A02 Usable | **0.1** | Guide typography, examples, warnings, source input, and primary actions form one restrained hierarchy that remains readable without any one element dominating the viewport. |
| CAP-C15-A07-01 | A07 Accessible | **0.1** | Guide headings, controls, examples, source input, and close action are labeled and keyboard reachable. |

### C16 — Renderer

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C16-A01-01 | A01 Functional | **0.1** | The release renderer draws nodes, edges, labels, containers, sections, selection, focus, and interaction overlays in coherent stacking order. |
| CAP-C16-A01-02 | A01 Functional | **0.1** | Edge labels remain attached and legible through pan, zoom, endpoint movement, and line crossings. |
| CAP-C16-A02-01 | A02 Usable | **0.1** | Semantic zoom favors readable titles over clipped descriptions at a far mobile overview. |
| CAP-C16-A05-01 | A05 Fast | **0.1** | Importing 10,000 nodes and more than 13,000 edges completes below 15 seconds in the CI scale probe without losing items. |
| CAP-C16-A05-02 | A05 Fast | **0.1** | At 10,000 nodes, viewport culling keeps rendered node DOM below 300 and a full draw below 500 ms in the CI scale probe. |
| CAP-C16-A05-03 | A05 Fast | **0.1** | Repeated item churn does not retain more than 50 MiB across the defined 200-create/delete heap probe. |
| CAP-C16-A03-01 | A03 Testable | **0.1** | Render performance exposes flush counts, timing, idle gaps, over-budget counts, and heap change to tests. |
| CAP-C16-A05-04 | A05 Fast | **Later** | An optional WebGPU stage can navigate very large geometry-only graphs and fall back safely when WebGPU is unavailable. |

### C17 — Test and DX harness

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C17-A03-01 | A03 Testable | **0.1** | Tests can boot the real application and run any registered command through one command-driven testkit. |
| CAP-C17-A03-02 | A03 Testable | **0.1** | Every user-visible state that can be wrong appears in the structured snapshot with an assertion expression. |
| CAP-C17-A03-03 | A03 Testable | **0.1** | Every graph mutation is an event that the recorder can capture and replay into a fresh boot. |
| CAP-C17-A03-04 | A03 Testable | **0.1** | One scenario contract can drive commands, events, and keys and assert snapshot paths, DOM, command metadata, files, and event traces. |
| CAP-C17-A03-05 | A03 Testable | **0.1** | A validated scenario can generate a runnable regression test without hand-translating the journey. |
| CAP-C17-A03-06 | A03 Testable | **0.1** | The unified journey contract can drive pointer, drag, resize, wheel, and multi-touch streams instead of leaving gesture-only journeys in a separate coverage hole. |
| CAP-C17-A03-07 | A03 Testable | **0.1** | The unified journey contract can request real-browser layout assertions for position, size, visibility, overlap, and viewport fit. |
| CAP-C17-A03-08 | A03 Testable | **0.1** | Every escaped bug receives a permanent command-driven or real-layout regression reproduction. |
| CAP-C17-A03-09 | A03 Testable | **0.1** | The command suite enforces at least 80% statements, functions, and lines for the included frontend coverage surface. |
| CAP-C17-A03-10 | A03 Testable | **0.1** | Every 0.1 capability ID maps to accepted automated evidence or an explicitly dated manual proof in the readiness ledger. |
| CAP-C17-A03-11 | A03 Testable | **0.1** | The release gate runs build, DX self-test, typecheck, performance gate, coverage suite, browser suite, and dependency audit from a clean checkout. |
| CAP-C17-A08-01 | A08 Extensible | **0.1** | App-aware tools enumerate commands and events, trace flows, localize owners, scaffold extensions, and run focused scenarios without manual code archaeology. |
| CAP-C17-A08-02 | A08 Extensible | **0.1** | The guarded local-model loop enforces red, green, verify, path allowlists, human approval, and a final clean gate before landing a fix. |
| CAP-C17-A08-03 | A08 Extensible | **0.1** | A repository tool validates Mission, Attribute, Component, Capability, and blocker references and generates an importable graph with a Mission root, folded Attribute containers, Component sections, addressable Capability nodes, source provenance, and blocker status. |
| CAP-C17-A08-04 | A08 Extensible | **0.1** | The generated requirements graph identifies itself as a projection, directs edits to the canonical Markdown source, blocks ordinary graph-mutation commands, and regenerates deterministically without losing addressable IDs. |
| CAP-C17-A08-05 | A08 Extensible | **0.1** | The canonical requirements source stores addressable evidence records with validated Capability, kind, state, proof locator, and acceptance date; generation derives accepted, missing, pending, rejected, stale, and not-required status without treating an absent record as success. |

### C18 — Plugin architecture

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C18-A08-01 | A08 Extensible | **0.1** | Systems, abilities, and features register through explicit boundaries and can be independently identified and inspected. |
| CAP-C18-A08-02 | A08 Extensible | **0.1** | Disabling any one registered system or ability removes its behavior and UI contribution without preventing the rest of the app from booting. |
| CAP-C18-A08-03 | A08 Extensible | **0.1** | An entity opts into an ability that contributes its metadata, commands, UI, and behavior atomically. |
| CAP-C18-A08-04 | A08 Extensible | **0.1** | Cross-system choreography lives in feature boundaries rather than hidden subscriptions to another system's requests. |
| CAP-C18-A08-05 | A08 Extensible | **0.1** | Data owners emit past-tense facts after mutations, while imperative events remain requests. |
| CAP-C18-A08-06 | A08 Extensible | **0.1** | Facts schedule scoped redraw automatically, and request handlers do not manually force render events. |
| CAP-C18-A08-07 | A08 Extensible | **0.1** | Every command, event listener, affordance, and panel contribution records its origin and tears down with that origin. |
| CAP-C18-A08-08 | A08 Extensible | **0.1** | Core assembly remains within the enforced 400-line and 14-context budgets. |
| CAP-C18-A08-09 | A08 Extensible | **0.1** | The model registry resolves entity and collection definitions live through enabled flags rather than hardcoded renderer branches. |
| CAP-C18-A03-01 | A03 Testable | **0.1** | A boot-time DX validator fails tests on architecture contract violations and reports actionable ownership. |

### C19 — Release artifact and site

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C19-A01-01 | A01 Functional | **0.1** | `npm run build` produces a self-contained static web application under `frontend/dist/`. |
| CAP-C19-A04-01 | A04 Releasable | **0.1** | 0.1 ships one supported static web artifact and does not claim npm or embeddable-library distribution. |
| CAP-C19-A04-02 | A04 Releasable | **0.1** | A potential user can open the product at one canonical public GitHub Pages HTTPS URL without repository access or local setup. |
| CAP-C19-A04-03 | A04 Releasable | **0.1** | The exact release artifact is deployed through the GitHub Pages release path and smoke-tested there for relative assets and the create, edit, connect, nest, reload, import, export, and share journeys. |
| CAP-C19-A04-04 | A04 Releasable | **0.1** | A clean checkout on a documented supported Node version passes the complete release gate. |
| CAP-C19-A04-05 | A04 Releasable | **0.1** | The release commit receives version 0.1.0 changelog dating, a `v0.1.0` tag, and a checksum for the published static archive. |
| CAP-C19-A04-06 | A04 Releasable | **0.1** | Public release material promises Chromium only, names the tested release version, and CI runs the matching desktop and touch-viewport Chromium checks. |
| CAP-C19-A04-07 | A04 Releasable | **0.1** | Source and distributed artifacts include Apache-2.0 license text and any required attribution or notice material. |
| CAP-C19-A04-08 | A04 Releasable | **0.1** | The release dependency audit reports no known vulnerabilities at moderate severity or higher. |
| CAP-C19-A04-09 | A04 Releasable | **0.1** | GitHub Pages serves relative assets, canonical metadata, demo query routes, and embedded-graph share query routes correctly from the configured project base path on a direct load. |
| CAP-C19-A09-01 | A09 Local-first | **0.1** | The deployed application requires no runtime backend for editing, persistence, import, export, demos, or link decoding. |
| CAP-C19-A08-01 | A08 Extensible | **Later** | The experimental embeddable library can ship as a documented, minified, source-mapped, versioned package with a stable API. |

### C20 — Product documentation and metadata

| ID | Attribute | Release | Capability |
|---|---|---|---|
| CAP-C20-A04-01 | A04 Releasable | **0.1** | Before the release commit is tagged or promoted, the owner-approved public product name replaces the working label consistently in page title, app chrome, files, downloads, release notes, and public links. |
| CAP-C20-A04-02 | A04 Releasable | **0.1** | Page title, description, public landing copy, and first-run guide state the same concise product mission. |
| CAP-C20-A02-01 | A02 Usable | **0.1** | End-user documentation explains the first graph, editing, connecting, nesting, navigation, local saving, recovery, import, export, and sharing. |
| CAP-C20-A02-02 | A02 Usable | **0.1** | Documentation explains that sharing creates a copy, URL size is limited, data is local by default, and no collaboration or account is provided. |
| CAP-C20-A02-03 | A02 Usable | **0.1** | Product copy uses one glossary for nodes, shapes, selection, examples, graph actions, and relationship actions across chrome, help, palette, navigator, inspectors, and notices. |
| CAP-C20-A04-03 | A04 Releasable | **0.1** | Public documentation states the canonical URL, version, supported browsers, license, and a support or issue-reporting route. |
| CAP-C20-A06-01 | A06 Durable | **0.1** | The changelog records user-visible 0.1 behavior and the release checklist remains reproducible from repository commands. |
| CAP-C20-A07-01 | A07 Accessible | **Later** | Published documentation includes a reviewed full keyboard reference and the product completes a documented screen-reader and WCAG conformance review. |

## Explicit 0.1 non-goals

The following must not be introduced as 0.1 blockers without an approved scope
change:

- accounts, cloud storage, server sync, comments, permissions, or live
  collaboration;
- npm publication or a supported embeddable-library API;
- the archived quest, learning, presentation, and other non-core experiments;
- WebGPU support or parity with the release DOM/SVG renderer;
- schema-v2 migration before a schema-v2 format change is proposed;
- a public debug, recorder, architecture, or performance workbench;
- Firefox or WebKit support; Chromium is the approved 0.1 browser family; and
- full WCAG conformance certification beyond the defined 0.1 accessibility
  baseline.

## Readiness evidence ledger

Evidence is sparse and explicit: add a row only for a real proof or a named
planned/rejected/stale proof. The generator derives `missing` for every 0.1
Capability without an accepted row, so absence cannot look like success.

- **Kind:** `automated`, `manual`, `decision`, or `release`.
- **State:** `accepted`, `pending`, `rejected`, or `stale`.
- Accepted rows require a `YYYY-MM-DD` acceptance date. Accepted automated rows
  use `tests/...#exact assertion` and the generator verifies that the file exists.
- One row proves one Capability. A single test may be cited by multiple rows
  when it independently proves multiple promises.

| Evidence ID | Capability | Kind | State | Proof locator | Accepted on | What it proves or still needs |
|---|---|---|---|---|---|---|
| EVD-001 | CAP-C17-A08-03 | automated | accepted | `tests/commands/requirements-graph.test.ts#maps every Capability into one Attribute container and Component section` | 2026-07-15 | The generator validates and deterministically projects the complete requirements model. |
| EVD-002 | CAP-C06-A02-02 | automated | accepted | `tests/commands/requirements-graph.test.ts#imports as a rendered Canvas Graph document with Attribute containers` | 2026-07-15 | The root opens, nested Attributes start folded, and opening a sibling preserves the exclusive reading policy. |
| EVD-003 | CAP-C17-A08-04 | automated | accepted | `tests/commands/requirements-graph.test.ts#imports as a rendered Canvas Graph document with Attribute containers` | 2026-07-15 | Generated requirements reject ordinary graph mutation commands. |
| EVD-004 | CAP-C02-A02-01 | automated | accepted | `tests/commands/requirements-graph.test.ts#searches human Capability prose and opens a result at readable scale` | 2026-07-15 | Navigator search indexes meaningful Capability prose. |
| EVD-005 | CAP-C08-A01-04 | automated | accepted | `tests/commands/requirements-graph.test.ts#searches human Capability prose and opens a result at readable scale` | 2026-07-15 | A search result reveals its ancestor and reaches a readable camera scale. |
| EVD-006 | CAP-C09-A02-03 | automated | accepted | `tests/commands/ui-layout-pass.test.ts#reserves readable space for long edge labels` | 2026-07-15 | Layout spacing budgets long relationship labels. |
| EVD-007 | CAP-C01-A02-07 | automated | accepted | `tests/commands/ui-layout-pass.test.ts#centres content in the canvas area not covered by the navigator` | 2026-07-15 | Requirements fitting uses the unobscured reading frame. |
| EVD-008 | CAP-C04-A01-06 | automated | pending | — | — | Add a real-layout assertion that every generated card exposes its complete normative prose without scroll or clipping. |
| EVD-009 | CAP-C17-A08-05 | automated | accepted | `tests/commands/requirements-graph.test.ts#maps every Capability into one Attribute container and Component section` | 2026-07-15 | Evidence records validate and generation derives per-Capability readiness state and aggregate coverage. |
| EVD-010 | CAP-C02-A02-06 | automated | accepted | `tests/commands/requirements-graph.test.ts#filters the review index by accepted evidence, Attribute, and Component without flattening hierarchy` | 2026-07-15 | Review filters compose while retaining Attribute grouping and human status labels. |
| EVD-011 | CAP-C14-A06-01 | automated | accepted | `tests/commands/io-persistence.test.ts#restores multiple graphs and the active graph id` | 2026-07-15 | A reload restores multiple complete graphs, the active graph ID, its name, and its document contents. |
| EVD-012 | CAP-C02-A02-03 | automated | accepted | `tests/commands/requirements-graph.test.ts#searches and top-aligns Component sections as jumpable navigator results` | 2026-07-15 | Component sections are individually searchable, unfold their Attribute path, select their container, and align to the top reading edge. |
| EVD-013 | CAP-C06-A02-01 | automated | accepted | `tests/commands/container-commands.test.ts#unfolds a collapsed container on double-click with maximize and minimize icons` | 2026-07-15 | Double-click unfolds a collapsed item and its toolbar icon changes from maximize to minimize. |
| EVD-014 | CAP-C08-A02-03 | automated | accepted | `tests/commands/view-camera.test.ts#fits a tall document no lower than 80% and lets its lower end continue off-screen` | 2026-07-15 | Oversized Fit holds the 80% floor, top-aligns the document, and deliberately leaves its lower end off-screen. |
| EVD-015 | CAP-C02-A02-01 | automated | accepted | `tests/commands/requirements-graph.test.ts#searches ordinary node descriptions in the graph navigator` | 2026-07-15 | Ordinary graph descriptions participate in navigator search and appear in the matching result. |
| EVD-016 | CAP-C04-A02-02 | automated | accepted | `tests/commands/node-commands.test.ts#offers fold only for described nodes and clears stale fold state with the description` | 2026-07-15 | Empty nodes cannot fold, described nodes can, and removing the description clears both the control and stale fold state. |
| EVD-017 | CAP-C04-A01-04 | automated | accepted | `tests/commands/node-visuals.test.ts#switches node shapes from the panel and renders markdown descriptions` | 2026-07-15 | Safe Markdown blocks and inline forms render as semantic DOM rather than literal syntax. |
| EVD-018 | CAP-C04-A01-06 | automated | accepted | `tests/commands/node-visuals.test.ts#switches node shapes from the panel and renders markdown descriptions` | 2026-07-15 | Editing a Markdown description recalculates the auto-sized node from rendered block geometry. |
| EVD-019 | CAP-C07-A02-02 | automated | accepted | `tests/release-hardening.spec.js#node, container, and edge selections remain unmistakable in grayscale` | 2026-07-15 | Strong node/container halos and a heavier edge stroke make selection visible across item kinds. |
| EVD-020 | CAP-C09-A01-01 | automated | accepted | `tests/commands/layout-styles.test.ts#lays out vertical, horizontal, tree, and radial grammars deterministically` | 2026-07-15 | All four release styles produce their distinct spatial grammar. |
| EVD-021 | CAP-C09-A01-04 | automated | accepted | `tests/commands/layout-styles.test.ts#lays out vertical, horizontal, tree, and radial grammars deterministically` | 2026-07-15 | Relationship depth becomes indentation, rows, levels, or distance from a stable radial hub. |
| EVD-022 | CAP-C09-A06-01 | automated | accepted | `tests/commands/layout-styles.test.ts#lays out vertical, horizontal, tree, and radial grammars deterministically` | 2026-07-15 | Reapplying every release layout returns byte-equal node positions. |
| EVD-023 | CAP-C09-A02-01 | automated | accepted | `tests/commands/layout-styles.test.ts#uses V/H/T/R as mode shortcuts and exposes the active style as a pressed control` | 2026-07-15 | Each style has a visible labeled control, pressed state, palette command, and direct shortcut. |
| EVD-024 | CAP-C09-A02-04 | automated | accepted | `tests/commands/layout-styles.test.ts#makes A advance a vertical list and Shift+A create its connected right branch` | 2026-07-15 | The actual keyboard stream creates the requested vertical next-item and nested-child outcomes. |
| EVD-025 | CAP-C09-A02-05 | automated | accepted | `tests/commands/layout-styles.test.ts#mirrors primary and branch creation for horizontal, tree, and radial modes` | 2026-07-15 | Horizontal, Tree, and Radial creation use their documented primary and branch directions. |
| EVD-026 | CAP-C09-A06-02 | automated | accepted | `tests/commands/layout-styles.test.ts#keeps each graph layout style in its snapshot and through duplication` | 2026-07-15 | Active layout is per-graph snapshot data, survives duplication, and restores after graph switching. |
| EVD-027 | CAP-C15-A01-01 | automated | accepted | `tests/commands/layout-styles.test.ts#opens the expanded Game graph as a readable vertical nested list` | 2026-07-15 | The editable 21-node Game example covers four disciplines and sixteen detailed topics without vertical overlap. |

## Current 0.1 blocker ledger

### Browser-preview UX audit — 2026-07-15

The local application was exercised in Chromium at desktop and 390 × 844 CSS
pixels. The journey covered every persistent command-bar button, graph
navigator actions, zoom and layout controls, node/container/edge actions and
editors, guide examples and Mermaid preview, help, palette search, theme, zen,
history, import, export, share, deletion confirmation, and representative empty,
selected, loading, invalid, destructive, and mobile states. Download behavior
that the preview host could not observe is not classified as broken.

| Finding | Severity | Browser evidence | Addressed by |
|---|---|---|---|
| UX-001 | Blocker | Renaming the current graph appears to work, then reverts to `Graph 3` after a normal rerender. | CAP-C02-A01-03 |
| UX-002 | Blocker | After connection and structure edits, viewport-anchored panels moved by about 68 pixels; the top bar became clipped off-screen and Fit did not restore it. | CAP-C01-A01-02, CAP-C08-A01-07 |
| UX-003 | Blocker | “Pick target node” occupies the same top region as the command bar and is visually absent on desktop and phone; only the letter badge remains visible. | CAP-C05-A02-02, CAP-C01-A02-07 |
| UX-004 | Blocker | At 390 pixels the primary command bar wraps to three rows and consumes the top of the stage instead of progressively disclosing secondary actions. | CAP-C01-A02-04 |
| UX-005 | Blocker | On phone, node-shape, layout, and viewport control groups share the bottom anchor; visible controls overlap while other focusable controls remain in the DOM. | CAP-C01-A02-07, CAP-C01-A07-04 |
| UX-006 | Blocker | Zen mode dims chrome without reclaiming its space and changes the camera to 100%, so the canvas is neither uncluttered nor stable. | CAP-C01-A02-03 |
| UX-007 | Blocker | Desktop node-shape and layout panels can occupy the same computed region even when only one appears visually, producing competing focus targets. | CAP-C01-A02-07, CAP-C01-A07-04 |
| UX-008 | Blocker | The red destructive “Delete graph” control renders as an unlabeled red rectangle although it retains an accessible name. The mobile Import close control can likewise disappear visually. | CAP-C01-A07-03 |
| UX-009 | Blocker | An edge editor is titled with raw ID `r1`; after Delete connection it remains open with live-looking Reverse and Delete actions. | CAP-C05-A01-07, CAP-C05-A02-03, CAP-C11-A01-03 |
| UX-010 | Blocker | The general edge inspector foregrounds system-specific Sync request, Async request, Read, Write, Performance, Semantics, and Observability fields not justified by the 0.1 graph mission. | CAP-C11-A01-01, CAP-C11-A02-04 |
| UX-011 | Blocker | The navigator lists nodes and edges but not containers or sections, leaving visible structure unsearchable and hard to revisit. | CAP-C02-A02-03 |
| UX-012 | Blocker | Navigator copy includes `1 edges`, duplicated endpoint fallback text, `square` while visible controls say Box, and a graph-local “No matching items” beside matches in other graphs. | CAP-C02-A02-03, CAP-C02-A02-04, CAP-C04-A02-01, CAP-C05-A02-03 |
| UX-013 | Blocker | The active graph has no direct visible Delete action, although non-active graph cards do; delete is available only after switching context or using the palette. | CAP-C02-A02-02 |
| UX-014 | Blocker | A single selected node exposes Group; choose-all anchors its item toolbar under the top command bar, partially hiding it. | CAP-C07-A02-02, CAP-C01-A02-07 |
| UX-015 | Blocker | Palette search for `pointer` yields a blank body with no explanation, low-level gesture phases are absent, and parallel Choose/Select aliases teach competing vocabulary. | CAP-C10-A02-04, CAP-C10-A02-05, CAP-C10-A03-02 |
| UX-016 | Blocker | Help is a keyboard-only shortcut list; it does not document pointer/touch phases and uses heavily bold action rows instead of a complete readable interaction catalog. | CAP-C10-A07-01, CAP-C15-A02-05 |
| UX-017 | Blocker | Fit enlarged a two-node graph to 200%; automatic layouts gave an empty container a dominant isolated region and reduced graph context. | CAP-C08-A02-03, CAP-C09-A02-02 |
| UX-018 | Blocker | Import-preview and container-structure explanatory text is nearly invisible in dark mode, while some selected borders and focus rings dominate the content. | CAP-C01-A07-03, CAP-C11-A07-02 |
| UX-019 | Blocker | Side-by-side/Stacked structure buttons communicate state visually but not with semantic pressed state. | CAP-C06-A07-02 |
| UX-020 | Blocker | Guide calls three graph examples “shapes,” teaches five keyboard keys but no touch/pointer first journey, and separates the replacement warning from each replacing action. | CAP-C15-A02-04, CAP-C15-A02-05 |
| UX-021 | 0.1 consistency | The guide headline, giant Preview import button, bold graph name, all-caps micro-labels, thick selection borders, and mixed text/icon toolbar actions compete for emphasis instead of expressing one hierarchy. | CAP-C01-A02-06, CAP-C15-A02-06 |
| UX-022 | 0.1 consistency | Icon-only history/theme/help/search controls, text actions, Unicode container controls, and abbreviated `Desc` use different visual and naming grammars; several desktop controls are only about 20–26 pixels high. | CAP-C01-A02-06, CAP-C01-A07-02 |
| UX-023 | 0.1 consistency | Node and container inspector titles look like static bold headers despite being editable, Close receives initial focus, and live-applied edits do not explain that no Save action is needed. | CAP-C11-A02-05, CAP-C11-A07-01 |
| UX-024 | 0.1 consistency | Export makes a large raw JSON textarea the default focal point and places browser-save recovery inside Export, obscuring the primary “choose a format” journey. | CAP-C12-A02-02 |
| UX-025 | Blocker | Redrawing tool panels—for example by opening mobile Actions—resets the visible zoom readout to `100%` while the camera remains at its prior scale. | CAP-C08-A01-07 |
| UX-026 | Blocker | At an 800-pixel desktop width, an expanded navigator pushes Help, Share, and Export outside the toolbar; on phone, an open Actions sheet can cover the Graphs control. | CAP-C01-A02-04, CAP-C01-A02-07, CAP-C01-A07-04 |
| UX-027 | 0.1 consistency | Light and dark themes use chromatic accents, multiple gradients, decorative boundaries, and state colors that conflict with a strict grayscale, graph-first surface. | CAP-C01-A02-05, CAP-C01-A07-03, CAP-C03-A02-02 |
| UX-028 | Blocker | The expanded navigator applies its 12-pixel inset twice and is clipped on the right; opening it also stretches the top command rail to fill every remaining pixel. | CAP-C01-A02-04, CAP-C01-A02-06, CAP-C01-A02-07 |
| UX-029 | Blocker | The empty invitation, first node, automatic layout, and Fit use different horizontal centres, so creating content makes the document jump off the stage centre. | CAP-C04-A01-01, CAP-C08-A01-03, CAP-C09-A01-03 |
| UX-030 | 0.1 consistency | The selected-item toolbar uses inflated padding and misaligned controls; editable titles mount full input boxes; modal and navigator dismissal uses the word Close instead of the common × glyph. | CAP-C01-A02-06, CAP-C01-A07-01, CAP-C11-A02-06 |
| UX-031 | Blocker | Pressing Enter to finish a title can leave keyboard ownership in the text editor, forcing an extra click or cancellation before A, Tab, X, and other shortcuts continue. | CAP-C11-A02-05, CAP-C10-A01-04 |
| UX-032 | Blocker | Creating, deleting, or nesting one item implicitly runs Tidy and rewrites unrelated node positions, making a stable composition visibly jump. | CAP-C09-A02-02, CAP-C09-A06-01 |
| UX-033 | 0.1 visibility | The explicit requirements model has no generated graph view, so Attributes, Component intersections, density, and unclear Capability copy cannot be reviewed through the product itself. | CAP-C17-A08-03 |
| UX-034 | Blocker | The expanded requirements map fits at 6%, reducing the entire contract to an unreadable silhouette; every Attribute is open and no overview-to-detail reading sequence exists. | CAP-C06-A02-02, CAP-C08-A01-04, CAP-C17-A08-03 |
| UX-035 | Blocker | The navigator flattens 215 requirement cards by entity kind and searches IDs/titles but not Capability sentences, so a human cannot browse the requirements hierarchy or find a remembered promise. | CAP-C02-A02-01, CAP-C02-A02-05 |
| UX-036 | Blocker | Opening a Capability from the navigator at 6% only pans the camera; it does not raise the card to a readable scale or reveal a folded ancestor. | CAP-C06-A02-02, CAP-C08-A01-04 |
| UX-037 | Blocker | Generated Capability cards use one 92-pixel height even when prose is longer, while auto-layout spacing budgets edge-label line count but not label width. | CAP-C04-A01-06, CAP-C09-A01-02, CAP-C09-A02-03 |
| UX-038 | Blocker | The imported projection looks like an ordinary editable graph and does not state its Markdown provenance or regeneration direction, allowing a convincing local fork of the requirements source. | CAP-C17-A08-04, CAP-C14-A06-01 |
| UX-039 | 0.1 visibility | Open blockers are stored below the requirement tables but absent from Capability cards, and the source contains no addressable evidence ledger despite requiring proof for every 0.1 Capability. | CAP-C17-A03-10, CAP-C17-A08-03 |
| UX-040 | Blocker | The compact contract overview is mathematically centred in the full stage while the open navigator overlays its left edge, hiding the requirements-root label and the beginning of the Mission card. | CAP-C01-A02-07, CAP-C08-A01-04 |
| UX-041 | 0.1 consistency | The generated read-only projection can still display layout, resize, section-resize, Undo, and Redo affordances that its command guard rejects, teaching actions that cannot succeed. | CAP-C10-A02-01, CAP-C17-A08-04 |
| UX-042 | Blocker | Requirements filters narrow the navigator but leave every canvas card at equal emphasis, so “3/15 shown” contradicts the visual projection and can be mistaken for a complete filtered result. | CAP-C02-A02-06 |
| UX-043 | Blocker | Selecting a filter opens its whole Attribute and fits the large container at 29%, leaving the matching Capability unreadable until another manual navigation action. | CAP-C02-A02-06, CAP-C08-A01-04 |
| UX-044 | Blocker | Reload can restore the requirements stage while leaving the navigator on its pre-restore render; Attribute rows appear only after a search or other redraw. | CAP-C02-A02-05, CAP-C14-A06-01 |
| UX-045 | Blocker | Expanding a tall Attribute fits its complete container at 17%, turning every Capability into an unreadable thumbnail even though the overview was readable. | CAP-C08-A01-04, CAP-C08-A02-03 |
| UX-046 | 0.1 consistency | A folded Attribute requires selecting its badge and using a floating triangle button; the common double-click-to-open journey is absent and triangle direction is less legible than maximize/minimize state. | CAP-C06-A02-01, CAP-C06-A07-01 |
| UX-047 | Blocker | Ordinary node descriptions do not participate in navigator search, while Component section titles are aggregated into container copy rather than exposed as addressable, jumpable results. | CAP-C02-A02-01, CAP-C02-A02-03, CAP-C02-A02-05 |
| UX-048 | Blocker | Empty nodes expose a meaningless fold action; a folded described node leaves its title at the former top slot above an empty body, and clearing the description can preserve a stale hidden fold state. | CAP-C04-A02-02 |
| UX-049 | Blocker | Node descriptions recognize only a narrow Markdown subset and auto-size from literal syntax characters instead of the rendered heading, list, quote, and code-block geometry. | CAP-C04-A01-04, CAP-C04-A01-06 |
| UX-050 | Blocker | Selection uses a thin low-contrast boundary, and nested items can lose the selected decoration entirely because canonical selection refs and rendered parent-qualified refs compare as different identities. | CAP-C01-A07-03, CAP-C07-A02-02, CAP-C16-A01-01 |

UX-001 through UX-050 are retained as the historical escape inventory. The
2026-07-15 implementation pass resolved them as a coherent interaction-system
change: fixed viewport-owned chrome, canvas-first disclosure, exclusive panels,
stable Zen/camera state, one public vocabulary, addressable graph structure,
task-focused inspectors, searchable gesture help, restrained visual hierarchy,
explicit empty/recovery states, and a generated requirements reading mode. Focused Chromium coverage exercises desktop,
800-pixel compact desktop, and 390 × 844 touch-sized layouts. BR-013 through
BR-040 plus BR-042 through BR-052 record the corresponding resolved
implementation blockers below; BR-041 remains open.

| Blocker | Kind | Capability | Current condition | Exit condition |
|---|---|---|---|---|
| BR-001 | decision | Whole draft | The proposed mission, Attributes, Components, and 0.1 markers are not yet owner-approved. | Owner approves this baseline or edits it to approval. |
| BR-002 | proof | CAP-C10-A02-01 | The owner approved the parity rule, but no accepted inventory proves visible-UI/palette parity for every 0.1 capability root. | Add the parity inventory/test and resolve every mismatch. |
| BR-003 | gap | CAP-C17-A03-06 | The repository roadmap identifies pointer-stream helpers for drag and resize as a remaining unified-test gap. | Drive pointer, wheel, resize, and multi-touch journeys through the shared scenario contract with regression coverage. |
| BR-004 | gap | CAP-C17-A03-07 | Real layout checks exist as bespoke Playwright tests, while the roadmap identifies a data-driven layout oracle as missing. | Add scenario-level real-layout assertions and migrate representative layout regressions to them. |
| BR-005 | proof | CAP-C19-A04-06 | Chromium-only is approved, but the exact tested release version and retained desktop/touch CI proof are not yet recorded in public release material. | Record the Chromium version used by the release gate and link its passing desktop and 390 × 844 results from the support statement. |
| BR-006 | gap | CAP-C19-A04-02, CAP-C19-A04-09 | GitHub Pages is approved, but no Pages workflow, base-path proof, or canonical HTTPS URL is configured or documented. | Deploy the release artifact to GitHub Pages and record the canonical URL with passing direct-route and share-link checks. |
| BR-007 | release-step | CAP-C19-A04-03 | Production-path smoke testing cannot be completed before the GitHub Pages target exists. | Smoke-test the exact artifact through the Pages release path and retain the result. |
| BR-010 | release-step | CAP-C20-A04-01 | “Canvas Graph” is intentionally a working label until the latest safe release step. | Before tagging or production promotion, choose the final name and update every enumerated public surface in one verified change. |
| BR-011 | release-step | CAP-C19-A04-05 | Changelog dating, tag, release archive, and checksum are intentionally pending final readiness. | Complete them from the accepted release commit. |
| BR-012 | gap | CAP-C19-A04-07 | Apache-2.0 is selected, but source and built artifacts do not yet contain the required license and attribution material. | Add and verify Apache-2.0 license/notice inclusion in source and distribution. |
| BR-041 | gap | CAP-C17-A03-10 | The evidence ledger and generated per-Capability states now exist, but only 25 of 212 release Capabilities have accepted proof; the remaining 187 are explicitly missing. | Map every 0.1 Capability to accepted automated evidence or a dated manual proof and keep every proof locator valid at the accepted release baseline. |

Resolved decisions and implementation blockers remain recorded so future audits
do not reopen them without new evidence:

| Resolved blocker | Resolution |
|---|---|
| BR-008 | Chromium-only is the approved 0.1 browser family. Exact release-version proof remains part of CAP-C19-A04-06 and BR-005. |
| BR-009 | Apache-2.0 is selected. The remaining file/distribution work is BR-012, not a license-choice question. |
| BR-013 | Graph names now update immediately, commit through one debounced rename fact, and survive redraw/reload paths. |
| BR-014 | The top rail is mounted in the viewport-owned Top place; camera transforms remain stage-only and snapshots locate each panel in its real place. |
| BR-015 | Connection mode has a named live prompt below the rail with full click/letter/cancel guidance on desktop and phone. |
| BR-016 | Mobile uses a one-row primary rail plus an exclusive Actions sheet; bottom contextual groups are mutually exclusive, and Zen hides chrome without changing the camera. |
| BR-017 | Controls use one text/icon grammar, visible destructive labels, restrained weight, theme-safe contrast, focus state, and at least 40-pixel phone targets. |
| BR-018 | Connections use labels or human endpoints, omit unrelated system metadata, and close their inspector when deleted. |
| BR-019 | The navigator addresses nodes, connections, containers, and sections with normalized names/counts, scoped empty states, and a current-graph Delete action. |
| BR-020 | Group appears only for a valid multi-selection, and multi-selection no longer mounts a misleading single-item toolbar. |
| BR-021 | Help and palette expose the registered gesture phases, use Select consistently, and provide an explanatory recoverable no-match state. |
| BR-022 | Fit is capped at a comfortable editing scale and layout compacts empty root containers before fitting. |
| BR-023 | The guide now teaches pointer/touch and keyboard journeys, calls examples graphs, places replacement consequences beside actions, and uses a restrained hierarchy. |
| BR-024 | Inspector toggles expose pressed state, support readable dark-theme guidance, make titles visibly editable, and explain immediate local saving. |
| BR-025 | Export leads with portable formats, raw JSON is secondary disclosure, and browser-save recovery lives in command search/history. |
| BR-026 | Zoom labels resynchronize from live camera state after panel, fold, selection, and disclosure redraws. |
| BR-027 | Compact desktop discloses editing actions when the navigator is open; mobile Actions temporarily removes the competing Graphs rail and restores it on close. |
| BR-028 | Both themes now resolve to grayscale tokens; all CSS gradients are removed, the grid uses a flat SVG line pattern, and state remains distinguishable by tone, text, weight, or pattern. |
| BR-029 | The navigator fills its one positioned shell without a nested inset, while the expanded-nav command rail retains intrinsic width and centres in the remaining desktop lane. |
| BR-030 | First-node placement and every post-creation fit use the exact stage centre; automatic creation paths coalesce layout before one centred fit. |
| BR-031 | The item toolbar uses aligned 26-pixel desktop controls in a 32-pixel surface, text fields reveal one underline, and modal/navigator dismissal uses an accessible × control. |
| BR-032 | Enter exits both inline and inspector title capture; inline editing returns focus to the selected graph item so the next keyboard command runs immediately. |
| BR-033 | Mutation-time implicit Tidy is removed; creation retains centred Fit without changing existing positions, deletion preserves positions and camera, and section edits reflow only their own container. |
| BR-034 | `npm run requirements:graph` validates the requirements tables and emits an importable map with Attribute containers, Component sections, definition cards, and every Capability node. |
| BR-035 | The generated first frame is an open Mission root with nine folded Attribute containers; opening one Attribute folds its siblings and frames that Attribute for reading. |
| BR-036 | The requirements navigator preserves Attribute groups, searches complete Capability prose, shows human snippets and blocker state, and reveals the ancestor path of a result. |
| BR-037 | Item navigation raises overview-scale cards to a readable working scale while still fitting oversized containers down safely. |
| BR-038 | Generated cards derive height from their actual prose, descriptions can use the available card height, and layout spacing budgets both edge-label height and width. |
| BR-039 | Mission, provenance, regeneration direction, release legend, and open blocker conditions are encoded in the graph; the missing evidence model is exposed rather than implied complete. |
| BR-040 | Generated requirements projections remove ordinary mutation controls and reject mutation commands with a source-directed notice, preventing silent local edits from masquerading as canonical requirements changes. |
| BR-042 | Fit and item reveal centre content inside an obstruction-aware safe frame, so an open navigator cannot cover the contract label, Mission, or selected requirement. |
| BR-043 | Generated projections hide layout, resize, section-resize, Undo, and Redo controls in addition to rejecting their commands, leaving only reading and document-management affordances visible. |
| BR-044 | Active requirements filters keep matching Capability cards prominent and dim unmatched canvas context, while the navigator states that visual behavior and retains filtered Attribute counts. |
| BR-045 | With a specific Attribute filter, each filter change frames the first matching Capability at a 90% reading scale after opening and laying out the Attribute. |
| BR-046 | Browser-save restoration emits the same active-graph fact as an interactive graph switch, so the stage, generated-view policy, and complete nine-Attribute navigator redraw from restored data before user input. |
| BR-047 | Complete Fit and item reveal keep an 80% minimum reading scale; only bounds that fit above that floor remain centred, while tall bounds align to the top-centre and wide bounds keep their leading edge clear of chrome as their far edge continues off-screen. |
| BR-048 | Folded items unfold directly on double-click, collapsed controls display maximize, expanded controls display minimize, and title editing resumes only after the item is open. |
| BR-049 | Navigator search includes ordinary descriptions plus Attribute/Component names, exposes Component sections as distinct hierarchy rows, and opens a section at the top reading edge without dimming the matched canvas content. |
| BR-050 | Node fold disclosure is description-dependent, clearing the description clears stale fold state, and a folded node uses title-only visual bounds with its title centred while retaining expanded graph data. |
| BR-051 | The safe Markdown renderer supports headings, paragraphs, emphasis, links, lists, quotes, rules, inline code, and fenced code; auto-size measures the same parsed blocks after each content edit. |
| BR-052 | Selection decorations match canonical item identity across parent-qualified render refs, with strong grayscale halos for nodes/containers and a heavier selected-edge stroke. |
| BR-053 | Layout is an explicit per-graph style rather than a one-off coordinate command: Vertical, Horizontal, Tree, and Radial each expose an active control, palette entry, shortcut, deterministic arrangement, and style-specific A / Shift+A creation grammar. |
| BR-054 | The canonical Game example opens as an expanded 21-node vertical nested list covering Narrative, Audio, Visuals, Game Design, and sixteen detailed child topics. |

After approval, every re-audit must update this ledger against the fixed 0.1
rows. A new finding may become a blocker only by naming an existing 0.1
capability or by first receiving approval as a requirements change.

## Review questions

1. Do you approve this enriched 0.1 contract and blocker ledger as the fixed bar
   for the remaining implementation and release work?
2. Do you approve the canvas-first default on desktop as well as phone: show the
   current graph name and Graphs affordance, but open the full navigator only on
   request?
