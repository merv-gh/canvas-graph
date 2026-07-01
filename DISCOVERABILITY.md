# Discoverability & First Impressions

Foundational UX features — the seams every visible affordance rides.
Track with objective metrics where possible.

## Metrics

| Metric | Measure | Goal | Status |
|--------|---------|------|--------|
| Time-to-first-node | From page load to first node on canvas | < 3s | Untracked |
| Keystrokes-to-first-edge | From page load to first connected edge | ≤ 4 keys | Untracked |
| Key discovery rate | % of toolbar buttons whose shortcut a user can name after 2 min | > 50% | Untracked |
| Edge-kind recognition | % of users who correctly identify async-vs-sync edges at a glance | > 80% | Partial — CSS done, visual testing missing |
| Panel visibility score | Number of actions a user performs without seeing any affordance | 0 in first 2 min | Untracked |
| Empty-state dismissal | % of first sessions where the onboarding hint is seen | > 90% | Hints not yet built |

## Done

- [x] Dot-grid background on stage (orientation in pan/zoom)
- [x] Node hover effect (cursor:pointer + accent border on hover)
- [x] Edge cursor:pointer on hit area
- [x] Toolbar button title tooltips with keyboard shortcuts
- [x] Item toolbar glyph tooltips (▾→Collapse, ⚙→Properties, ⋯→More)
- [x] Edge label no longer defaults to EdgeKind (no more "sync" noise)
- [x] Node-enter keyframe animation re-enabled
- [x] Grid placement for initial nodes (centered, not single column)

## To build

### Navigation / orientation
- [ ] **Minimap panel** — small bottom-corner overview of full graph bounds with viewport rectangle.  
  *Feasibility*: iterate hierarchy targets, project to minimap scale, render `<canvas>` or scaled `<svg>`.
  *Metric*: "Where am I?" accuracy test — show a viewport + graph state, ask user to click on the corresponding corner of the minimap.
- [ ] **Graph title / breadcrumb** — current graph name in the toolbar.  
  *Metric*: From any graph, name it in ≤ 1 look.

### Onboarding
- [ ] **First-use hint bar** — "Press A to create a node, E for an edge, Z to fit all, G then letter to jump."  
  Appears on empty-canvas boot, dismissed on first action, always available from palette.  
  *Metric*: 80% of users recall at least 3 key shortcuts after seeing the bar once (measured by recorded session).
- [ ] **Affordance peek on hover** — hovering a node shows a faint shortcut hint next to the cursor.  
  *Metric*: Users perform at least one keyboard shortcut during their first session where the peek was visible.
- [ ] **Empty-state search** — empty canvas shows "Search or press A to start" with a focused search input.  
  *Metric*: ≥ 30% of first sessions with 0 nodes use the search as the first interaction.

### Feedback
- [ ] **Undo toast** — "Undo \[action\] (Ctrl+Z)" appears briefly after mutations. Undo not yet implemented, but the toast surface is the seam.  
  *Metric*: Toast visible within 200ms of mutation, gone within 3s.
- [ ] **Action confirmation sound / haptic** — subtle audio pulse or console-style click on command dispatch (off by default, opt-in).  
  *Metric*: Accessibility — screen-reader already announces via aria-live; supplement for keyboard users.

### Visual language
- [ ] **Node type emoji / icon** — each NodeType maps to a small emoji or SVG icon rendered in the top-left of the card.  
  "text", "square", "circle" default to empty; "database" → 🗄, "service" → ⚙, "cache" → ⚡.  
  *Metric*: In a graph with 3+ node types, users identify each in ≤ 1s (eye-track).
- [ ] **Connection anchors** — small circles on node edges where edges attach. Visible on hover/select.  
  *Metric*: Edge-creation error rate (wrong endpoint) drops by > 50%.
- [ ] **Edge arrowhead scales with zoom** — already non-scaling-stroke. Verify arrowhead isn't enormous at high zoom.
- [ ] **Layout animation** — tidy/grid/radial layouts animate node positions (CSS transition already in place for drag; apply to layout too).

## Notes

- All toolbar button shortcuts are now discoverable via `title` tooltips on hover.
- The dot-grid background scales with zoom (`background-size: var(--grid-size)` driven by the camera).
- Node placement now spreads in a 3-column grid from viewport center instead of a narrow column.
- The `commandShortcut` function is available to any system for rendering shortcut hints.
- The `title` attribute pattern in `item-toolbar.ts:buildButton` can be reused for any floated affordance.
- The `EntityRenderer.collect` hook (types.ts) is the seam for minimap data gathering — iterate hierarchy targets without DOM.
