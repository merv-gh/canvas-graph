var GraphViewer = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region frontend/styles.css?inline
	var styles_default = "/* Design tokens. Names mirror Tailwind's neutral-* / blue-* so migration is a search-and-replace.\n   Anything visual should derive from these — DO NOT hardcode colors below. */\n:root {\n  --bg: rgb(250, 250, 249);\n  --panel: #ffffff;\n  --panel-2: #f5f5f4;\n  --ink: #1c1c1c;\n  --text-muted: #6b7280;\n  --line: #e5e5e3;\n  --line-strong: #d4d4d2;\n  --accent: rgb(37, 99, 235);\n  --accent-soft: rgba(37, 99, 235, .08);\n  --edge: #4b5563;\n  --danger: #dc2626;\n  --danger-soft: rgba(220, 38, 38, .06);\n  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);\n  --shadow-md: 0 6px 18px rgba(0,0,0,.06);\n  --radius: 6px;\n  --radius-lg: 10px;\n\n  /* Spacing scale — 8px rhythm */\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 12px;\n  --space-4: 16px;\n  --space-5: 24px;\n  --space-6: 32px;\n\n  /* Animation tokens */\n  --duration-fast: .12s;\n  --duration-normal: .18s;\n  --duration-slow: .25s;\n  --ease-default: ease-out;\n\n  /* Semantic aliases */\n  --border: var(--line);\n\n  color-scheme: light dark;\n}\n\n/* Auto dark from OS preference (no explicit theme choice yet) */\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    --bg: rgb(17, 17, 16);\n    --panel: #1c1c1b;\n    --panel-2: #282826;\n    --ink: #eeedec;\n    --text-muted: #8b919a;\n    --line: #333331;\n    --line-strong: #444442;\n    --accent: rgb(96, 148, 248);\n    --accent-soft: rgba(96,148,248,.12);\n    --edge: #8b919a;\n    --danger: #f87171;\n    --danger-soft: rgba(248,113,113,.10);\n    --shadow-sm: 0 1px 2px rgba(0,0,0,.25);\n    --shadow-md: 0 6px 18px rgba(0,0,0,.35);\n  }\n}\n\n/* Explicit dark (JS toggle wins over media query via specificity on .shell) */\n.shell[data-theme=\"dark\"] {\n  --bg: rgb(17, 17, 16);\n  --panel: #1c1c1b;\n  --panel-2: #282826;\n  --ink: #eeedec;\n  --text-muted: #8b919a;\n  --line: #333331;\n  --line-strong: #444442;\n  --accent: rgb(96, 148, 248);\n  --accent-soft: rgba(96,148,248,.12);\n  --edge: #8b919a;\n  --danger: #f87171;\n  --danger-soft: rgba(248,113,113,.10);\n  --shadow-sm: 0 1px 2px rgba(0,0,0,.25);\n  --shadow-md: 0 6px 18px rgba(0,0,0,.35);\n}\n\n/* Explicit light (when OS is dark but user chose light) */\n.shell[data-theme=\"light\"] {\n  --bg: rgb(250, 250, 249);\n  --panel: #ffffff;\n  --panel-2: #f5f5f4;\n  --ink: #1c1c1c;\n  --text-muted: #6b7280;\n  --line: #e5e5e3;\n  --line-strong: #d4d4d2;\n  --accent: rgb(37, 99, 235);\n  --accent-soft: rgba(37,99,235,.08);\n  --edge: #4b5563;\n  --danger: #dc2626;\n  --danger-soft: rgba(220,38,38,.06);\n  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);\n  --shadow-md: 0 6px 18px rgba(0,0,0,.06);\n}\n\n/* Dark-mode overrides for hardcoded light color-mix() values */\n.shell[data-theme=\"dark\"] .node-type-square {\n  background: color-mix(in srgb, var(--panel) 88%, #1e3a5f);\n}\n.shell[data-theme=\"dark\"] .node-type-circle {\n  background: color-mix(in srgb, var(--panel) 86%, #1a3a2a);\n}\n.shell[data-theme=\"dark\"] .tool-panel {\n  background: color-mix(in srgb, var(--panel) 94%, transparent);\n}\n.shell[data-theme=\"dark\"] .backdrop {\n  background: rgba(0,0,0,.45);\n}\n.shell[data-theme=\"dark\"] .container {\n  background: rgba(255,255,255,.02);\n}\n.shell[data-theme=\"dark\"] .container:hover {\n  background: rgba(96,148,248,.06);\n}\n.shell[data-theme=\"dark\"] .container.selected {\n  background: rgba(96,148,248,.08);\n}\n.shell[data-theme=\"dark\"] .container.manual {\n  background: rgba(96,148,248,.06);\n}\n.shell[data-theme=\"dark\"] .scenario-hud {\n  background: var(--ink);\n  color: var(--bg);\n}\n\n* { box-sizing: border-box; }\n\n/* Consistent focus ring across all interactive elements.\n   Keep :focus on inputs that auto-focus on modal open (palette, form fields). */\n*:focus-visible {\n  outline: 2px solid var(--accent);\n  outline-offset: 2px;\n}\n\n/* Reduced motion — respect OS preference */\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n\nbody { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); font: 14px/1.4 system-ui, sans-serif; }\n\n/* --- Keyframes --- */\n@keyframes node-enter {\n  from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }\n}\n@keyframes modal-enter {\n  from { opacity: 0; }\n}\n@keyframes modal-slide {\n  from { opacity: 0; transform: translateX(-50%) translateY(-6px); }\n}\n\n/* Buttons: ghost by default. Visible only on hover/focus. Borders disappear; weight comes from text.\n   Add .primary for accent treatment; .icon for square icon-only buttons. */\nbutton {\n  border: 1px solid transparent;\n  background: transparent;\n  color: var(--ink);\n  border-radius: var(--radius);\n  padding: 5px 10px;\n  font: inherit;\n  cursor: pointer;\n  line-height: 1.2;\n  transition: background-color var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);\n}\nbutton:hover { background: var(--panel-2); }\nbutton.primary { color: var(--accent); }\nbutton.primary:hover { background: var(--accent-soft); }\nbutton.danger { color: var(--danger); }\nbutton.danger:hover { background: var(--danger-soft); }\nbutton.icon { padding: 4px 7px; min-width: 26px; color: var(--text-muted); }\nbutton.icon:hover { color: var(--ink); }\n\n.shell { display: grid; grid-template: 0 1fr / 1fr; height: 100vh; transition: grid-template-rows var(--duration-fast) var(--ease-default); }\n.shell[data-top-folded=\"true\"] { grid-template-rows: 0 1fr; }\n.shell[data-top-folded=\"true\"] .top { display: none; }\n/* Zen mode — distraction-free canvas. Every floating tool panel fades to\n * semi-transparent (still there, just quiet) and stays that way until an\n * explicit exit (`\\` or Escape); hover a panel to bring it back to full.\n * Clean screenshots without losing the controls entirely. */\n.shell[data-zen=\"true\"] { grid-template: 0 1fr / 1fr; }\n.shell[data-zen=\"true\"] .top { display: none; }\n.shell[data-zen=\"true\"] .tool-panel {\n  opacity: 0.12;\n  transition: opacity var(--duration-fast) var(--ease-default);\n}\n.shell[data-zen=\"true\"] .tool-panel:hover { opacity: 1; }\n.hamburger { font-size: 16px; line-height: 1; padding: 2px 8px; margin-right: 4px; }\n\n/* --- Debug toolbar group --- */\n.toolbar button[data-command^=\"debug.\"] { font-size: 12px; padding: 4px 8px; }\n.toolbar button[data-command=\"debug.record.start\"] { color: var(--danger); }\n.toolbar button[data-command=\"debug.record.start\"]:hover { background: var(--danger-soft); }\n.toolbar button[data-command=\"debug.assert.open\"] { color: var(--accent); }\n\n/* --- Assert modal split layout --- */\n.debug-assert {\n  display: grid;\n  grid-template-columns: minmax(280px, 1fr) minmax(360px, 1.2fr);\n  gap: 14px;\n  width: min(1100px, calc(100vw - 80px));\n  height: min(640px, calc(100vh - 160px));\n}\n.debug-state { display: flex; flex-direction: column; gap: 8px; min-height: 0; }\n.debug-search {\n  padding: 6px 10px;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  background: var(--panel);\n  font: 12px ui-monospace, monospace;\n}\n.debug-search:focus-visible { outline: 2px solid var(--accent); border-color: var(--accent); }\n.debug-tree {\n  flex: 1;\n  overflow: auto;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  background: var(--panel);\n  padding: 6px 4px;\n  font: 12px ui-monospace, monospace;\n}\n.debug-tree-row {\n  display: flex; align-items: center; gap: 6px;\n  padding: 2px 6px;\n  border-radius: 4px;\n}\n.debug-tree-row:hover { background: var(--panel-2); }\n.debug-tree-row[class*=\"depth-\"] { padding-left: calc(6px + var(--depth, 0) * 10px); }\n.debug-tree-row.depth-1 { padding-left: 16px; }\n.debug-tree-row.depth-2 { padding-left: 26px; }\n.debug-tree-row.depth-3 { padding-left: 36px; }\n.debug-tree-row.depth-4 { padding-left: 46px; }\n.debug-tree-row.depth-5 { padding-left: 56px; }\n.debug-tree-row.depth-6 { padding-left: 66px; }\n.debug-tree-row.depth-7 { padding-left: 76px; }\n.debug-tree-row.depth-8 { padding-left: 86px; }\n.debug-tree-row.depth-9 { padding-left: 96px; }\n.debug-tree-label { color: var(--text-muted); min-width: 80px; }\n.debug-tree-summary { color: var(--text-muted); opacity: 0.7; }\n.debug-tree-value {\n  border: 1px solid transparent;\n  background: transparent;\n  padding: 1px 6px;\n  border-radius: 4px;\n  color: var(--ink);\n  font: 12px ui-monospace, monospace;\n  cursor: pointer;\n  text-align: left;\n}\n.debug-tree-value:hover { border-color: var(--accent); background: var(--accent-soft); }\n.debug-tree-array { color: var(--accent); }\n.debug-tree-empty {\n  padding: 14px;\n  color: var(--text-muted);\n  text-align: center;\n}\n\n/* --- Test panel --- */\n.debug-test { display: flex; flex-direction: column; gap: 8px; min-height: 0; }\n.debug-test-head { display: flex; align-items: center; justify-content: space-between; }\n.debug-code {\n  flex: 1;\n  font: 12px/1.5 ui-monospace, monospace;\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 10px;\n  resize: none;\n  white-space: pre;\n  overflow: auto;\n  color: var(--ink);\n}\n.debug-code:focus-visible { border-color: var(--accent); outline: 2px solid var(--accent); }\n.debug-actions { display: flex; gap: 6px; }\n.debug-actions button { border: 1px solid var(--line); padding: 5px 12px; }\n.debug-actions button.primary { border-color: var(--accent); color: var(--accent); }\n\n/* --- Replay modal --- */\n.debug-replay { display: flex; flex-direction: column; gap: 10px; min-width: 560px; }\n.debug-replay-hint { margin: 0; color: var(--text-muted); font-size: 12.5px; }\n.debug-replay textarea {\n  min-height: 320px;\n  resize: vertical;\n  font: 12px/1.4 ui-monospace, monospace;\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 10px;\n}\n.top {\n  grid-column: 1 / -1;\n  grid-row: 1;\n  display: none;\n}\n.toolbar { display: flex; align-items: center; gap: 2px; width: 100%; }\n.toolbar button { white-space: nowrap; font-size: 13px; }\n.toolbar-spacer { flex: 1; }\n.toolbar-start, .toolbar-end { display: flex; align-items: center; gap: 2px; }\n/* Related actions cluster into a group with a light divider between clusters,\n   so \"graph editing\" and \"layout\" read as distinct units in the top bar. */\n.tool-group { display: flex; align-items: center; gap: 2px; padding-right: 6px; margin-right: 4px; border-right: 1px solid var(--line); }\n.tool-group:last-child { border-right: 0; padding-right: 0; margin-right: 0; }\n.toolbar-end button[data-command=\"palette.open\"] { font-size: 15px; padding: 3px 8px; }\n\n\n/* Left panel — floating tool-panel positioned over the stage with screen-edge\n   margins. Not a grid column, so flushing it doesn't destroy stage content. */\n.left {\n  position: absolute;\n  left: var(--space-3);\n  top: var(--space-3);\n  bottom: var(--space-3);\n  width: 260px;\n  max-height: calc(100vh - var(--space-6));\n  z-index: 10;\n  overflow: hidden;\n  pointer-events: auto;\n}\n.left[data-outline-folded=\"true\"] {\n  width: auto;\n  min-width: 42px;\n}\n/* The outline-panel wrapper lives inside .left — the place slot is the raw\n   .left element; the tool-panel chrome (header, body, fold button) is the\n   outline's own renderable. */\n.outline-panel {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-lg);\n  box-shadow: var(--shadow-sm);\n}\n.outline-panel-head {\n  display: flex;\n  align-items: center;\n  gap: var(--space-1);\n  padding: var(--space-2) var(--space-3);\n  border-bottom: 1px solid var(--line);\n  flex: 0 0 auto;\n}\n.outline-panel-body {\n  flex: 1 1 auto;\n  overflow: auto;\n  padding: var(--space-2);\n}\n.outline-panel[data-outline-folded=\"true\"] .outline-panel-body { display: none; }\n.outline-panel[data-outline-folded=\"true\"] .outline-panel-head { border-bottom: 0; }\n\n.stage {\n  grid-column: 1;\n  grid-row: 2;\n  --grid-size: 32px;\n  --grid-x: 0px;\n  --grid-y: 0px;\n  position: relative;\n  overflow: hidden;\n  background-color: var(--bg);\n  background-image: radial-gradient(circle, var(--line) .5px, transparent .5px);\n  background-size: var(--grid-size);\n  cursor: grab;\n  touch-action: none;\n}\n.stage.panning { cursor: grabbing; }\n.tool-panel {\n  position: absolute;\n  z-index: 12;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  max-width: min(920px, calc(100% - 24px));\n  min-height: 34px;\n  padding: 4px;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  background: color-mix(in srgb, var(--panel) 94%, transparent);\n  box-shadow: var(--shadow-sm);\n  pointer-events: auto;\n}\n.tool-panel[data-collapsed=\"true\"] {\n  width: auto;\n  min-width: 62px;\n}\n.tool-panel-head {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  flex: 0 0 auto;\n  border-right: 1px solid var(--line);\n  padding-right: 4px;\n}\n.tool-panel[data-collapsed=\"true\"] .tool-panel-head {\n  border-right: 0;\n  padding-right: 0;\n}\n.tool-panel-drag,\n.tool-panel-collapse {\n  min-width: 24px;\n  padding: 3px 6px;\n  color: var(--text-muted);\n}\n.tool-panel-drag { cursor: grab; }\n.tool-panel-drag:active { cursor: grabbing; }\n.tool-panel .toolbar {\n  min-width: 0;\n  overflow: auto hidden;\n  scrollbar-width: none;\n}\n.tool-panel .toolbar::-webkit-scrollbar { display: none; }\n/* Resting position for panels the user has not dragged (drag sets inline left/top). */\n.tool-panel[data-anchor=\"top-left\"] { left: 12px; top: 12px; }\n.tool-panel[data-anchor=\"top-center\"] { left: 50%; top: 12px; transform: translateX(-50%); }\n.tool-panel[data-anchor=\"top-right\"] { right: 12px; top: 12px; }\n.tool-panel[data-anchor=\"middle-right\"] { right: 12px; top: 50%; transform: translateY(-50%); }\n.tool-panel[data-anchor=\"bottom-left\"] { left: 12px; bottom: 12px; }\n.tool-panel[data-anchor=\"bottom-right\"] { right: 12px; bottom: 12px; }\n\n/* Outline panel — sits on the left side like the old aside, but as a floating\n   tool-panel with screen-edge margins. Scrolls internally; collapses via its\n   own fold button in the header. */\n.outline-panel {\n  position: absolute;\n  left: var(--space-3);\n  top: var(--space-3);\n  bottom: var(--space-3);\n  width: 260px;\n  max-height: calc(100vh - var(--space-6));\n  display: flex;\n  flex-direction: column;\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-lg);\n  box-shadow: var(--shadow-sm);\n  z-index: 10;\n  overflow: hidden;\n}\n.outline-panel-head {\n  display: flex;\n  align-items: center;\n  gap: var(--space-1);\n  padding: var(--space-2) var(--space-3);\n  border-bottom: 1px solid var(--line);\n  flex: 0 0 auto;\n}\n.outline-panel-body {\n  flex: 1 1 auto;\n  overflow: auto;\n  padding: var(--space-2);\n}\n.outline-panel[data-outline-folded=\"true\"] {\n  width: auto;\n  min-width: 42px;\n}\n.outline-panel[data-outline-folded=\"true\"] .outline-panel-body { display: none; }\n.outline-panel[data-outline-folded=\"true\"] .outline-panel-head { border-bottom: 0; }\n/* Stack panels lay their buttons in a column under the drag/collapse head. */\n.tool-panel-stack { flex-direction: column; align-items: stretch; }\n.tool-panel-stack .tool-panel-head { border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 4px; justify-content: flex-end; }\n.tool-panel-stack[data-collapsed=\"true\"] .tool-panel-head { border-bottom: 0; padding: 0; }\n.tool-panel-body { display: flex; gap: 4px; }\n.tool-panel-stack .tool-panel-body { flex-direction: column; }\n.tool-panel[data-panel-id=\"system-design\"] {\n  width: 140px;\n  max-width: 140px;\n}\n.tool-panel[data-panel-id=\"system-design\"] .tool-panel-body {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 4px;\n}\n.design-palette-button {\n  min-width: 0;\n  height: 28px;\n  padding: 0 5px;\n  border: 1px solid var(--line);\n  background: var(--panel);\n  font-size: 11px;\n  white-space: nowrap;\n}\n.design-palette-button:hover { border-color: var(--accent); }\n.design-node-database { color: #0369a1; }\n.design-node-kafka { color: #7c3aed; }\n.design-node-service { color: #0f766e; }\n.design-node-index { color: #b45309; }\n.design-node-user-input { color: #be123c; }\n.design-node-gateway { color: #4338ca; }\n.design-node-cache { color: #15803d; }\n.design-node-rate-limit { color: #dc2626; }\n.design-node-circuit-breaker { color: #7c2d12; }\n.design-edge-async { border-style: dashed; }\n.design-edge-read { color: #0369a1; }\n.design-edge-write { color: #b45309; }\n.node-type-panel {\n  gap: 3px;\n  max-width: none;\n}\n.node-type-button {\n  min-width: 44px;\n  height: 26px;\n  padding: 0 8px;\n  border-radius: 5px;\n  font-size: 12px;\n}\n.node-type-button.active {\n  background: var(--accent);\n  border-color: var(--accent);\n  color: white;\n}\n.keyboard-capture {\n  position: fixed;\n  width: 1px;\n  height: 1px;\n  opacity: 0;\n  pointer-events: none;\n}\n.stage::before {\n  content: \"\";\n  position: absolute;\n  inset: 0;\n  background-image:\n    linear-gradient(var(--line) 1px, transparent 1px),\n    linear-gradient(90deg, var(--line) 1px, transparent 1px);\n  background-position: var(--grid-x) var(--grid-y);\n  background-size: var(--grid-size) var(--grid-size);\n  opacity: .35;\n}\n\n/* Nodes: lighter card with subtle border and a small drop shadow only on hover/selected. */\n.nodes { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }\n.edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }\n.edges line { vector-effect: non-scaling-stroke; }\n.edges .edge-hit { stroke: var(--ink); stroke-opacity: .001; stroke-width: 14px; opacity: 1; pointer-events: stroke; cursor: pointer; }\n.edges .edge-hit:focus, .edges .edge-hit:focus-visible { outline: none; }\n.edges .edge-line { stroke: var(--edge); stroke-width: 2px; opacity: .9; pointer-events: none; }\n.edges .edge-line.selected { stroke: var(--accent); stroke-width: 2px; }\n.edges .edge-line.focused { stroke: var(--accent); stroke-dasharray: 4 3; }\n.edges .edge-line.edge-kind-read { stroke: #0369a1; }\n.edges .edge-line.edge-kind-write { stroke: #b45309; }\n.edges .edge-line.edge-kind-sync { stroke: #4b5563; }\n.edges .edge-line.edge-kind-async { stroke: #7c3aed; stroke-dasharray: 7 5; }\n.edges #edge-arrow path { fill: var(--edge); }\n.edges .edge-label { fill: var(--text-muted); font: 11px ui-monospace, monospace; }\n.edges .edge-label.edge-kind-read { fill: #0369a1; }\n.edges .edge-label.edge-kind-write { fill: #92400e; }\n.edges .edge-label.edge-kind-async { fill: #6d28d9; }\n.item-overlays { position: absolute; inset: 0; pointer-events: none; z-index: 5; }\n.item-overlay {\n  position: absolute;\n  transform: translate(-50%, -140%);\n  padding: 1px 5px;\n  border: 1px solid var(--accent);\n  border-radius: 4px;\n  background: var(--panel);\n  color: var(--ink);\n  box-shadow: var(--shadow-sm);\n  font: 11px ui-monospace, monospace;\n  white-space: nowrap;\n}\n.item-overlay.jump-letter,\n.item-overlay.picker-letter {\n  font-weight: 600;\n  background: var(--accent);\n  color: white;\n  letter-spacing: .05em;\n  text-transform: uppercase;\n}\n.picker-prompt {\n  position: absolute;\n  top: 16px;\n  left: 50%;\n  transform: translateX(-50%);\n  z-index: 6;\n  padding: 6px 14px;\n  border-radius: var(--radius);\n  background: var(--panel);\n  border: 1px solid var(--accent);\n  box-shadow: var(--shadow-md);\n  font: 13px system-ui, sans-serif;\n  pointer-events: none;\n}\n.picker-prompt em { color: var(--text-muted); font-style: normal; }\n.node {\n  position: absolute;\n  min-width: 96px;\n  min-height: 36px;\n  transform: translate(-50%, -50%);\n  border: 1px solid var(--line-strong);\n  border-radius: var(--radius);\n  background: var(--panel);\n  box-shadow: var(--shadow-sm);\n  user-select: none;\n  touch-action: none;\n  cursor: pointer;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  transition: box-shadow var(--duration-normal) var(--ease-default),\n              border-color var(--duration-normal) var(--ease-default),\n              min-height var(--duration-fast) var(--ease-default),\n              left var(--duration-fast) var(--ease-default),\n              top var(--duration-fast) var(--ease-default);;\n}\n.node:hover {\n  border-color: var(--accent);\n  box-shadow: var(--shadow-sm), 0 0 0 1px rgba(37, 99, 235, .08);\n}\n/* Keyboard nudge eases via the left/top transition above. A pointer-drag must\n   track the cursor 1:1, so the stage drops the easing while dragging. */\n.stage.dragging .node { cursor: grabbing; transition: box-shadow var(--duration-normal) var(--ease-default), border-color var(--duration-normal) var(--ease-default); }\n.node-type-square {\n  border-radius: 6px;\n  background: color-mix(in srgb, var(--panel) 88%, #e0f2fe);\n}\n.node-type-circle {\n  border-radius: 999px;\n  background: color-mix(in srgb, var(--panel) 86%, #dcfce7);\n}\n.node-type-circle .node-title,\n.node-type-circle .node-body {\n  padding-left: 18px;\n  padding-right: 18px;\n}\n.node-type-service { border-color: color-mix(in srgb, #0f766e 45%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 86%, #ccfbf1); }\n.node-type-database { border-color: color-mix(in srgb, #0369a1 45%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 86%, #e0f2fe); }\n.node-type-kafka { border-color: color-mix(in srgb, #7c3aed 42%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 87%, #ede9fe); }\n.node-type-index { border-color: color-mix(in srgb, #b45309 45%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 86%, #fef3c7); }\n.node-type-user-input { border-color: color-mix(in srgb, #be123c 42%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 88%, #ffe4e6); }\n.node-type-gateway { border-color: color-mix(in srgb, #4338ca 42%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 88%, #e0e7ff); }\n.node-type-cache { border-color: color-mix(in srgb, #15803d 45%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 86%, #dcfce7); }\n.node-type-rate-limit { border-color: color-mix(in srgb, #dc2626 45%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 88%, #fee2e2); }\n.node-type-circuit-breaker { border-color: color-mix(in srgb, #7c2d12 45%, var(--line-strong)); background: color-mix(in srgb, var(--panel) 88%, #ffedd5); }\n.node.semantic-big-data {\n  box-shadow: inset 0 0 0 2px color-mix(in srgb, #b45309 38%, transparent), var(--shadow-sm);\n}\n.node.semantic-big-data .node-kicker::after {\n  content: \"big data\";\n  padding: 1px 4px;\n  border-radius: 4px;\n  background: color-mix(in srgb, #f59e0b 22%, transparent);\n  color: #92400e;\n  font: 700 9px/1 ui-monospace, monospace;\n  text-transform: uppercase;\n}\n.node.semantic-stale-risk .node-title::after {\n  content: \" stale\";\n  margin-left: 4px;\n  color: #b45309;\n  font: 700 10px/1 ui-monospace, monospace;\n  text-transform: uppercase;\n}\n\n/* Containers paint behind nodes (EntityDef.order = -10). Dashed border + label\n   in the corner so the grouping reads at a glance without competing with nodes. */\n.container {\n  position: absolute;\n  transform: translate(-50%, -50%);\n  border: 1px dashed var(--line-strong);\n  border-radius: var(--radius-lg);\n  background: rgba(0, 0, 0, .02);\n  box-shadow: none;\n  user-select: none;\n  pointer-events: auto;\n  transition: width var(--duration-normal) var(--ease-default),\n              height var(--duration-normal) var(--ease-default),\n              border-radius var(--duration-normal) var(--ease-default),\n              background var(--duration-normal) var(--ease-default),\n              border-color var(--duration-fast) var(--ease-default);\n}\n.container:hover { border-color: var(--accent); background: rgba(37, 99, 235, .03); }\n.container.selected { border-color: var(--accent); background: rgba(37, 99, 235, .05); }\n.container.focused { outline: 2px solid var(--accent); outline-offset: 2px; }\n/* Collapsed: a solid badge that sits ABOVE nodes/edges so it reads like a chip,\n   not a faint backdrop. Children are skipped by the renderer so the rect shrinks\n   to COLLAPSED_SIZE and the label centers inside. */\n.container.collapsed {\n  border-style: solid;\n  background: var(--panel);\n  box-shadow: var(--shadow-sm);\n  z-index: 2;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.container.collapsed .container-label {\n  position: static;\n  padding: 0 10px;\n  background: transparent;\n  color: var(--ink);\n  font: 600 12px/1 system-ui, sans-serif;\n  text-transform: none;\n  letter-spacing: 0;\n}\n.container.collapsed .container-resize { display: none; }\n.container-label {\n  position: absolute;\n  top: -10px;\n  left: 8px;\n  padding: 0 6px;\n  background: var(--bg);\n  color: var(--text-muted);\n  font: 600 10px/1 ui-monospace, monospace;\n  text-transform: uppercase;\n  letter-spacing: .5px;\n}\n.container-label.editing {\n  outline: none;\n  background: var(--panel);\n  color: var(--ink);\n  border-radius: 2px;\n}\n.container-sections {\n  position: absolute;\n  inset: 16px 10px 10px;\n  display: flex;\n  flex-direction: column;\n  pointer-events: none;\n}\n.container-sections[data-axis=\"columns\"] {\n  flex-direction: row;\n}\n.container-section {\n  position: relative;\n  flex: 1 1 0;\n  min-width: 0;\n  min-height: 0;\n  border-top: 1px dashed color-mix(in srgb, var(--line-strong) 70%, transparent);\n}\n.container-section:first-child { border-top: 0; }\n.container-sections[data-axis=\"columns\"] .container-section {\n  border-top: 0;\n  border-left: 1px dashed color-mix(in srgb, var(--line-strong) 70%, transparent);\n}\n.container-sections[data-axis=\"columns\"] .container-section:first-child { border-left: 0; }\n.container-section span {\n  position: absolute;\n  top: 4px;\n  left: 6px;\n  padding: 0 4px;\n  border-radius: 3px;\n  background: color-mix(in srgb, var(--bg) 88%, transparent);\n  color: var(--text-muted);\n  font: 600 10px/1.2 ui-monospace, monospace;\n  pointer-events: auto;\n  cursor: text;\n}\n.container-section span.editing {\n  outline: 2px solid var(--accent);\n  outline-offset: 1px;\n  background: var(--panel);\n  color: var(--ink);\n}\n.container-section-divider {\n  flex: 0 0 8px;\n  align-self: stretch;\n  border: 0;\n  padding: 0;\n  background: transparent;\n  cursor: row-resize;\n  pointer-events: auto;\n  position: relative;\n}\n.container-sections[data-axis=\"columns\"] .container-section-divider { cursor: col-resize; }\n.container-section-divider::before {\n  content: \"\";\n  position: absolute;\n  inset: 3px 0;\n  border-radius: 999px;\n  background: transparent;\n}\n.container-sections[data-axis=\"columns\"] .container-section-divider::before { inset: 0 3px; }\n.container-section-divider:hover::before,\n.container-section-divider:focus-visible::before {\n  background: var(--accent-soft);\n}\n/* Resize handle — bottom-right corner. Visible only on hover/selected/focused. */\n.container-resize {\n  position: absolute;\n  right: -6px;\n  bottom: -6px;\n  width: 14px;\n  height: 14px;\n  border-right: 2px solid var(--line-strong);\n  border-bottom: 2px solid var(--line-strong);\n  cursor: nwse-resize;\n  opacity: 0;\n  transition: opacity .12s, border-color .12s;\n}\n.container:hover .container-resize,\n.container.selected .container-resize,\n.container.focused .container-resize { opacity: 1; }\n.container-resize:hover { border-color: var(--accent); }\n.container.manual { background: rgba(37, 99, 235, .03); }\n.node:hover { box-shadow: var(--shadow-md); border-color: var(--accent); }\n.node.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow-md); }\n.node.focused { outline: 2px solid var(--accent); outline-offset: 2px; }\n/* Toolbar sits above the selected node in screen-space — separate from the\n   node template so the node body stays free of chrome. */\n.node-toolbar {\n  position: absolute;\n  transform: translate(-50%, calc(-100% - 6px));\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  padding: 3px 5px;\n  border: 1px solid var(--line-strong);\n  border-radius: var(--radius);\n  background: var(--panel);\n  box-shadow: var(--shadow-md);\n  z-index: 4;\n  pointer-events: auto;\n  user-select: none;\n}\n.node-toolbar .node-drag-handle {\n  width: 14px;\n  color: var(--text-muted);\n  cursor: grab;\n  line-height: 1;\n  text-align: center;\n  font-size: 11px;\n}\n.node-toolbar .node-drag-handle:hover { color: var(--ink); }\n.node-action, .node-toggle, .node-config {\n  width: 20px; height: 20px;\n  padding: 0;\n  border: 0; background: transparent;\n  border-radius: 4px;\n  color: var(--text-muted);\n  line-height: 1;\n}\n.node-action:hover, .node-toggle:hover, .node-config:hover { background: var(--panel-2); color: var(--ink); }\n.node-context-actions { font-weight: 700; }\n.node-title {\n  flex: 1; font-weight: 600;\n  font-size: 13px;\n  min-width: 0;\n  padding: var(--space-2) var(--space-3);\n  white-space: pre-line;\n  line-height: 1.3;\n  color: var(--ink);\n  text-align: center;\n}\n.node-kicker {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  min-height: 20px;\n  padding: 6px 8px 0;\n  font: 10px/1.2 ui-monospace, monospace;\n  color: var(--text-muted);\n}\n.node-type-label {\n  font-weight: 700;\n  text-transform: uppercase;\n}\n.node-metrics {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.node-metrics:empty { display: none; }\n/* Edit mode visual cue — applied only when editable's handler enters the mode.\n   Stays out of the default state so a normal click doesn't suggest editability. */\n.node-title.editing {\n  outline: 2px solid var(--accent);\n  outline-offset: 1px;\n  border-radius: 3px;\n  background: var(--panel);\n  cursor: text;\n}\n.node-body { padding: 0 var(--space-3) var(--space-2); color: var(--text-muted); font-size: 12px; }\n.node-description {\n  display: grid;\n  gap: 3px;\n  max-height: 92px;\n  overflow: hidden;\n  line-height: 1.25;\n  text-align: left;\n}\n.node-description p,\n.node-description h4,\n.node-description ul { margin: 0; }\n.node-description h4 { font-size: 11px; color: var(--ink); }\n.node-description ul { padding-left: 16px; }\n.node-description code {\n  padding: 0 3px;\n  border-radius: 3px;\n  background: var(--panel-2);\n  color: var(--ink);\n}\n.node-description a { color: var(--accent); }\n/* Nodes without descriptions stay title-only; ids are data attrs, not visual noise. */\n.node:not(.has-description) .node-body { display: none; }\n.node.collapsed .node-body { display: none; }\n\n.design-hints {\n  position: absolute;\n  right: 116px;\n  bottom: 12px;\n  z-index: 11;\n  width: min(360px, calc(100vw - 392px));\n  max-height: min(42vh, 360px);\n  overflow: auto;\n  display: grid;\n  gap: 6px;\n  padding: 10px;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  background: color-mix(in srgb, var(--panel) 95%, transparent);\n  box-shadow: var(--shadow-sm);\n  pointer-events: auto;\n}\n.design-hints-title {\n  font-size: 11px;\n  font-weight: 700;\n  text-transform: uppercase;\n  color: var(--text-muted);\n}\n.design-observation {\n  display: grid;\n  gap: 2px;\n  padding-left: 8px;\n  border-left: 3px solid var(--line-strong);\n}\n.design-observation strong {\n  font-size: 12px;\n  line-height: 1.25;\n}\n.design-observation span {\n  color: var(--text-muted);\n  font-size: 11.5px;\n  line-height: 1.3;\n}\n.design-observation-action {\n  justify-self: start;\n  min-height: 22px;\n  padding: 2px 7px;\n  border: 1px solid var(--line);\n  background: var(--panel);\n  color: var(--accent);\n  font-size: 11px;\n}\n.design-observation-action:hover {\n  border-color: var(--accent);\n  background: var(--accent-soft);\n}\n.design-observation.warn { border-left-color: #d97706; }\n.design-observation.error { border-left-color: var(--danger); }\n.design-observation.info { border-left-color: var(--accent); }\n\n.design-presentation {\n  position: absolute;\n  left: 50%;\n  top: 54px;\n  z-index: 13;\n  width: min(520px, calc(100vw - 220px));\n  transform: translateX(-50%);\n  display: grid;\n  gap: 8px;\n  padding: 12px;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  background: color-mix(in srgb, var(--panel) 96%, transparent);\n  box-shadow: var(--shadow-md);\n  pointer-events: auto;\n}\n.design-presentation-kicker {\n  color: var(--text-muted);\n  font: 700 10px/1.2 ui-monospace, monospace;\n  text-transform: uppercase;\n}\n.design-presentation strong {\n  font-size: 14px;\n  line-height: 1.25;\n}\n.design-presentation p {\n  margin: 0;\n  color: var(--text-muted);\n  font-size: 12px;\n  line-height: 1.35;\n}\n.design-presentation-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n.design-presentation-actions button {\n  min-height: 26px;\n  padding: 3px 9px;\n  border: 1px solid var(--line);\n  background: var(--panel);\n  font-size: 12px;\n}\n.design-presentation-actions button.primary {\n  border-color: var(--accent);\n  background: var(--accent-soft);\n  color: var(--accent);\n}\n.design-presentation-actions button:disabled {\n  opacity: .45;\n  cursor: default;\n}\n\n/* Side panel typography */\n.panel-title {\n  margin: 0;\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: .08em;\n  color: var(--text-muted);\n}\n\n/* Event log: text rhythm, no card chrome. */\n.log { display: grid; gap: 1px; font: 11.5px/1.4 ui-monospace, monospace; margin-bottom: 18px; }\n.log .panel-title { margin-bottom: 6px; }\n.log-row {\n  padding: 2px 8px;\n  border-left: 2px solid var(--line-strong);\n  color: var(--text-muted);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.log-row:first-of-type { color: var(--ink); border-left-color: var(--accent); }\n\n/* Outline: each collection is a section. Rows are text; affordances appear on hover. */\n.outline { display: grid; gap: var(--space-4); margin-bottom: 14px; }\n.outline-section { display: grid; gap: 6px; }\n.outline-section.folded { gap: 0; }\n.outline-fold {\n  min-width: 22px;\n  padding: 3px 4px;\n  color: var(--text-muted);\n  font-size: 11px;\n  line-height: 1;\n}\n.outline-fold:hover { color: var(--ink); }\n.outline-head {\n  display: flex; align-items: center; justify-content: space-between;\n  gap: 6px;\n  margin-bottom: 2px;\n}\n.outline-title-search {\n  flex: 1;\n  min-width: 0;\n  border: 1px solid transparent;\n  background: transparent;\n  border-radius: var(--radius);\n  padding: 4px 6px;\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 1.35;\n  color: var(--text-muted);\n  text-align: left;\n  text-transform: uppercase;\n  letter-spacing: .08em;\n}\n.outline-title-search:hover { background: var(--panel); }\n.outline-title-search:focus {\n  background: var(--panel);\n  border-color: var(--line);\n  color: var(--ink);\n  text-transform: none;\n  letter-spacing: 0;\n}\n.outline-title-search::placeholder { color: var(--text-muted); opacity: 1; }\n.outline-list { display: grid; gap: 1px; }\n.outline-item { display: grid; gap: 1px; }\n/* Nested children indent under their parent with a guide rail. */\n.outline-children {\n  display: grid;\n  gap: 1px;\n  margin-left: 11px;\n  padding-left: 6px;\n  border-left: 1px solid var(--border);\n}\n/* Keep leaf rows (no fold toggle) aligned with foldable rows. Stretch so the\n * empty cell's box spans the row height — its top matches sibling controls. */\n.outline-fold-spacer { align-self: stretch; min-width: 22px; }\n.outline-row {\n  display: grid;\n  grid-template-columns: auto minmax(0, 1fr) auto auto;\n  align-items: center;\n  gap: 4px;\n  border-radius: var(--radius);\n}\n.outline-row:hover { background: var(--panel); }\n.outline-main {\n  background: transparent;\n  border: 0;\n  padding: 5px 8px;\n  font-size: 13px;\n  color: var(--ink);\n  overflow: hidden;\n  text-align: left;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.outline-main:hover { background: transparent; }\n.outline-row .icon-button { opacity: 0; }\n.outline-row:hover .icon-button { opacity: 1; }\n.icon-button {\n  min-width: 22px;\n  padding: 3px 6px;\n  border: 0;\n  background: transparent;\n  color: var(--text-muted);\n  border-radius: 4px;\n}\n.icon-button:hover { background: var(--panel-2); color: var(--ink); }\n\n/* Empty state. Text-only. Dashed border only on stage for \"drop hint\" feel. */\n.empty {\n  display: grid; gap: 4px;\n  padding: 10px 12px;\n  color: var(--text-muted);\n  background: transparent;\n  text-align: center;\n}\n.empty-title { font-weight: 500; color: var(--ink); font-size: 13px; }\n.empty-hint { font-size: 12px; }\n.empty kbd {\n  font-family: ui-monospace, monospace; font-size: 11px;\n  background: var(--panel); border: 1px solid var(--line); border-radius: 3px;\n  padding: 0 5px; margin: 0 2px;\n}\n.stage .empty {\n  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);\n  min-width: 240px;\n  border: 1px dashed var(--line-strong); border-radius: var(--radius-lg);\n  padding: 16px 20px;\n  background: var(--bg);\n}\n\n/* Modal — keeps weight on purpose: it's a focal surface. */\n.modal-slot { position: fixed; inset: 0; z-index: 50; pointer-events: none; }\n.modal-layer { position: absolute; inset: 0; pointer-events: auto; animation: modal-enter var(--duration-fast) var(--ease-default); }\n.backdrop { position: absolute; inset: 0; background: rgba(28,28,28,.18); }\n.modal {\n  position: absolute;\n  top: 64px;\n  left: 50%;\n  transform: translateX(-50%);\n  width: min(420px, calc(100vw - 32px));\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius-lg);\n  box-shadow: var(--shadow-md);\n  overflow: hidden;\n  animation: modal-slide var(--duration-normal) var(--ease-default);\n}\n.modal-head {\n  display: flex; justify-content: space-between; align-items: center;\n  padding: var(--space-2) var(--space-4);\n  border-bottom: 1px solid var(--line);\n  font-weight: 600;\n}\n.modal-body { padding: var(--space-3); display: grid; gap: var(--space-2); }\n.modal-layer[data-visual=\"command\"] .modal { width: min(520px, calc(100vw - 32px)); }\n.modal-layer[data-visual=\"properties\"] .modal { width: min(360px, calc(100vw - 32px)); }\n.modal-layer[data-visual=\"perf\"] .modal { width: min(1100px, calc(100vw - 32px)); }\n.modal-layer[data-visual=\"perf\"] .modal-body { max-height: calc(100vh - 150px); overflow: auto; }\n\n.palette-search {\n  width: 100%;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 7px 10px;\n  font: inherit;\n}\n.palette-search:focus { outline: 2px solid var(--accent); outline-offset: 2px; border-color: transparent; }\n.palette { display: grid; gap: 10px; }\n.command-list, .help-list {\n  display: grid; gap: 14px;\n  max-height: min(60vh, 520px); overflow: auto;\n}\n.command-section { display: grid; gap: 4px; }\n.command-section h3 {\n  margin: 0 0 2px;\n  color: var(--text-muted);\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: .06em;\n}\n.command-section > [data-slot=\"rows\"] { display: grid; gap: 1px; }\n\n/* Command rows: ghost list, full-width, hover treatment. */\n.command-row, .help-row {\n  width: 100%;\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n  text-align: left;\n  background: transparent;\n  border: 0;\n  border-radius: var(--radius);\n  padding: 6px 10px;\n  color: var(--ink);\n}\n.command-row:hover { background: var(--accent-soft); }\n/* Arrow-key highlight — the row Enter will run. */\n.command-row.is-selected { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); }\n.command-row span, .help-row span { display: grid; gap: 1px; min-width: 0; }\n.command-row small, .help-row small { color: var(--text-muted); font: 11px ui-monospace, monospace; }\n.command-row kbd {\n  border: 1px solid var(--line);\n  background: var(--panel);\n  border-radius: 4px;\n  padding: 1px 5px;\n  color: var(--text-muted);\n  font: 11px ui-monospace, monospace;\n}\n.help-row { padding: 5px 10px; }\n.help-row input {\n  width: 84px;\n  border: 1px solid var(--line);\n  border-radius: 4px;\n  padding: 4px 6px;\n  font: 12px ui-monospace, monospace;\n  background: var(--panel);\n}\n.perf-panel { display: grid; gap: 12px; min-width: 0; }\n.perf-actions { display: flex; gap: 6px; justify-content: flex-end; }\n.perf-actions button { border: 1px solid var(--line); }\n.perf-summary {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 8px;\n}\n.perf-summary-item {\n  display: grid;\n  gap: 2px;\n  min-width: 0;\n  padding: 8px 10px;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  background: var(--panel-2);\n}\n.perf-summary-item span { color: var(--text-muted); font-size: 11px; }\n.perf-summary-item b { font: 16px ui-monospace, monospace; }\n.perf-panel details {\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  overflow: hidden;\n}\n.perf-panel summary {\n  cursor: pointer;\n  padding: 7px 10px;\n  background: var(--panel-2);\n  font-weight: 600;\n}\n.perf-table-wrap { max-height: 300px; overflow: auto; }\n.perf-table {\n  width: 100%;\n  border-collapse: collapse;\n  font: 11px/1.35 ui-monospace, monospace;\n}\n.perf-table th,\n.perf-table td {\n  padding: 4px 7px;\n  border-top: 1px solid var(--line);\n  text-align: left;\n  vertical-align: top;\n}\n.perf-table th {\n  position: sticky;\n  top: 0;\n  background: var(--panel);\n  color: var(--text-muted);\n  z-index: 1;\n  cursor: pointer;\n  user-select: none;\n}\n.perf-table th.is-sorted { color: var(--text); }\n.perf-table td:nth-child(n+3) { white-space: nowrap; }\n.perf-table td:last-child { white-space: normal; }\n.perf-bar {\n  display: block;\n  width: 120px;\n  height: 8px;\n  margin-top: 3px;\n  border-radius: 999px;\n  background: var(--line);\n  overflow: hidden;\n}\n.perf-bar span {\n  display: block;\n  height: 100%;\n  background: var(--accent);\n}\n.perf-export {\n  box-sizing: border-box;\n  width: 100%;\n  min-height: 180px;\n  resize: vertical;\n  padding: 8px;\n  border: 0;\n  background: var(--panel);\n  color: var(--text);\n  font: 11px/1.4 ui-monospace, monospace;\n}\n.help-row.has-conflict { background: var(--danger-soft); }\n.flag-row { cursor: pointer; }\n.flag-row input.flag-toggle {\n  width: 16px;\n  height: 16px;\n  margin: 0;\n  padding: 0;\n  accent-color: var(--accent);\n}\n.shortcut-edit.is-conflict { border-color: var(--danger) !important; color: var(--danger); }\n.editable-inline { border: 1px solid transparent !important; background: transparent !important; }\n.editable-inline:hover { background: var(--panel-2) !important; }\n.editable-inline:focus { background: var(--panel) !important; outline: 2px solid var(--accent); }\n.shortcut-edit.is-conflict:focus { outline-color: var(--danger); }\n\n/* Property modal */\n.properties { display: grid; gap: 10px; }\n.properties [data-slot=\"fields\"] { display: grid; gap: 10px; }\n.property-group {\n  margin-top: 2px;\n  color: var(--text-muted);\n  font-size: 11px;\n  font-weight: 700;\n  text-transform: uppercase;\n}\n.properties label {\n  display: grid; gap: 4px;\n  color: var(--text-muted);\n  font-size: 11px;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n.properties input,\n.properties textarea,\n.properties select {\n  width: 100%;\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 6px 8px;\n  color: var(--ink);\n  background: var(--panel);\n  font: 13px system-ui, sans-serif;\n  text-transform: none;\n  letter-spacing: normal;\n}\n.properties textarea {\n  resize: vertical;\n  min-height: 78px;\n  line-height: 1.4;\n}\n\n.properties input.editable-inline {\n  border-bottom: 1px dashed var(--line-strong);\n}\n.properties input:focus,\n.properties textarea:focus,\n.properties select:focus { outline: 2px solid var(--accent); outline-offset: 2px; border-color: transparent; }\n.properties .check-row {\n  display: flex; align-items: center; gap: 8px;\n  color: var(--ink);\n  font-size: 13px;\n  text-transform: none;\n  letter-spacing: normal;\n}\n.properties .check-row input { width: auto; }\n.form-actions { display: flex; justify-content: flex-end; padding-top: 2px; }\n.form-error { min-height: 16px; color: var(--danger); font-size: 12px; }\n.property-group {\n  font-size: 11px;\n  text-transform: uppercase;\n  letter-spacing: .08em;\n  color: var(--text-muted);\n  padding-top: 6px;\n  margin-top: 4px;\n  border-top: 1px solid var(--line);\n}\n.context-actions {\n  display: grid;\n  gap: 8px;\n}\n.context-action-row {\n  display: flex;\n  gap: 6px;\n  flex-wrap: wrap;\n}\n.context-action {\n  width: 100%;\n  justify-content: flex-start;\n}\n.context-action-row .context-action {\n  width: auto;\n}\n.context-action-heading {\n  margin-top: 4px;\n  color: var(--text-muted);\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: .05em;\n}\n\n/* --- Scenario player HUD (presentation / fix-demo overlay) --- */\n.scenario-hud {\n  position: fixed;\n  left: 50%;\n  bottom: 24px;\n  transform: translateX(-50%);\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  max-width: 80vw;\n  padding: 8px 16px;\n  border-radius: 999px;\n  background: var(--ink, #1a1a1a);\n  color: var(--bg, #fff);\n  font: 600 13px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;\n  box-shadow: 0 6px 24px rgba(0, 0, 0, .28);\n  pointer-events: none;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  /* animation: scenario-pop .18s ease; */\n}\n.scenario-hud.done { background: var(--ok, #1a7f4b); }\n@keyframes scenario-pop { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translateX(-50%); } }\n\n/* ============================================================================\n   varflow viewer — file-projections graph mode (.varflow)\n   Warm \"paper\" palette ported from file-projections src/ui/app.css, plus a\n   read-only chrome: the canvas is for *reading* a program graph, so the node\n   editor, node-type palette, system-design observations, and outline sidebar\n   are hidden. Zoom/Fit stays. Scoped under .varflow so the editor is\n   untouched when the app boots normally.\n   ============================================================================ */\n.varflow {\n  --bg: #ebe7dd;\n  --panel: #f4f0e8;\n  --panel-2: #e2ddd2;\n  --ink: #25231f;\n  --text-muted: #746b5d;\n  --line: #cec6b8;\n  --line-strong: #b8ae9c;\n  --accent: #3f6f9f;\n  --accent-soft: rgba(63, 111, 159, .10);\n  --edge: #8a7f6d;\n  --danger: #b54848;\n  --danger-soft: rgba(181, 72, 72, .08);\n  --shadow-sm: 0 1px 2px rgba(70, 55, 30, .06);\n  --shadow-md: 0 6px 18px rgba(70, 55, 30, .10);\n  color-scheme: light;\n}\n/* Hide editor affordances not applicable to a read-only program-graph view. */\n.varflow [data-panel-id=\"top\"],\n.varflow [data-panel-id=\"system-design\"],\n.varflow .design-hints,\n.varflow .node-type-panel,\n.varflow .item-toolbar,\n.varflow .left { display: none !important; }\n/* Reclaim the sidebar column so the stage spans the full width. */\n.varflow .shell { grid-template-columns: 1fr !important; }\n.varflow .stage { grid-column: 1 / -1 !important; }\n/* Program-graph reading mode: calm rectangular cards, left-aligned labels,\n   effect/type shown by a restrained accent rail instead of loud fill colors. */\n.varflow .node {\n  justify-content: flex-start;\n  border-radius: 5px;\n  border-color: color-mix(in srgb, var(--line-strong) 82%, transparent);\n  background: color-mix(in srgb, #fbf8f0 92%, var(--panel));\n  box-shadow: 0 1px 2px rgba(70, 55, 30, .05);\n  overflow: hidden;\n}\n.varflow .node::before {\n  content: \"\";\n  position: absolute;\n  inset: 0 auto 0 0;\n  width: 4px;\n  background: var(--line-strong);\n}\n.varflow .node-type-gateway::before { background: #3f6f9f; }\n.varflow .node-type-service::before { background: #24784f; }\n.varflow .node-type-database::before { background: #b07a2b; }\n.varflow .node-type-index::before { background: #b54848; }\n.varflow .node-type-square::before { background: #8a7f6d; }\n.varflow .node-type-gateway,\n.varflow .node-type-service,\n.varflow .node-type-database,\n.varflow .node-type-index,\n.varflow .node-type-square {\n  background: color-mix(in srgb, #fbf8f0 94%, var(--panel));\n}\n.varflow .node-kicker {\n  min-height: 18px;\n  padding: 6px 10px 0 14px;\n}\n.varflow .node-title {\n  padding: 3px 10px 6px 14px;\n  text-align: left;\n  font-family: ui-monospace, Menlo, monospace;\n  font-size: 12.5px;\n  line-height: 1.25;\n  word-break: break-word;\n}\n.varflow .node-type-label {\n  letter-spacing: .04em;\n  font-size: 9px;\n}\n.varflow .node-body {\n  padding: 0 10px 8px 14px;\n}\n.varflow .node-description {\n  max-height: 34px;\n  font-size: 10.5px;\n  line-height: 1.25;\n}\n.varflow .edge-line {\n  opacity: .72;\n}\n.varflow .edge-line.edge-kind-async {\n  stroke: #6f4fb0;\n}\n.varflow .edge-label {\n  paint-order: stroke;\n  stroke: #fbf8f0;\n  stroke-width: 5px;\n  stroke-linejoin: round;\n  font-size: 10px;\n}\n.varflow .container {\n  border-style: solid;\n  border-color: color-mix(in srgb, var(--line-strong) 70%, transparent);\n  background: rgba(244, 240, 232, .34);\n  pointer-events: none;\n}\n.varflow .container-label {\n  top: -9px;\n  left: 10px;\n  background: #ebe7dd;\n  color: color-mix(in srgb, var(--text-muted) 82%, var(--ink));\n  letter-spacing: .04em;\n}\n.varflow .tool-panel[data-panel-id=\"zoom\"] {\n  max-width: calc(100% - 24px);\n  overflow: hidden;\n}\n@media (max-width: 700px) {\n  .varflow .tool-panel[data-panel-id=\"zoom\"] {\n    right: 8px;\n    bottom: 8px;\n  }\n  .varflow .node-title {\n    font-size: 12px;\n  }\n}\n";
	//#endregion
	//#region frontend/index.html?raw
	var frontend_default = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Graph Editor</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n  <script type=\"module\" src=\"app.ts\"><\/script>\n</head>\n<body>\n  <div id=\"app\"></div>\n\n  <template id=\"tpl-shell\">\n    <section class=\"shell\">\n      <header class=\"top\" data-place=\"top\"></header>\n      <main class=\"stage\" data-place=\"stage\"></main>\n      <div class=\"left\" data-place=\"left\"></div>\n      <div class=\"modal-slot\" data-place=\"modal\"></div>\n    </section>\n  </template>\n\n  <template id=\"tpl-toolbar\">\n    <nav class=\"toolbar\" aria-label=\"App commands\">\n      <div class=\"toolbar-start\" data-slot=\"start\"></div>\n      <span class=\"toolbar-spacer\"></span>\n      <div class=\"toolbar-end\" data-slot=\"end\"></div>\n    </nav>\n  </template>\n\n  <template id=\"tpl-log\">\n    <section>\n      <h2 class=\"panel-title\">Event log</h2>\n      <div class=\"log\" data-slot=\"rows\"></div>\n    </section>\n  </template>\n\n  <template id=\"tpl-log-row\">\n    <div class=\"log-row\" data-text=\"name\"></div>\n  </template>\n\n  <template id=\"tpl-nodes\">\n    <div class=\"nodes\">\n      <svg class=\"edges\" data-slot=\"edges\" overflow=\"visible\" aria-hidden=\"true\">\n        <defs>\n          <!-- Directional arrowhead shared by every edge. `orient=\"auto\"` aligns\n               with the line direction; `markerUnits=\"userSpaceOnUse\"` keeps the\n               arrow size fixed in graph space, independent of stroke width. -->\n          <marker id=\"edge-arrow\" viewBox=\"0 0 12 12\" refX=\"11\" refY=\"6\"\n                  markerWidth=\"12\" markerHeight=\"12\" orient=\"auto\" markerUnits=\"userSpaceOnUse\">\n            <path d=\"M0,0 L12,6 L0,12 Z\" />\n          </marker>\n        </defs>\n      </svg>\n    </div>\n  </template>\n\n  <template id=\"tpl-empty\">\n    <div class=\"empty\" role=\"status\" aria-live=\"polite\">\n      <div class=\"empty-title\" data-text=\"title\"></div>\n      <div class=\"empty-hint\" data-slot=\"hint\"></div>\n    </div>\n  </template>\n\n  <template id=\"tpl-node\">\n    <article class=\"node\">\n  \n      <div class=\"node-title\" data-editable-title data-slot=\"title\" data-text=\"title\"></div>\n      <div class=\"node-body\">\n        <div class=\"node-description\" data-slot=\"description\"></div>\n      </div>\n    </article>\n  </template>\n\n  <template id=\"tpl-modal\">\n    <div class=\"modal-layer\">\n      <div class=\"backdrop\" data-command=\"modal.close\"></div>\n      <section class=\"modal\">\n        <div class=\"modal-head\">\n          <span data-text=\"title\"></span>\n          <button data-command=\"modal.close\">Close</button>\n        </div>\n        <div class=\"modal-body\" data-slot=\"body\"></div>\n      </section>\n    </div>\n  </template>\n\n  <template id=\"tpl-palette\">\n    <section class=\"palette\">\n      <input class=\"palette-search\" placeholder=\"Search commands\" autocomplete=\"off\" autofocus>\n      <div class=\"command-list\" data-slot=\"commands\"></div>\n    </section>\n  </template>\n\n  <template id=\"tpl-command-section\">\n    <section class=\"command-section\">\n      <h3 data-text=\"group\"></h3>\n      <div data-slot=\"rows\"></div>\n    </section>\n  </template>\n\n  <template id=\"tpl-command-row\">\n    <button class=\"command-row\">\n      <span><b data-text=\"label\"></b><small data-text=\"id\"></small></span>\n      <kbd data-text=\"shortcut\"></kbd>\n    </button>\n  </template>\n\n  <template id=\"tpl-help-row\">\n    <div class=\"help-row\">\n      <span><b data-text=\"label\"></b><small data-text=\"id\"></small></span>\n      <input class=\"shortcut-edit editable-inline\">\n    </div>\n  </template>\n\n  <template id=\"tpl-properties\">\n    <section class=\"properties\">\n      <div data-slot=\"fields\"></div>\n    </section>\n  </template>\n</body>\n</html>\n";
	//#endregion
	//#region frontend/core/affordances.ts
	/** Unified affordance lookup. Two kinds, one context:
	*
	*  - **system affordances** (toolbar buttons, sidebar entries) — context-free,
	*    contributed at boot via `contribute()`, retrieved by surface.
	*  - **entity affordances** (per-item buttons + handlers on a rendered card) —
	*    declared on `EntityDef.abilities[].actions[].ui`, retrieved by entity + slot.
	*
	*  Both flow through this one context so render reads from a single API and a
	*  future plugin can swap either side without touching the other. */
	function affordancesContext(bus) {
		const surfaceAffordances = /* @__PURE__ */ new Map();
		let panels = [];
		return {
			contribute(aff) {
				const list = surfaceAffordances.get(aff.surface) ?? [];
				list.push(aff);
				surfaceAffordances.set(aff.surface, list);
				bus.emit("affordance.contributed", { surface: aff.surface });
			},
			/** Declare a stage tool panel. Buttons reach it via `SystemAffordance.panel`.
			*  Re-uses the `top` affordance-contributed signal so the tool-panel renderer
			*  redraws on declare/teardown without a dedicated event. */
			declarePanel(panel) {
				panels.push(panel);
				bus.emit("affordance.contributed", { surface: "top" });
			},
			/** Declared tool panels, lowest `order` first. */
			panels() {
				return [...panels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
			},
			/** Context-free affordances contributed for the given surface (toolbar, list, …). */
			system(surface) {
				return [...surfaceAffordances.get(surface) ?? []].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
			},
			/** Per-entity affordances declared on its abilities, optionally filtered by slot. */
			entity(entityDef, slot) {
				return entityDef.abilities.flatMap((abilityDef) => abilityDef.actions.flatMap((actionDef) => actionDef.ui.filter((ui) => ui.surface === "entity" && (slot == null || ui.slot === slot)).map((ui) => ({
					action: actionDef,
					ui
				}))));
			},
			unregisterOrigin(origin) {
				for (const [surface, list] of surfaceAffordances) {
					const next = list.filter((a) => a.origin !== origin);
					surfaceAffordances.set(surface, next);
					if (next.length !== list.length) bus.emit("affordance.contributed", { surface });
				}
				const keptPanels = panels.filter((p) => p.origin !== origin);
				if (keptPanels.length !== panels.length) {
					panels = keptPanels;
					bus.emit("affordance.contributed", { surface: "top" });
				}
			}
		};
	}
	//#endregion
	//#region frontend/core/cancellation.ts
	/** First-class cancellation. Any system that has an "active mode" (modal open,
	*  picker running, edit-in-place, selection set, jump letters showing) registers
	*  a Cancellable. The cancellation system fires `app.cancel` on Escape or stage
	*  background click; this context picks the highest-priority active handler
	*  (ties broken by most-recently-registered) and runs its cancel.
	*
	*  One handler per Escape: peel one layer at a time. Press Escape again to peel
	*  the next. Predictable and easy to test. */
	function cancellationContext(bus) {
		const handlers = [];
		bus.on("app.cancel", (payload) => {
			const fromBackground = payload?.source === "background";
			let chosen = null;
			for (let i = handlers.length - 1; i >= 0; i--) {
				const handler = handlers[i];
				if (!handler.active()) continue;
				if (fromBackground && handler.background === false) continue;
				if (!chosen || (handler.priority ?? 0) > (chosen.priority ?? 0)) chosen = handler;
			}
			chosen?.cancel();
		});
		return {
			register(handler) {
				handlers.push(handler);
				return () => {
					const i = handlers.indexOf(handler);
					if (i >= 0) handlers.splice(i, 1);
				};
			},
			unregisterOrigin(origin) {
				for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i].origin === origin) handlers.splice(i, 1);
			},
			/** Devtools/test surface — which cancellables claim to be active right now. */
			active: () => handlers.filter((handler) => handler.active()).map((handler) => handler.origin),
			/** Devtools/test surface — every registered cancellable's origin. */
			all: () => handlers.map((handler) => handler.origin)
		};
	}
	//#endregion
	//#region frontend/core/io.ts
	var STORAGE_KEYS = {
		shortcuts: "frontend.shortcuts",
		flags: "frontend.flags",
		disabledCommands: "frontend.commands.disabled"
	};
	var localStorageIo = () => ({
		get(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				return raw ? JSON.parse(raw) : fallback;
			} catch {
				return fallback;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {}
		},
		del(key) {
			try {
				localStorage.removeItem(key);
			} catch {}
		},
		keys() {
			try {
				const keys = [];
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k) keys.push(k);
				}
				return keys;
			} catch {
				return [];
			}
		}
	});
	var memoryIo = () => {
		const store = /* @__PURE__ */ new Map();
		return {
			get(key, fallback) {
				return store.has(key) ? store.get(key) : fallback;
			},
			set(key, value) {
				store.set(key, value);
			},
			del(key) {
				store.delete(key);
			},
			keys: () => [...store.keys()]
		};
	};
	//#endregion
	//#region frontend/core/shortcuts.ts
	/** Parse a shortcut string into key + modifier requirements.
	*  Format: `Mod+Mod+Key` e.g. `Ctrl+Shift+P`, `Cmd+K`, `Alt+ArrowRight`, `?`. */
	var parseShortcut = (shortcut) => {
		const parts = shortcut.split("+").map((p) => p.trim()).filter(Boolean);
		const result = {
			key: "",
			ctrl: false,
			shift: false,
			alt: false,
			meta: false
		};
		const rawKey = parts.pop() ?? "";
		result.key = rawKey.toLowerCase() === "esc" ? "Escape" : rawKey;
		for (const part of parts) {
			const m = part.toLowerCase();
			if (m === "ctrl" || m === "control") result.ctrl = true;
			else if (m === "shift") result.shift = true;
			else if (m === "alt" || m === "option") result.alt = true;
			else if (m === "meta" || m === "cmd" || m === "command") result.meta = true;
		}
		return result;
	};
	/** Render a CommandSpec.input back to a Ctrl+Shift+K style label. */
	var shortcutLabel = (input) => {
		return [
			input.ctrl ? "Ctrl" : null,
			input.meta ? "Cmd" : null,
			input.alt ? "Alt" : null,
			input.shift ? "Shift" : null,
			input.key
		].filter(Boolean).join("+");
	};
	var shortcutOf = (command) => command.shortcut ?? (command.input?.key ? shortcutLabel(command.input) : "");
	/** Shortcut label for a registered command, or null if it can't be triggered from keys. */
	var commandShortcut = (commands, id) => {
		const command = commands.get(id);
		return command ? shortcutOf(command) : null;
	};
	/** Does this DOM event match the parsed shortcut? Letter keys require shift to
	*  match exactly; non-letter keys trust event.key (so '?' matches Shift+/). */
	var keyMatchesEvent = (event, parsed) => {
		if (!(event instanceof KeyboardEvent)) return false;
		if (event.ctrlKey !== parsed.ctrl) return false;
		if (event.altKey !== parsed.alt) return false;
		if (event.metaKey !== parsed.meta) return false;
		const isLetter = /^[a-z]$/i.test(parsed.key);
		const isNamedKey = parsed.key.length > 1;
		if (isLetter && event.shiftKey !== parsed.shift) return false;
		if (isNamedKey && event.shiftKey !== parsed.shift) return false;
		if (!isLetter && parsed.shift && !event.shiftKey) return false;
		return event.key.toLowerCase() === parsed.key.toLowerCase();
	};
	var bindingParsed = (input) => ({
		key: input.key ?? "",
		ctrl: !!input.ctrl,
		shift: !!input.shift,
		alt: !!input.alt,
		meta: !!input.meta
	});
	//#endregion
	//#region frontend/core/commands.ts
	var POINTER_TYPES = new Set([
		"click",
		"pointerdown",
		"pointermove",
		"pointerup",
		"wheel"
	]);
	var originFromEvent = (event) => {
		if (!event) return "programmatic";
		if (event instanceof KeyboardEvent) return "keyboard";
		if (POINTER_TYPES.has(event.type)) return "pointer";
		return "programmatic";
	};
	/** Owns the command registry: registration, shortcut overrides, conflict checks,
	*  enabled/disabled toggles (persisted via io), and dispatch. */
	function commandsContext(bus, isFlagOn, io) {
		const commandMap = /* @__PURE__ */ new Map();
		const shortcutOverrides = io.get(STORAGE_KEYS.shortcuts, {});
		const disabledCommands = new Set(io.get(STORAGE_KEYS.disabledCommands, []));
		let enabledCache = null;
		const inputCache = /* @__PURE__ */ new Map();
		const invalidate = () => {
			enabledCache = null;
			inputCache.clear();
		};
		bus.on("flag.changed", invalidate);
		const isEnabled = (command) => command.enabled !== false && !disabledCommands.has(command.id) && isFlagOn(command.origin);
		const normalizeShortcut = (shortcut) => {
			const p = parseShortcut(shortcut);
			return [
				p.ctrl && "ctrl",
				p.meta && "meta",
				p.alt && "alt",
				p.shift && "shift",
				p.key.toLowerCase()
			].filter(Boolean).join("+");
		};
		const shortcutConflict = (id, shortcut) => {
			const norm = normalizeShortcut(shortcut);
			if (!norm.endsWith("+") && !parseShortcut(shortcut).key) return void 0;
			return [...commandMap.values()].find((command) => command.id !== id && isEnabled(command) && normalizeShortcut(shortcutOf(command)) === norm);
		};
		const applyShortcut = (command, shortcut) => {
			command.shortcut = shortcut;
			if (command.input?.on === "keydown") {
				const p = parseShortcut(shortcut);
				command.input.key = p.key;
				command.input.ctrl = p.ctrl;
				command.input.shift = p.shift;
				command.input.alt = p.alt;
				command.input.meta = p.meta;
			}
		};
		const applyOverrides = (command) => {
			const override = shortcutOverrides[command.id];
			if (override != null) applyShortcut(command, override);
		};
		return {
			register: (specs, origin) => {
				specs.forEach((input) => {
					const command = input;
					if (!command.event) command.event = command.id;
					if (origin && !command.origin) command.origin = origin;
					applyOverrides(command);
					commandMap.set(command.id, command);
				});
				invalidate();
			},
			unregister(id) {
				commandMap.delete(id);
				invalidate();
			},
			unregisterOrigin(origin) {
				for (const [id, command] of commandMap) if (command.origin === origin) commandMap.delete(id);
				invalidate();
			},
			get: (id) => commandMap.get(id),
			all: () => [...commandMap.values()],
			enabled: () => enabledCache ??= [...commandMap.values()].filter(isEnabled),
			enabledForInput(type) {
				let cached = inputCache.get(type);
				if (!cached) {
					cached = (enabledCache ??= [...commandMap.values()].filter(isEnabled)).filter((command) => command.input?.on === type);
					inputCache.set(type, cached);
				}
				return cached;
			},
			isEnabled,
			shortcutConflict,
			setShortcut(id, shortcut) {
				const command = commandMap.get(id);
				if (!command) return false;
				const next = shortcut.trim();
				if (shortcutConflict(id, next)) return false;
				applyShortcut(command, next);
				shortcutOverrides[id] = next;
				bus.emit("command.shortcut.changed", {
					id,
					shortcut: next
				});
				return true;
			},
			setEnabled(id, enabled) {
				if (!commandMap.get(id)) return false;
				if (enabled) disabledCommands.delete(id);
				else disabledCommands.add(id);
				bus.emit("command.enabled.changed", {
					id,
					enabled
				});
				invalidate();
				return true;
			},
			run(id, source = {}) {
				const command = commandMap.get(id);
				if (!command || !isEnabled(command) || command.available?.(source) === false) return false;
				const resolved = source.origin ? source : {
					...source,
					origin: originFromEvent(source.event)
				};
				const payload = command.payload?.(resolved);
				if (command.picker) {
					bus.emit("commandPicker.open", {
						commandId: id,
						source: resolved
					});
					return true;
				}
				if (command.form?.shouldOpen?.(payload, resolved)) {
					bus.emit("commandForm.open", {
						commandId: id,
						seed: command.form.seed?.(payload, resolved) ?? {}
					});
					return true;
				}
				bus.forward(command.event, payload);
				return true;
			}
		};
	}
	/** Routes raw DOM events to commands. Click → `[data-command]`; key/pointer/wheel
	*  → match against registered command.input bindings. Two strictness layers
	*  shield "in another scope" inputs from spilling into app commands:
	*
	*    1. Typing — inside any input/textarea/select/contenteditable, non-global
	*       commands without a `selector` are skipped (so typing the letter "a"
	*       in a text field doesn't create a node).
	*    2. Modal — when a modal is mounted, non-global commands whose event
	*       target is outside the modal are skipped. Backdrop, form fields, and
	*       command buttons inside the modal still work; A/E/G/etc on the
	*       background do nothing until the modal closes. */
	function inputRouter(commands, perf) {
		return { start(root = document) {
			/** A modal is "mounted" when [data-place="modal"] has any rendered children. */
			const modalScopeEl = () => {
				const placeEl = (root instanceof Document ? root : root).querySelector("[data-place=\"modal\"]");
				return placeEl?.firstElementChild ? placeEl : null;
			};
			const targetInModal = (target, modal) => !!modal && !!target && modal.contains(target);
			const route = (event) => {
				const rawTarget = event.target instanceof Element ? event.target : null;
				const trace = perf?.beginInput(event.type, event, rawTarget);
				const candidates = [];
				const matched = [];
				const runCommand = (id, target) => {
					matched.push(id);
					const run = () => commands.run(id, {
						event,
						target
					});
					return perf?.enabled() ? perf.measure(`Command.run.${id}`, run) : run();
				};
				try {
					const typing = event instanceof KeyboardEvent && (/input|textarea|select/i.test(rawTarget?.tagName ?? "") || rawTarget instanceof HTMLElement && rawTarget.isContentEditable);
					const modal = modalScopeEl();
					const inModal = targetInModal(rawTarget, modal);
					const button = event.type === "click" ? rawTarget?.closest("[data-command]") : null;
					if (button instanceof HTMLElement) {
						if (modal && !modal.contains(button)) return;
						const commandId = button.dataset.command;
						candidates.push(commandId);
						event.preventDefault();
						runCommand(commandId, button);
						return;
					}
					const commandsForInput = commands.enabledForInput(event.type);
					candidates.push(...commandsForInput.map((command) => command.id));
					for (const command of commandsForInput) {
						const binding = command.input;
						if (!binding || binding.on !== event.type) continue;
						if (event instanceof KeyboardEvent && (!binding.key || !keyMatchesEvent(event, bindingParsed(binding)))) continue;
						const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
						if (!(target instanceof Element) || binding.selector && !target) continue;
						if (typing && !binding.global && !binding.selector) continue;
						if (modal && !binding.global && !inModal) continue;
						if (binding.when && !binding.when(event, target)) continue;
						if (binding.prevent) event.preventDefault();
						runCommand(command.id, target);
						if (binding.stop) break;
					}
				} finally {
					trace?.end({
						candidates,
						matched
					});
				}
			};
			const types = [
				"click",
				"dblclick",
				"keydown",
				"pointerdown",
				"pointermove",
				"pointerup",
				"wheel",
				"input",
				"change",
				"focusout",
				"paste"
			];
			types.forEach((type) => root.addEventListener(type, route, type === "wheel" ? { passive: false } : void 0));
			return () => types.forEach((type) => root.removeEventListener(type, route));
		} };
	}
	//#endregion
	//#region frontend/core/item-ref.ts
	var itemKey = (ref) => JSON.stringify([
		ref.parent ?? [],
		ref.kind,
		ref.id
	]);
	var refKey = (ref) => `${ref.kind}:${ref.id}`;
	var sameItemRef = (a, b) => a === b || !!a && !!b && itemKey(a) === itemKey(b);
	var nodeRef = (id) => ({
		kind: "node",
		id
	});
	var edgeRef = (id) => ({
		kind: "edge",
		id
	});
	//#endregion
	//#region frontend/core/decorations.ts
	/** decorations — *transient, per-item visual state keyed by origin*.
	*
	*  Two facets of one idea ("how an item looks right now, beyond its base
	*  render"), merged into ONE context so there is ONE `.changed` signal and ONE
	*  origin teardown:
	*    - `modes`    → state classes applied to the item element   (was itemModes)
	*    - `overlays` → floating chips drawn over the item          (was itemOverlays)
	*
	*  Mergeable/splittable by design: each facet is a self-contained object, so
	*  splitting one back into its own context is a lift-and-rename. Everything an
	*  origin set is dropped together by `unregisterOrigin` — that is what makes a
	*  flag-flip a clean teardown. */
	function decorationsContext(bus) {
		const modeMap = /* @__PURE__ */ new Map();
		const overlayMap = /* @__PURE__ */ new Map();
		const changed = (facet, source) => bus.emit("decoration.changed", {
			facet,
			source
		});
		const modesFor = (ref) => [...modeMap.values()].flat().filter((e) => sameItemRef(e.ref, ref));
		const dropRef = (map, ref) => {
			let touched = false;
			for (const [src, list] of map) {
				const next = list.filter((e) => !sameItemRef(e.ref, ref));
				if (next.length === list.length) continue;
				touched = true;
				if (next.length) map.set(src, next);
				else map.delete(src);
			}
			return touched;
		};
		const remove = (ref) => {
			if (dropRef(modeMap, ref)) changed("modes");
			if (dropRef(overlayMap, ref)) changed("overlays");
		};
		const modes = {
			set(source, mode, refs, className = mode) {
				modeMap.set(source, refs.map((ref) => ({
					source,
					mode,
					ref,
					className
				})));
				changed("modes", source);
			},
			for: modesFor,
			has(ref, mode) {
				return modesFor(ref).some((e) => e.mode === mode);
			},
			all() {
				return [...modeMap.values()].flat().sort((a, b) => itemKey(a.ref).localeCompare(itemKey(b.ref)));
			}
		};
		const overlays = {
			set(source, next) {
				overlayMap.set(source, next);
				changed("overlays", source);
			},
			all() {
				return [...overlayMap.values()].flat();
			}
		};
		bus.on("graph.node.deleted", ({ id }) => remove(nodeRef(id)));
		bus.on("graph.edge.deleted", ({ id }) => remove(edgeRef(id)));
		return {
			modes,
			overlays,
			remove,
			/** Drop every mode AND overlay this origin set — used by registry teardown. */
			unregisterOrigin(origin) {
				const hadModes = modeMap.delete(origin);
				const hadOverlays = overlayMap.delete(origin);
				if (hadModes) changed("modes", origin);
				if (hadOverlays) changed("overlays", origin);
			}
		};
	}
	//#endregion
	//#region frontend/core/flags.ts
	function createFlags(bus, initial = {}, io = localStorageIo()) {
		const persisted = io.get(STORAGE_KEYS.flags, {});
		const state = {
			...initial,
			...persisted
		};
		const deps = /* @__PURE__ */ new Map();
		const kinds = /* @__PURE__ */ new Map();
		return {
			all: () => ({ ...state }),
			isOn: (name) => state[name] !== false,
			declare(name, defaultOn = true, requires, kind) {
				if (!(name in state)) state[name] = defaultOn;
				if (requires?.length) deps.set(name, requires);
				if (kind) kinds.set(name, kind);
			},
			set(name, on) {
				state[name] = on;
				bus.emit("flag.changed");
			},
			declared: (kind) => kind == null ? Object.keys(state) : Object.keys(state).filter((name) => kinds.get(name) === kind),
			kind: (name) => kinds.get(name),
			requires: (name) => deps.get(name) ?? []
		};
	}
	//#endregion
	//#region frontend/core/hierarchy.ts
	/** hierarchy — the app's tree of navigable, orderable items.
	*
	*  It answers the two questions the app keeps asking:
	*    1. *ordered importance* — what nests under what, and in what order
	*       (`tree`, `roots`, `childrenOf`, sorted by `HierarchyItem.order`).
	*    2. *shortest paths* — how to get from an item to its context
	*       (`parentChain` / `ancestors` upward, `childrenOf` downward → log-N
	*       navigation for jump, search, and contextual commands).
	*
	*  Two registration facets, merged from the old hierarchy + itemTargets
	*  contexts so nesting and navigation share one seam:
	*    - `sources` → who the items are (was itemTargets providers)
	*    - `parents` → who is whose parent (was hierarchy providers)
	*  With no sources/parents the app is a flat graph. `createNesting` (below) is
	*  the matching *mutable* engine a containing kind uses to maintain its links. */
	function hierarchyContext() {
		const sources = /* @__PURE__ */ new Map();
		const parents = /* @__PURE__ */ new Map();
		const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
		const items = () => [...sources.values()].flatMap((source) => source());
		const parentRefOf = (ref) => {
			for (const provider of parents.values()) {
				const parent = provider.parentRefOf(ref);
				if (parent) return parent;
			}
		};
		/** Outermost-first chain of typed ancestor refs, or [] when root. */
		const parentChain = (ref) => {
			const chain = [];
			const seen = /* @__PURE__ */ new Set();
			let current = parentRefOf(ref);
			while (current) {
				const k = refKey(current);
				if (seen.has(k)) break;
				seen.add(k);
				chain.unshift(current);
				current = parentRefOf(current);
			}
			return chain;
		};
		const parentIds = (ref) => {
			const chain = parentChain(ref);
			return chain.length ? chain.map((p) => p.id) : void 0;
		};
		const get = (ref) => items().find((it) => sameItemRef(it.ref, ref));
		const anchor = (ref) => get(ref)?.anchor ?? null;
		const childrenOf = (ref) => items().filter((it) => {
			const p = parentRefOf(it.ref);
			return !!p && sameItemRef(p, ref);
		}).sort(byOrder);
		/** All items with no parent, ordered. */
		const roots = () => items().filter((it) => !parentRefOf(it.ref)).sort(byOrder);
		/** Assemble the full forest in a single pass (parent index, not O(n²) walk). */
		const tree = () => {
			const list = items();
			const childIndex = /* @__PURE__ */ new Map();
			const rootList = [];
			for (const it of list) {
				const parent = parentRefOf(it.ref);
				if (parent) {
					const pkey = refKey(parent);
					(childIndex.get(pkey) ?? childIndex.set(pkey, []).get(pkey)).push(it);
				} else rootList.push(it);
			}
			const build = (it, seen) => {
				const k = refKey(it.ref);
				const kids = seen.has(k) ? [] : (childIndex.get(k) ?? []).slice().sort(byOrder);
				const nextSeen = new Set(seen).add(k);
				return {
					...it,
					children: kids.map((child) => build(child, nextSeen))
				};
			};
			return rootList.sort(byOrder).map((it) => build(it, /* @__PURE__ */ new Set()));
		};
		return {
			/** Register the items a system contributes (ref, label, anchor?, order?). */
			sources: { register(origin, source) {
				sources.set(origin, source);
				return () => {
					if (sources.get(origin) === source) sources.delete(origin);
				};
			} },
			/** Register a parent-link provider (containers, future groups). */
			parents: { register(origin, provider) {
				parents.set(origin, provider);
				return () => {
					if (parents.get(origin) === provider) parents.delete(origin);
				};
			} },
			parentRefOf,
			parentChain,
			parentIds,
			ancestors: parentChain,
			items,
			targets: items,
			get,
			anchor,
			childrenOf,
			roots,
			tree,
			unregisterOrigin(origin) {
				sources.delete(origin);
				parents.delete(origin);
			}
		};
	}
	/** Nesting machinery for one parent kind. The owning system passes its parents
	*  map and a kind label; this maintains the child→parent index + cycle guard,
	*  and `onChange(parentId)` fires when a parent's Children list changes (wire it
	*  to emit a `*.children.changed` fact). This is the single piece that makes
	*  nestedness composable: any "I hold a list of refs" system gets parent
	*  walking, cycle-safe add/remove, and a `hierarchy.parents` provider for ~30
	*  lines of its own file. */
	function createNesting(opts) {
		const { parents, parentKind, onChange } = opts;
		const parentOf = /* @__PURE__ */ new Map();
		const parentRefOf = (ref) => {
			const pid = parentOf.get(refKey(ref));
			return pid && parents.has(pid) ? {
				kind: parentKind,
				id: pid
			} : void 0;
		};
		const isAncestorOrSelf = (ancestor, descendant) => {
			let cur = descendant;
			const seen = /* @__PURE__ */ new Set();
			while (cur) {
				const ck = refKey(cur);
				if (seen.has(ck)) return false;
				seen.add(ck);
				if (sameItemRef(cur, ancestor)) return true;
				const pid = parentOf.get(ck);
				cur = pid ? {
					kind: parentKind,
					id: pid
				} : void 0;
			}
			return false;
		};
		const detach = (childRef) => {
			const ck = refKey(childRef);
			const prev = parentOf.get(ck);
			if (!prev) return void 0;
			const p = parents.get(prev);
			if (p) p.Children = p.Children.filter((r) => !sameItemRef(r, childRef));
			parentOf.delete(ck);
			onChange?.(prev);
			return prev;
		};
		return {
			parentRefOf,
			isAncestorOrSelf,
			remove: detach,
			add(parentId, childRef) {
				const p = parents.get(parentId);
				if (!p) return "noop";
				if (isAncestorOrSelf(childRef, {
					kind: parentKind,
					id: parentId
				})) return "cycle";
				const prev = parentOf.get(refKey(childRef));
				if (prev === parentId) return "noop";
				if (prev) detach(childRef);
				if (!p.Children.some((r) => sameItemRef(r, childRef))) p.Children.push(childRef);
				parentOf.set(refKey(childRef), parentId);
				onChange?.(parentId);
				return "ok";
			}
		};
	}
	//#endregion
	//#region frontend/core/keyboard.ts
	function keyboardCaptureContext() {
		let active = null;
		const teardowns = /* @__PURE__ */ new WeakMap();
		const remove = (capture) => {
			if (!capture) return;
			teardowns.get(capture)?.();
			teardowns.delete(capture);
			capture.input.remove();
		};
		return {
			active: () => active?.id ?? null,
			capture(id, options = {}) {
				remove(active);
				const input = document.createElement("input");
				input.type = "text";
				input.autocomplete = "off";
				input.dataset.keyboardMode = id;
				input.setAttribute("aria-hidden", "true");
				input.className = ["keyboard-capture", options.className].filter(Boolean).join(" ");
				document.body.append(input);
				const capture = {
					id,
					input,
					focus: () => input.focus({ preventScroll: true }),
					clear: () => {
						input.value = "";
					},
					value: () => input.value,
					stop: () => {
						if (active === capture) active = null;
						remove(capture);
					}
				};
				const keyHandler = options.onKey ? (event) => options.onKey(event, capture) : null;
				const inputHandler = options.onInput ? (event) => options.onInput(event, capture) : null;
				if (keyHandler) input.addEventListener("keydown", keyHandler);
				if (inputHandler) input.addEventListener("input", inputHandler);
				teardowns.set(capture, () => {
					if (keyHandler) input.removeEventListener("keydown", keyHandler);
					if (inputHandler) input.removeEventListener("input", inputHandler);
				});
				active = capture;
				capture.focus();
				return capture;
			},
			unregisterOrigin(origin) {
				if (active?.id !== origin) return;
				remove(active);
				active = null;
			}
		};
	}
	//#endregion
	//#region frontend/core/collection-commands.ts
	var singular = (id) => id.endsWith("s") ? id.slice(0, -1) : id;
	var collectionKind = (collection) => collection.kind || collection.entity?.kind || singular(collection.id);
	var collectionCreateCommand = (collection) => {
		const kind = collectionKind(collection);
		return kind === "graph" ? "graph.create" : `editing.${kind}.create`;
	};
	var collectionDeleteCommand = (collection) => {
		const kind = collectionKind(collection);
		return kind === "graph" ? "graph.delete" : `graph.${kind}.delete`;
	};
	var collectionSelectCommand = (collection) => {
		return collectionKind(collection) === "graph" ? "graph.switch" : "selection.item.select";
	};
	//#endregion
	//#region frontend/core/model-registry.ts
	var createModelRegistry = (model, flags) => {
		const entities = /* @__PURE__ */ new Map();
		const collections = /* @__PURE__ */ new Map();
		const defaultItemId = (item) => {
			const id = item.id;
			return typeof id === "string" ? id : "";
		};
		const resolveCollection = (collectionDef) => {
			const kind = collectionDef.kind ?? collectionDef.entity?.kind ?? singular(collectionDef.id);
			const explicitEntity = collectionDef.entity;
			const itemId = collectionDef.itemId ?? defaultItemId;
			/** Resolve the entity at use-time, not at boot — systems register their
			*  entities (graph → node/edge, containers → container) during start(),
			*  *after* the model's initial seed runs. A collection declared in the
			*  static seed must still resolve its entity once that registration lands. */
			const liveEntity = () => explicitEntity ?? entities.get(kind);
			const labelOf = collectionDef.itemLabel ?? ((item) => liveEntity()?.labelOf(item) ?? itemId(item));
			const { entity: _omitEntity, ...rest } = collectionDef;
			const resolved = {
				...rest,
				kind,
				itemId,
				itemLabel: labelOf,
				search: collectionDef.search ?? true,
				order: collectionDef.order ?? "created"
			};
			Object.defineProperty(resolved, "entity", {
				get: () => liveEntity(),
				enumerable: true,
				configurable: true
			});
			return resolved;
		};
		const registerEntity = (entityDef) => {
			entities.set(entityDef.kind, entityDef);
			return () => {
				if (entities.get(entityDef.kind) === entityDef) entities.delete(entityDef.kind);
			};
		};
		const registerCollection = (collectionDef) => {
			const resolved = resolveCollection(collectionDef);
			collections.set(resolved.id, resolved);
			return () => {
				if (collections.get(resolved.id) === resolved) collections.delete(resolved.id);
			};
		};
		model.entities.forEach((entityDef) => registerEntity(entityDef));
		model.collections.forEach((collectionDef) => registerCollection(collectionDef));
		const filterAbilities = (entityDef) => {
			if (!flags) return entityDef;
			const liveAbilities = entityDef.abilities.filter((ability) => flags.isOn(`ability.${ability.id}`));
			return liveAbilities.length === entityDef.abilities.length ? entityDef : {
				...entityDef,
				abilities: liveAbilities
			};
		};
		const ordered = () => [...entities.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		return {
			entity(kind) {
				const entityDef = entities.get(kind);
				return entityDef ? filterAbilities(entityDef) : void 0;
			},
			collection(id) {
				return collections.get(id);
			},
			/** Live entities, ordered by `EntityDef.order` (lower first = paints behind). */
			entities: () => ordered().map((e) => filterAbilities(e)),
			collections: () => [...collections.values()],
			/** Raw, unfiltered, ordered — DX validator uses this to compare declared vs live. */
			rawEntities: () => ordered(),
			/** Add an entity at runtime. Returns a teardown that removes it. */
			registerEntity,
			/** Add a collection at runtime. Returns a teardown that removes it. */
			registerCollection
		};
	};
	//#endregion
	//#region frontend/model/graph.ts
	var parentKey = (parent) => JSON.stringify(parent ?? []);
	var GraphNode = class {
		constructor(graph, id, draft = {}) {
			this.graph = graph;
			this.id = id;
			this.kind = "node";
			this.Label = draft.Label ?? { text: id };
			this.Size = draft.Size ?? {
				w: 150,
				h: 64
			};
			this.Position = draft.Position;
			this.NodeType = draft.NodeType ?? "text";
			this.Description = draft.Description ?? "";
			this.ComputeMs = draft.ComputeMs;
			this.ExpectedRps = draft.ExpectedRps;
			this.LatencyMs = draft.LatencyMs;
			this.Purpose = draft.Purpose;
			this.Assumptions = draft.Assumptions;
			this.Limits = draft.Limits;
			this.WhatThen = draft.WhatThen;
			this.Observability = draft.Observability;
			this.FailureMode = draft.FailureMode;
			this.DataScale = draft.DataScale;
			this.FreshnessMs = draft.FreshnessMs;
		}
	};
	var GraphEdge = class {
		constructor(graph, id, draft) {
			this.graph = graph;
			this.id = id;
			this.kind = "edge";
			this.From = draft.From;
			this.To = draft.To;
			this.Label = draft.Label;
			this.EdgeKind = draft.EdgeKind ?? draft.Label?.text;
			this.LatencyMs = draft.LatencyMs;
			this.ThroughputRps = draft.ThroughputRps;
			this.PayloadKb = draft.PayloadKb;
			this.Purpose = draft.Purpose;
			this.Assumptions = draft.Assumptions;
			this.Limits = draft.Limits;
			this.WhatThen = draft.WhatThen;
			this.Observability = draft.Observability;
			this.FailureMode = draft.FailureMode;
			this.DataScale = draft.DataScale;
			this.FreshnessMs = draft.FreshnessMs;
		}
	};
	var Graph = class Graph {
		static new(id) {
			return new Graph(id);
		}
		static {
			this.CELL = 256;
		}
		cellKey(x, y) {
			return `${Math.floor(x / Graph.CELL)},${Math.floor(y / Graph.CELL)}`;
		}
		indexNode(node) {
			const p = node.Position;
			if (!p) return;
			const key = this.cellKey(p.x, p.y);
			const prev = this.nodeCell.get(node.id);
			if (prev === key) return;
			if (prev) this.grid.get(prev)?.delete(node.id);
			(this.grid.get(key) ?? this.grid.set(key, /* @__PURE__ */ new Set()).get(key)).add(node.id);
			this.nodeCell.set(node.id, key);
		}
		unindexNode(id) {
			const prev = this.nodeCell.get(id);
			if (prev) {
				this.grid.get(prev)?.delete(id);
				this.nodeCell.delete(id);
			}
		}
		/** Node ids whose cell overlaps `rect`. A node spans at most one extra cell
		*  beyond its center, and callers pass a margin-expanded rect, so cell-level
		*  granularity is sufficient (the renderer still has exact bounds to refine). */
		nodeIdsInRect(rect) {
			const x0 = Math.floor(rect.x / Graph.CELL), x1 = Math.floor((rect.x + rect.w) / Graph.CELL);
			const y0 = Math.floor(rect.y / Graph.CELL), y1 = Math.floor((rect.y + rect.h) / Graph.CELL);
			const out = [];
			for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) this.grid.get(`${cx},${cy}`)?.forEach((id) => out.push(id));
			return out;
		}
		addAdj(edge) {
			(this.adjacency.get(edge.From) ?? this.adjacency.set(edge.From, /* @__PURE__ */ new Set()).get(edge.From)).add(edge.id);
			(this.adjacency.get(edge.To) ?? this.adjacency.set(edge.To, /* @__PURE__ */ new Set()).get(edge.To)).add(edge.id);
		}
		removeAdj(edge) {
			this.adjacency.get(edge.From)?.delete(edge.id);
			this.adjacency.get(edge.To)?.delete(edge.id);
		}
		constructor(id) {
			this.id = id;
			this.nextNode = 1;
			this.nextEdge = 1;
			this.items = /* @__PURE__ */ new Map();
			this.edgeMap = /* @__PURE__ */ new Map();
			this.itemStores = /* @__PURE__ */ new Map();
			this.nodeArr = null;
			this.edgeArr = null;
			this.adjacency = /* @__PURE__ */ new Map();
			this.grid = /* @__PURE__ */ new Map();
			this.nodeCell = /* @__PURE__ */ new Map();
			this.registerItemStore("node", () => this.nodes());
			this.registerItemStore("edge", () => this.edges());
		}
		registerItemStore(kind, provider) {
			this.itemStores.set(kind, provider);
			return () => {
				if (this.itemStores.get(kind) === provider) this.itemStores.delete(kind);
			};
		}
		itemsOfKind(kind) {
			const provider = this.itemStores.get(kind);
			if (!provider) return [];
			return kind === "node" || kind === "edge" ? provider() : [...provider()];
		}
		getItem(ref) {
			if (ref.kind === "node") return this.items.get(ref.id);
			if (ref.kind === "edge") return this.edgeMap.get(ref.id);
			return this.itemsOfKind(ref.kind).find((item) => {
				if (!item || typeof item !== "object") return false;
				const candidate = item;
				if (candidate.id !== ref.id) return false;
				if (candidate.parent == null) return true;
				return parentKey(candidate.parent) === parentKey(ref.parent);
			});
		}
		createEdge(draft) {
			const id = `r${this.nextEdge++}`;
			const edge = new GraphEdge(this, id, draft);
			this.edgeMap.set(id, edge);
			this.addAdj(edge);
			this.edgeArr = null;
			return edge;
		}
		getEdge(id) {
			return this.edgeMap.get(id);
		}
		edges() {
			return this.edgeArr ??= [...this.edgeMap.values()];
		}
		edgesOf(nodeId) {
			const ids = this.adjacency.get(nodeId);
			if (!ids) return [];
			const out = [];
			ids.forEach((eid) => {
				const e = this.edgeMap.get(eid);
				if (e) out.push(e);
			});
			return out;
		}
		updateEdge(id, patch) {
			const edge = this.edgeMap.get(id);
			if (!edge) return false;
			const reindex = "From" in patch || "To" in patch;
			if (reindex) this.removeAdj(edge);
			Object.assign(edge, patch);
			if (reindex) this.addAdj(edge);
			return true;
		}
		deleteEdge(id) {
			const edge = this.edgeMap.get(id);
			if (!edge) return false;
			this.removeAdj(edge);
			this.edgeMap.delete(id);
			this.edgeArr = null;
			return true;
		}
		getNode(id) {
			return this.items.get(id);
		}
		/** Create-or-place-near. `nearPosition` is the caller's job — Graph stays unaware of selection. */
		createNode(draft = {}, options = {}) {
			const id = `e${this.nextNode++}`;
			const node = new GraphNode(this, id, this.withDefaults(draft, options));
			this.items.set(id, node);
			this.indexNode(node);
			this.nodeArr = null;
			return node;
		}
		node(value = {}, options = {}) {
			if (typeof value === "string") return this.items.get(value);
			return this.createNode(value, options);
		}
		nodes() {
			return this.nodeArr ??= [...this.items.values()];
		}
		updateNode(id, patch) {
			const node = this.items.get(id);
			if (!node) return false;
			Object.assign(node, patch);
			if ("Position" in patch) this.indexNode(node);
			return true;
		}
		deleteNode(id) {
			const incident = this.adjacency.get(id);
			if (incident) {
				[...incident].forEach((eid) => {
					const e = this.edgeMap.get(eid);
					if (e) {
						this.removeAdj(e);
						this.edgeMap.delete(eid);
					}
				});
				this.adjacency.delete(id);
				this.edgeArr = null;
			}
			const removed = this.items.delete(id);
			if (removed) {
				this.unindexNode(id);
				this.nodeArr = null;
			}
			return removed;
		}
		withDefaults(draft, options) {
			const anchor = options.nearPosition ?? options.at ?? {
				x: 0,
				y: 0
			};
			const hasAnchor = options.nearPosition != null;
			const index = this.items.size;
			if (hasAnchor) {
				const row = index % 3;
				return {
					...draft,
					Position: draft.Position ?? {
						x: anchor.x + 220,
						y: anchor.y + row * 100
					}
				};
			}
			const cols = 3;
			const col = index % cols;
			const row = Math.floor(index / cols);
			return {
				...draft,
				Position: draft.Position ?? {
					x: anchor.x + (col - (cols - 1) / 2) * 240,
					y: anchor.y + row * 100
				}
			};
		}
		snapshot() {
			return {
				nodes: this.nodes().map(({ id, Label, Position, Size, NodeType, Description, ComputeMs, ExpectedRps, LatencyMs, Purpose, Assumptions, Limits, WhatThen, Observability, FailureMode, DataScale, FreshnessMs }) => ({
					id,
					Label,
					Position,
					Size,
					NodeType,
					Description,
					ComputeMs,
					ExpectedRps,
					LatencyMs,
					Purpose,
					Assumptions,
					Limits,
					WhatThen,
					Observability,
					FailureMode,
					DataScale,
					FreshnessMs
				})),
				edges: this.edges().map(({ id, From, To, Label, EdgeKind, LatencyMs, ThroughputRps, PayloadKb, Purpose, Assumptions, Limits, WhatThen, Observability, FailureMode, DataScale, FreshnessMs }) => ({
					id,
					From,
					To,
					Label,
					EdgeKind,
					LatencyMs,
					ThroughputRps,
					PayloadKb,
					Purpose,
					Assumptions,
					Limits,
					WhatThen,
					Observability,
					FailureMode,
					DataScale,
					FreshnessMs
				}))
			};
		}
		replace(snapshot) {
			this.items.clear();
			this.edgeMap.clear();
			this.adjacency.clear();
			this.grid.clear();
			this.nodeCell.clear();
			let maxNode = 0;
			let maxEdge = 0;
			snapshot.nodes.forEach((draft) => {
				const node = new GraphNode(this, draft.id, draft);
				this.items.set(node.id, node);
				this.indexNode(node);
				const seq = parseInt(node.id.replace(/^\D+/, ""), 10);
				if (Number.isFinite(seq)) maxNode = Math.max(maxNode, seq);
			});
			snapshot.edges.forEach((draft) => {
				if (!this.items.has(draft.From) || !this.items.has(draft.To) || draft.From === draft.To) return;
				const edge = new GraphEdge(this, draft.id, draft);
				this.edgeMap.set(edge.id, edge);
				this.addAdj(edge);
				const seq = parseInt(edge.id.replace(/^\D+/, ""), 10);
				if (Number.isFinite(seq)) maxEdge = Math.max(maxEdge, seq);
			});
			this.nextNode = maxNode + 1;
			this.nextEdge = maxEdge + 1;
			this.nodeArr = null;
			this.edgeArr = null;
		}
	};
	function graphStore() {
		let next = 1;
		const graphs = /* @__PURE__ */ new Map();
		const nextId = () => {
			let id = `g${next++}`;
			while (graphs.has(id)) id = `g${next++}`;
			return id;
		};
		const create = (id = nextId()) => {
			const existing = graphs.get(id);
			if (existing) return existing;
			const graph = Graph.new(id);
			graphs.set(id, graph);
			return graph;
		};
		let current = create();
		return {
			get current() {
				return current;
			},
			all: () => [...graphs.values()],
			get: (id) => graphs.get(id),
			create,
			delete(id) {
				if (graphs.size <= 1) return current;
				graphs.delete(id);
				if (current.id === id) current = graphs.values().next().value ?? create();
				return current;
			},
			switch(id) {
				current = graphs.get(id) ?? create(id);
				return current;
			}
		};
	}
	//#endregion
	//#region frontend/core/perf.ts
	var now = () => performance.now();
	var MAX_TIMELINE = 2e3;
	var MAX_INPUTS = 500;
	var MAX_LONG_TASKS = 200;
	var pushCapped = (rows, row, max) => {
		rows.push(row);
		if (rows.length > max) rows.splice(0, rows.length - max);
	};
	var labelFor = (el) => {
		const id = el.id ? `#${el.id}` : "";
		const cls = [...el.classList].slice(0, 3).map((name) => `.${name}`).join("");
		const item = el instanceof HTMLElement && el.dataset.itemKind && el.dataset.itemId ? `[${el.dataset.itemKind}:${el.dataset.itemId}]` : "";
		return `${el.localName}${id}${cls}${item}`;
	};
	var selectorPathFor = (target, limit = 4) => {
		if (!target) return [];
		const parts = [];
		let el = target;
		while (el && parts.length < limit) {
			parts.unshift(labelFor(el));
			el = el.parentElement;
		}
		return parts;
	};
	var selectorFor$1 = (target) => selectorPathFor(target).join(" > ");
	var eventPathFor = (event, target) => {
		const labels = (typeof event?.composedPath === "function" ? event.composedPath() : []).filter((entry) => entry instanceof Element).slice(0, 8).map(labelFor);
		return labels.length ? labels : selectorPathFor(target, 8).reverse();
	};
	var eventStartTime = (event, processingStart) => {
		const start = event?.timeStamp ?? processingStart;
		const delay = processingStart - start;
		return Number.isFinite(delay) && delay >= -1 && delay < 6e4 ? start : processingStart;
	};
	function createPerfApi(initialEnabled = false) {
		let on = initialEnabled;
		const timings = /* @__PURE__ */ new Map();
		const counts = /* @__PURE__ */ new Map();
		const samples = /* @__PURE__ */ new Map();
		const marks = [];
		const timeline = [];
		const inputs = [];
		const longTasks = [];
		const stack = [];
		const callEdges = /* @__PURE__ */ new Map();
		let nextId = 1;
		const recordTiming = (label, ms) => {
			const row = timings.get(label) ?? timings.set(label, {
				calls: 0,
				totalMs: 0,
				maxMs: 0
			}).get(label);
			row.calls++;
			row.totalMs += ms;
			row.maxMs = Math.max(row.maxMs, ms);
		};
		const recordSpan = (span, parent) => {
			pushCapped(timeline, span, MAX_TIMELINE);
			if (!parent) return;
			const key = `${parent.label}=>${span.label}`;
			const edge = callEdges.get(key) ?? callEdges.set(key, {
				from: parent.label,
				to: span.label,
				calls: 0,
				totalMs: 0,
				maxMs: 0
			}).get(key);
			edge.calls++;
			edge.totalMs += span.duration;
			edge.maxMs = Math.max(edge.maxMs, span.duration);
		};
		return {
			enabled: () => on,
			setEnabled(next) {
				on = next;
			},
			reset() {
				timings.clear();
				counts.clear();
				samples.clear();
				marks.length = 0;
				timeline.length = 0;
				inputs.length = 0;
				longTasks.length = 0;
				stack.length = 0;
				callEdges.clear();
			},
			count(label, by = 1) {
				if (!on) return;
				counts.set(label, (counts.get(label) ?? 0) + by);
			},
			sample(label, value) {
				if (!on || !Number.isFinite(value)) return;
				const row = samples.get(label) ?? samples.set(label, {
					samples: 0,
					total: 0,
					min: Infinity,
					max: -Infinity,
					last: value
				}).get(label);
				row.samples++;
				row.total += value;
				row.min = Math.min(row.min, value);
				row.max = Math.max(row.max, value);
				row.last = value;
			},
			mark(label) {
				if (!on) return;
				marks.push({
					label,
					at: now()
				});
			},
			measure(label, fn) {
				if (!on) return fn();
				const start = now();
				const parent = stack[stack.length - 1];
				const frame = {
					id: nextId++,
					label
				};
				stack.push(frame);
				try {
					return fn();
				} finally {
					const end = now();
					const duration = end - start;
					stack.pop();
					recordTiming(label, duration);
					recordSpan({
						id: frame.id,
						label,
						start,
						end,
						duration,
						parentId: parent?.id
					}, parent);
				}
			},
			beginInput(name, event, target) {
				if (!on) return void 0;
				const processingStart = now();
				const startTime = eventStartTime(event, processingStart);
				const inputDelay = Math.max(0, processingStart - startTime);
				const parent = stack[stack.length - 1];
				const frame = {
					id: nextId++,
					label: `Input.${name}`
				};
				stack.push(frame);
				let done = false;
				return { end(trace = {}) {
					if (done) return;
					done = true;
					const processingEnd = now();
					const processingDuration = Math.max(0, processingEnd - processingStart);
					if (stack[stack.length - 1]?.id === frame.id) stack.pop();
					recordSpan({
						id: frame.id,
						label: frame.label,
						start: processingStart,
						end: processingEnd,
						duration: processingDuration,
						parentId: parent?.id
					}, parent);
					pushCapped(inputs, {
						id: nextId++,
						source: "router",
						name,
						target: selectorFor$1(target),
						startTime,
						processingStart,
						processingEnd,
						duration: inputDelay + processingDuration,
						inputDelay,
						processingDuration,
						presentationDelay: 0,
						path: eventPathFor(event, target),
						candidates: trace.candidates,
						matched: trace.matched
					}, MAX_INPUTS);
				} };
			},
			recordInput(row) {
				if (!on) return;
				pushCapped(inputs, {
					id: nextId++,
					...row
				}, MAX_INPUTS);
			},
			recordLongTask(row) {
				if (!on) return;
				pushCapped(longTasks, {
					id: nextId++,
					...row
				}, MAX_LONG_TASKS);
			},
			snapshot() {
				const timingRows = [...timings.entries()].map(([label, row]) => ({
					label,
					calls: row.calls,
					totalMs: row.totalMs,
					avgMs: row.totalMs / Math.max(1, row.calls),
					maxMs: row.maxMs
				})).sort((a, b) => b.totalMs - a.totalMs);
				const countRows = [...counts.entries()].map(([label, count]) => ({
					label,
					count
				})).sort((a, b) => b.count - a.count);
				const sampleRows = [...samples.entries()].map(([label, row]) => ({
					label,
					samples: row.samples,
					min: row.min,
					max: row.max,
					avg: row.total / Math.max(1, row.samples),
					last: row.last
				})).sort((a, b) => b.max - a.max);
				const graphRows = [...callEdges.values()].map((row) => ({ ...row })).sort((a, b) => b.totalMs - a.totalMs);
				return {
					enabled: on,
					timings: timingRows,
					counts: countRows,
					samples: sampleRows,
					marks: [...marks],
					timeline: [...timeline],
					callGraph: graphRows,
					inputs: [...inputs],
					longTasks: [...longTasks]
				};
			}
		};
	}
	var WRAPPED = Symbol("ecg.perf.wrapped");
	var PERF_BY_TARGET = /* @__PURE__ */ new WeakMap();
	function bindPerfTarget(target, perf) {
		PERF_BY_TARGET.set(target, perf);
	}
	function installMethodPerf(proto, labelPrefix, names) {
		const target = proto;
		names.forEach((name) => {
			const current = target[name];
			if (typeof current !== "function" || current[WRAPPED]) return;
			const original = current;
			const wrapped = function(...args) {
				const perf = PERF_BY_TARGET.get(this);
				if (!perf?.enabled()) return original.apply(this, args);
				return perf.measure(`${labelPrefix}.${name}`, () => original.apply(this, args));
			};
			wrapped[WRAPPED] = true;
			target[name] = wrapped;
		});
	}
	var perfEnabledFrom = (initialFlags) => {
		const search = typeof location === "undefined" ? "" : location.search;
		const params = new URLSearchParams(search);
		const env = globalThis.process?.env;
		return initialFlags.perf === true || params.get("perf") === "1" || params.has("perf") || env?.PERF === "1";
	};
	var createAppPerf = (initialFlags) => createPerfApi(perfEnabledFrom(initialFlags));
	function installGraphPerf(graphs, perf) {
		installMethodPerf(Graph.prototype, "Graph", [
			"itemsOfKind",
			"getItem",
			"nodes",
			"edges",
			"edgesOf",
			"deleteNode",
			"createNode",
			"createEdge",
			"getNode",
			"updateNode",
			"updateEdge",
			"replace",
			"snapshot",
			"nodeIdsInRect"
		]);
		graphs.all().forEach((graph) => bindPerfTarget(graph, perf));
		const create = graphs.create.bind(graphs);
		graphs.create = ((id) => {
			const graph = create(id);
			bindPerfTarget(graph, perf);
			return graph;
		});
		const switchGraph = graphs.switch.bind(graphs);
		graphs.switch = ((id) => {
			const graph = switchGraph(id);
			bindPerfTarget(graph, perf);
			return graph;
		});
	}
	//#endregion
	//#region frontend/core/properties.ts
	/** Property input registry — turns `prop.input` (a string) into an HTMLElement.
	*  Default renderers for 'text', 'number', 'checkbox', 'textarea', and 'select'
	*  ship; new kinds (color picker, markdown preview, etc.) register here without
	*  touching configurable. */
	function propertiesContext() {
		const renderers = /* @__PURE__ */ new Map();
		const defaultRender = (prop, item) => {
			const label = document.createElement("label");
			if (prop.input === "textarea") {
				const textarea = document.createElement("textarea");
				textarea.dataset.field = prop.id;
				textarea.rows = prop.rows ?? 5;
				textarea.value = String(prop.value(item));
				label.append(prop.label, textarea);
				return label;
			}
			if (prop.input === "select") {
				const select = document.createElement("select");
				select.dataset.field = prop.id;
				const value = String(prop.value(item));
				(prop.options ?? []).forEach((option) => {
					const el = document.createElement("option");
					el.value = option.value;
					el.textContent = option.label;
					el.selected = option.value === value;
					select.append(el);
				});
				label.append(prop.label, select);
				return label;
			}
			const input = document.createElement("input");
			input.dataset.field = prop.id;
			input.type = prop.input;
			if (prop.min != null) input.min = `${prop.min}`;
			if (prop.step != null) input.step = `${prop.step}`;
			if (prop.input === "checkbox") {
				label.className = "check-row";
				input.checked = Boolean(prop.value(item));
				label.append(input, prop.label);
			} else {
				if (prop.input === "text") input.classList.add("editable-inline");
				input.value = String(prop.value(item));
				label.append(prop.label, input);
			}
			return label;
		};
		renderers.set("text", defaultRender);
		renderers.set("number", defaultRender);
		renderers.set("checkbox", defaultRender);
		renderers.set("textarea", defaultRender);
		renderers.set("select", defaultRender);
		return {
			register(name, render) {
				renderers.set(name, render);
			},
			has(name) {
				return renderers.has(name);
			},
			render(prop, item) {
				return (renderers.get(prop.input) ?? defaultRender)(prop, item);
			},
			names: () => [...renderers.keys()]
		};
	}
	//#endregion
	//#region frontend/core/selection.ts
	function createSelectionStore(graphs, bus) {
		const sel = /* @__PURE__ */ new Map();
		const foc = /* @__PURE__ */ new Map();
		const gid = (override) => override ?? graphs.current.id;
		const setOf = (graphId) => sel.get(graphId) ?? [];
		/** Single fact for any set change: carries the whole set. `selectable` turns
		*  it into decorations + focus; single-item consumers read the primary. */
		const commit = (graphId) => {
			const arr = setOf(graphId);
			const primary = arr[arr.length - 1] ?? null;
			bus.emit("selection.item.selected", primary);
			bus.emit("selection.node.selected", { id: primary?.kind === "node" ? primary.id : null });
			bus.emit("selection.changed", { refs: arr });
		};
		const write = (graphId, refs) => {
			sel.set(graphId, refs);
			commit(graphId);
		};
		const clearFocus = (graphId) => {
			foc.set(graphId, null);
			bus.emit("focus.item.focused", null);
			bus.emit("focus.node.focused", { id: null });
		};
		const clearDeleted = (graphId, target) => {
			const arr = setOf(graphId);
			const next = arr.filter((ref) => !sameItemRef(ref, target));
			if (next.length !== arr.length) write(graphId, next);
			if (sameItemRef(foc.get(graphId) ?? null, target)) clearFocus(graphId);
		};
		bus.on("graph.node.deleted", ({ graphId, id }) => clearDeleted(graphId, nodeRef(id)));
		bus.on("graph.edge.deleted", ({ graphId, id }) => clearDeleted(graphId, edgeRef(id)));
		const node = (ref, graphId) => {
			if (!ref || ref.kind !== "node") return void 0;
			return graphs.get(gid(graphId))?.node(ref.id);
		};
		return {
			selected: (graphId) => {
				const a = setOf(gid(graphId));
				return a[a.length - 1] ?? null;
			},
			selectedAll: (graphId) => [...setOf(gid(graphId))],
			has: (ref, graphId) => setOf(gid(graphId)).some((r) => sameItemRef(r, ref)),
			focused: (graphId) => foc.get(gid(graphId)) ?? null,
			selectedNode: (graphId) => {
				const a = setOf(gid(graphId));
				return node(a[a.length - 1] ?? null, graphId);
			},
			focusedNode: (graphId) => node(foc.get(gid(graphId)) ?? null, graphId),
			select(ref, graphId) {
				write(gid(graphId), ref ? [ref] : []);
			},
			choose(refs, graphId) {
				const seen = /* @__PURE__ */ new Set();
				const unique = [];
				for (const ref of refs) {
					const key = `${ref.kind}:${ref.id}:${(ref.parent ?? []).join("/")}`;
					if (seen.has(key)) continue;
					seen.add(key);
					unique.push(ref);
				}
				write(gid(graphId), unique);
			},
			add(ref, graphId) {
				const g = gid(graphId);
				if (setOf(g).some((r) => sameItemRef(r, ref))) {
					write(g, [...setOf(g).filter((r) => !sameItemRef(r, ref)), ref]);
					return;
				}
				write(g, [...setOf(g), ref]);
			},
			remove(ref, graphId) {
				const g = gid(graphId);
				write(g, setOf(g).filter((r) => !sameItemRef(r, ref)));
			},
			toggle(ref, graphId) {
				const g = gid(graphId);
				write(g, setOf(g).some((r) => sameItemRef(r, ref)) ? setOf(g).filter((r) => !sameItemRef(r, ref)) : [...setOf(g), ref]);
			},
			focus(ref, graphId) {
				foc.set(gid(graphId), ref);
			}
		};
	}
	//#endregion
	//#region frontend/core/sim.ts
	/** Build a sim harness for a running AppCtx-bus. The harness piggy-backs on bus.onAny
	*  and bus.forward — no event-loop hacking. Safe to leave on in dev; opt-in in prod. */
	function createSim(bus) {
		const instrumented = bus;
		return {
			record() {
				let buffer = [];
				let active = false;
				bus.onAny((event) => {
					if (active) buffer.push({
						name: event.name,
						data: event.data,
						at: event.at
					});
				});
				return {
					start() {
						buffer = [];
						active = true;
					},
					stop() {
						active = false;
						return buffer;
					},
					current() {
						return buffer.slice();
					},
					byName(name) {
						return buffer.filter((event) => event.name === name);
					}
				};
			},
			replay(trace) {
				trace.forEach((event) => bus.forward(event.name, event.data));
			},
			emitMany(events) {
				events.forEach((event) => bus.forward(event.name, event.data));
			},
			orphanEmits: () => [...instrumented._emitted].filter((name) => !instrumented._subscribed.has(name)),
			silentListeners: () => [...instrumented._subscribed].filter((name) => !instrumented._emitted.has(name))
		};
	}
	//#endregion
	//#region frontend/core/storage.ts
	/** Centralized `item.update` dispatcher. One bus subscription, O(1) lookup by
	*  ref.kind. Replaces the previous pattern where every storage system filtered
	*  every item.update via `if (ref.kind !== 'mine') return`.
	*
	*  DX checks every patchable entity has a handler — adding a new kind without
	*  registering storage now fails the boot contract instead of silently dropping
	*  patches. */
	function storageContext(bus) {
		const handlers = /* @__PURE__ */ new Map();
		const applyOne = ({ ref, patch }) => handlers.get(ref.kind)?.apply(ref, patch);
		bus.on("item.update", applyOne);
		bus.on("item.update.batch", ({ updates }) => updates.forEach(applyOne));
		return {
			register(kind, origin, apply) {
				handlers.set(kind, {
					origin,
					apply
				});
				return () => {
					if (handlers.get(kind)?.apply === apply) handlers.delete(kind);
				};
			},
			kinds: () => [...handlers.keys()],
			has: (kind) => handlers.has(kind),
			unregisterOrigin(origin) {
				for (const [kind, entry] of handlers) if (entry.origin === origin) handlers.delete(kind);
			}
		};
	}
	//#endregion
	//#region frontend/core/fold.ts
	/** Fold id for an *item* (node / container / …). Collapse is just fold applied
	*  to an item target — same store, same `.changed` fact, same chevron. Keyed by
	*  graph id so the same node id in two graphs folds independently. */
	var itemFoldId = (ref, graphId) => `fold:${graphId}:${ref.kind}:${ref.id}`;
	/** True when any ancestor of `ref` is folded — i.e. `ref` is hidden inside a
	*  collapsed container. The one predicate for "is this currently visible": used
	*  by render (skip drawing), jump/Tab (skip navigating to hidden items), and
	*  fit (skip hidden bounds). */
	var foldHidden = (ref, parentChain, fold, graphId) => parentChain(ref).some((ancestor) => fold.folded(itemFoldId(ancestor, graphId)));
	/** Generic fold/collapse state, shared between UI surfaces (outline sections,
	*  left panel, future inspector pane, …). Lives next to selection / view as a
	*  presentation-layer store — not graph data. */
	function foldContext(bus, io) {
		const state = io.get("frontend.fold", {});
		const isOpen = (id, defaultOpen = true) => Object.prototype.hasOwnProperty.call(state, id) ? state[id] : defaultOpen;
		const set = (id, open) => {
			state[id] = open;
			bus.emit("fold.changed", {
				id,
				open
			});
		};
		const toggle = (id, defaultOpen = true) => set(id, !isOpen(id, defaultOpen));
		return {
			isOpen,
			folded: (id) => !isOpen(id, true),
			set,
			toggle,
			all: () => ({ ...state })
		};
	}
	//#endregion
	//#region frontend/core/templates.ts
	/** Default render adapter: HTML <template> elements addressed by id (`tpl-<name>`).
	*  Systems clone a template, then fill named [data-text="..."] and [data-slot="..."]
	*  holes. Swappable — a future JSX adapter just exposes the same surface. */
	function templateContext() {
		const find = (root, selector) => root instanceof Element && root.matches(selector) ? root : root.querySelector(selector);
		const cloned = /* @__PURE__ */ new Set();
		const clone = (name) => {
			cloned.add(name);
			const template = document.getElementById(`tpl-${name}`);
			const node = template instanceof HTMLTemplateElement ? template.content.firstElementChild?.cloneNode(true) : null;
			if (!(node instanceof HTMLElement)) throw new Error(`Missing template: ${name}`);
			return node;
		};
		const text = (root, name, value) => {
			const el = find(root, `[data-text="${name}"]`);
			if (el) el.textContent = String(value ?? "");
			return root;
		};
		const slot = (root, name) => {
			const el = find(root, `[data-slot="${name}"]`);
			if (!(el instanceof Element)) throw new Error(`Missing slot: ${name}`);
			return el;
		};
		return {
			clone,
			text,
			slot,
			_cloned: cloned
		};
	}
	/** Build an empty-state DOM block. `hint` is a Node — typically text + a <kbd>.
	*  Use `kbdHint(lead, key, tail)` for "Press <kbd>K</kbd> tail" without HTML strings. */
	var emptyState = (templates, title, hint) => {
		try {
			const el = templates.clone("empty");
			templates.text(el, "title", title);
			if (hint) templates.slot(el, "hint").append(hint);
			return el;
		} catch {
			return null;
		}
	};
	/** Compose a hint as a DocumentFragment with a <kbd> in the middle.
	*  `key` is set via textContent, so user-edited shortcuts can't inject HTML. */
	var kbdHint = (lead, key, tail = "") => {
		const fragment = document.createDocumentFragment();
		if (lead) fragment.append(lead);
		const kbd = document.createElement("kbd");
		kbd.textContent = key;
		fragment.append(kbd);
		if (tail) fragment.append(tail);
		return fragment;
	};
	//#endregion
	//#region frontend/core/view.ts
	var clamp$1 = (value, min, max) => Math.max(min, Math.min(max, value));
	var rectsIntersect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	/** Generic centered-rect of a positioned, sized item. Structural to avoid
	*  pulling kind-specific types into core/view. */
	var nodeRect = (node) => {
		const pos = node.Position ?? {
			x: 0,
			y: 0
		};
		return {
			x: pos.x - node.Size.w / 2,
			y: pos.y - node.Size.h / 2,
			w: node.Size.w,
			h: node.Size.h
		};
	};
	var clientPoint = (event) => ({
		x: event.clientX,
		y: event.clientY
	});
	var isStageSurface = (event, stage) => event.target === stage || event.target instanceof Element && event.target.classList.contains("nodes");
	/** Bridges graph-space (where nodes live) with screen-space (where the stage element
	*  paints). Exposed as a context so render, drag, pan, and zoom share one camera. */
	function viewContext(places) {
		let state = {
			x: 0,
			y: 0,
			scale: 1
		};
		const localRect = (place) => places.get(place)?.getBoundingClientRect();
		const get = () => ({ ...state });
		const set = (next) => {
			state = {
				x: next.x ?? state.x,
				y: next.y ?? state.y,
				scale: clamp$1(next.scale ?? state.scale, .05, 5)
			};
			return get();
		};
		const zoomAtScreen = (screen, factor) => {
			const before = screenToSpace(screen);
			const scale = clamp$1(state.scale * factor, .05, 5);
			return set({
				scale,
				x: before.x - screen.x / scale,
				y: before.y - screen.y / scale
			});
		};
		const clientToScreen = (place, point) => {
			const rect = localRect(place);
			return rect ? {
				x: point.x - rect.left,
				y: point.y - rect.top
			} : point;
		};
		const screenToSpace = (point) => ({
			x: state.x + point.x / state.scale,
			y: state.y + point.y / state.scale
		});
		const spaceToScreen = (point) => ({
			x: (point.x - state.x) * state.scale,
			y: (point.y - state.y) * state.scale
		});
		const clientToSpace = (place, point) => screenToSpace(clientToScreen(place, point));
		const screenCenter = (place) => {
			const rect = localRect(place);
			return rect ? {
				x: rect.width / 2,
				y: rect.height / 2
			} : {
				x: innerWidth / 2,
				y: innerHeight / 2
			};
		};
		const spaceCenter = (place) => screenToSpace(screenCenter(place));
		const visibleRect = (place, margin = 0) => {
			const rect = localRect(place);
			if (!rect) return null;
			return {
				x: state.x - margin,
				y: state.y - margin,
				w: rect.width / state.scale + margin * 2,
				h: rect.height / state.scale + margin * 2
			};
		};
		const isVisible = (place, rect, margin = 0) => {
			const visible = visibleRect(place, margin);
			return !visible || rectsIntersect(visible, rect);
		};
		return {
			get,
			set,
			clientToScreen,
			screenToSpace,
			spaceToScreen,
			clientToSpace,
			screenCenter,
			spaceCenter,
			visibleRect,
			isVisible,
			zoomAtScreen
		};
	}
	//#endregion
	//#region frontend/core/dom.ts
	/** Insert a Renderable (Node or factory) into a slot. */
	var appendRenderable = (slot, view) => {
		slot.append(typeof view === "function" ? view() : view);
	};
	var itemParentAttr = (parent) => parent?.length ? JSON.stringify(parent) : "";
	var itemParentFromAttr = (value) => {
		if (!value) return void 0;
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : void 0;
		} catch {
			return;
		}
	};
	var tagItem = (el, ref) => {
		el.setAttribute("data-item-kind", ref.kind);
		el.setAttribute("data-item-id", ref.id);
		const parent = itemParentAttr(ref.parent);
		if (parent) el.setAttribute("data-item-parent", parent);
		else el.removeAttribute("data-item-parent");
	};
	/** Closest item id from the canonical item-tagging attribute. */
	var itemIdFrom = (target) => target?.closest("[data-item-id]")?.getAttribute("data-item-id") ?? "";
	/** Closest ItemRef from a DOM target — reads `[data-item-kind][data-item-id]`. */
	var itemRefFrom = (target) => {
		const item = target?.closest("[data-item-kind][data-item-id]");
		if (!item) return null;
		const kind = item.getAttribute("data-item-kind");
		const id = item.getAttribute("data-item-id");
		if (!kind || !id) return null;
		const parent = itemParentFromAttr(item.getAttribute("data-item-parent"));
		return parent ? {
			kind,
			id,
			parent
		} : {
			kind,
			id
		};
	};
	//#endregion
	//#region frontend/core/util.ts
	/** Group `items` by `keyOf(item)`, preserving insertion order of both keys and items. */
	var grouped = (items, keyOf) => {
		const groups = /* @__PURE__ */ new Map();
		items.forEach((item) => (groups.get(keyOf(item)) || groups.set(keyOf(item), []).get(keyOf(item))).push(item));
		return [...groups.entries()];
	};
	//#endregion
	//#region frontend/constants.ts
	/** Runtime constants — split from types.ts so type definitions stay focused on the MODEL MAP.
	*  Re-exported from types.ts for backward compatibility. */
	var Places = {
		Top: "top",
		Left: "left",
		Stage: "stage",
		Modal: "modal"
	};
	/** Named slots inside an entity's rendered card. Abilities point their
	*  `AffordanceDef.slot` at one of these; the renderer (`render-stage`,
	*  `item-toolbar`) reads the same names when wiring affordances to template
	*  `[data-slot=...]` elements. Centralized so a typo at either end becomes a
	*  TypeScript error AND a DX rule. */
	var Slots = {
		/** Drag handle (handler affordance, draggable). Entity surface. */
		Drag: "drag",
		/** Resize handle (handler affordance, resizeable). Entity surface. */
		Resize: "resize",
		/** Default catch-all slot for button affordances with no explicit slot. Entity surface. */
		Header: "header",
		/** Left-of-title button row (collapsible). Entity surface. */
		HeaderStart: "header:start",
		/** Right-of-title button row (configurable). Entity surface. */
		HeaderEnd: "header:end",
		/** Editable title element (matches template `[data-editable-title]`). Entity surface. */
		Title: "title",
		/** Leading toolbar group. Top surface (system affordance). */
		Start: "start",
		/** Trailing toolbar group. Top surface (system affordance). */
		End: "end"
	};
	/** Slots that live on the per-entity surface — DX checks `AffordanceDef.slot`
	*  against this narrower set. Toolbar Start/End live on the top surface. */
	var EntitySlots = new Set([
		Slots.Drag,
		Slots.Resize,
		Slots.Header,
		Slots.HeaderStart,
		Slots.HeaderEnd,
		Slots.Title
	]);
	/** Past-tense suffixes that mark an event as a fact (something already happened).
	*  Convention rule: imperative names (`graph.node.create`) are requests; fact names
	*  (`graph.node.created`) are emitted by the owning system after the change lands.
	*  Other systems subscribe to facts, never to requests. The render scheduler reads
	*  facts as redraw triggers via `factScope`. */
	var FACT_SUFFIXES = [
		".created",
		".updated",
		".deleted",
		".switched",
		".selected",
		".focused",
		".changed"
	];
	//#endregion
	//#region frontend/core/redraw.ts
	/** Classify an event name by suffix.
	*  - 'view.changed' → 'camera' (pan/zoom: move the layer transform, no rebuild)
	*  - any other '.changed' → 'nodes' (e.g. selection repaint, no list churn)
	*  - any other fact suffix → 'both' (data changed; lists + canvas both refresh)
	*  - non-fact     → null    (request events, render.*, app.start etc.) */
	var factScope = (name) => {
		if (name === "view.changed") return "camera";
		for (const suffix of FACT_SUFFIXES) {
			if (!name.endsWith(suffix)) continue;
			return suffix === ".changed" ? "nodes" : "both";
		}
		return null;
	};
	//#endregion
	//#region frontend/core/geometry.ts
	/** Centered bounding rect of a positioned, sized item. Returns null when the
	*  item has no Position to anchor at. */
	var boundsOf = (item, defaultSize = {
		w: 0,
		h: 0
	}) => {
		if (!item.Position) return null;
		const s = item.Size ?? defaultSize;
		return {
			x: item.Position.x - s.w / 2,
			y: item.Position.y - s.h / 2,
			w: s.w,
			h: s.h
		};
	};
	/** Smallest rect containing both inputs. */
	var unionRect = (a, b) => {
		const x = Math.min(a.x, b.x);
		const y = Math.min(a.y, b.y);
		const right = Math.max(a.x + a.w, b.x + b.w);
		const bottom = Math.max(a.y + a.h, b.y + b.h);
		return {
			x,
			y,
			w: right - x,
			h: bottom - y
		};
	};
	/** Symmetric padding on all sides plus optional extra on top (for label bands). */
	var expandRect = (r, pad, topExtra = 0) => ({
		x: r.x - pad,
		y: r.y - pad - topExtra,
		w: r.w + pad * 2,
		h: r.h + pad * 2 + topExtra
	});
	/** Center of a rect. */
	var rectCenter = (r) => ({
		x: r.x + r.w / 2,
		y: r.y + r.h / 2
	});
	//#endregion
	//#region frontend/core/introspect.ts
	/** Build a structural snapshot of the running app. Sources its data from
	*  flags (system/ability/feature), commands (with origin tag), the model
	*  (entities + abilities + collections), and the bus origin index
	*  (subscribes/emits). No new tracking required — this is a pure read.
	*
	*  Used by the self-graph demo and surfaced for tests/devtools. */
	function introspect(ctx) {
		const bus = ctx.bus;
		const nodes = [];
		const edges = [];
		const seen = /* @__PURE__ */ new Set();
		const refKey = (ref) => `${ref.kind}:${ref.id}`;
		const ensure = (node) => {
			const key = refKey(node);
			if (seen.has(key)) return;
			seen.add(key);
			nodes.push(node);
		};
		const edge = (from, to, relation) => {
			edges.push({
				from,
				to,
				relation
			});
		};
		const ownerKindOf = (origin) => ctx.flags.kind(origin) ?? "system";
		[
			"system",
			"ability",
			"feature"
		].forEach((kind) => {
			ctx.flags.declared(kind).forEach((name) => {
				ensure({
					kind,
					id: name,
					label: name
				});
				ctx.flags.requires(name).forEach((dep) => {
					ensure({
						kind: ctx.flags.kind(dep) ?? "system",
						id: dep,
						label: dep
					});
					edge({
						kind,
						id: name
					}, {
						kind: ctx.flags.kind(dep) ?? "system",
						id: dep
					}, "requires");
				});
			});
		});
		ctx.contexts.commands.all().forEach((cmd) => {
			ensure({
				kind: "command",
				id: cmd.id,
				label: cmd.label,
				meta: {
					hidden: !!cmd.hidden,
					group: cmd.group
				}
			});
			ensure({
				kind: "event",
				id: cmd.event,
				label: cmd.event
			});
			if (cmd.origin) {
				const ownerKind = ownerKindOf(cmd.origin);
				ensure({
					kind: ownerKind,
					id: cmd.origin,
					label: cmd.origin
				});
				edge({
					kind: ownerKind,
					id: cmd.origin
				}, {
					kind: "command",
					id: cmd.id
				}, "owns");
			}
			edge({
				kind: "command",
				id: cmd.id
			}, {
				kind: "event",
				id: cmd.event
			}, "fires");
		});
		ctx.model.entities().forEach((entityDef) => {
			ensure({
				kind: "entity",
				id: entityDef.kind,
				label: entityDef.label
			});
			entityDef.abilities.forEach((abilityDef) => {
				const id = `ability.${abilityDef.id}`;
				ensure({
					kind: "ability",
					id,
					label: id
				});
				edge({
					kind: "entity",
					id: entityDef.kind
				}, {
					kind: "ability",
					id
				}, "declares");
			});
		});
		ctx.model.collections().forEach((collDef) => {
			ensure({
				kind: "collection",
				id: collDef.id,
				label: collDef.label
			});
			if (collDef.kind) {
				ensure({
					kind: "entity",
					id: collDef.kind,
					label: collDef.kind
				});
				edge({
					kind: "collection",
					id: collDef.id
				}, {
					kind: "entity",
					id: collDef.kind
				}, "lists");
			}
		});
		if (bus._subscriptionsOf && bus._emissionsOf) [
			"system",
			"ability",
			"feature"
		].forEach((kind) => {
			ctx.flags.declared(kind).forEach((origin) => {
				bus._subscriptionsOf(origin).forEach((eventName) => {
					ensure({
						kind: "event",
						id: eventName,
						label: eventName
					});
					edge({
						kind,
						id: origin
					}, {
						kind: "event",
						id: eventName
					}, "subscribes");
				});
				bus._emissionsOf(origin).forEach((eventName) => {
					ensure({
						kind: "event",
						id: eventName,
						label: eventName
					});
					edge({
						kind,
						id: origin
					}, {
						kind: "event",
						id: eventName
					}, "emits");
				});
			});
		});
		return {
			nodes,
			edges
		};
	}
	//#endregion
	//#region frontend/core/snapshot.ts
	/** Capture the user-visible structural state. The shape is intentionally a
	*  POJO so it round-trips through JSON for downloading / diffing / snapshot
	*  testing, and so the tree builder doesn't have to special-case live objects.
	*
	*  Each root key gets a tailored `code` mapping (see `ROOT_CODE`) so a click
	*  on a leaf generates a readable assertion — `ctx.graphs.current.nodes()`,
	*  not `ctx.snapshot().graph.nodes`. */
	function snapshot(ctx) {
		const ui = captureUi(ctx);
		const graph = ctx.graphs.current;
		const containers = graph.itemsOfKind("container");
		const dxIssues = ctx.contexts.dx.run();
		return {
			graph: {
				id: graph.id,
				nodes: graph.nodes().map((n) => ({
					id: n.id,
					Label: n.Label,
					Position: n.Position,
					Size: n.Size,
					NodeType: n.NodeType,
					Description: n.Description,
					Collapsed: ctx.contexts.fold.folded(itemFoldId({
						kind: "node",
						id: n.id
					}, graph.id))
				})),
				edges: graph.edges().map((e) => ({
					id: e.id,
					From: e.From,
					To: e.To,
					Label: e.Label
				})),
				containers: containers.map((c) => ({
					id: c.id,
					Label: c.Label,
					Collapsed: ctx.contexts.fold.folded(itemFoldId({
						kind: "container",
						id: c.id
					}, graph.id)),
					Position: c.Position,
					Size: c.Size,
					Sections: c.Sections,
					SectionAxis: c.SectionAxis,
					ChildSections: c.ChildSections,
					Children: c.Children
				}))
			},
			selection: {
				selected: ctx.selection.selected(),
				focused: ctx.selection.focused(),
				count: ctx.selection.selectedAll().length
			},
			view: ctx.contexts.view.get(),
			flags: {
				system: ctx.flags.declared("system").filter((n) => ctx.flags.isOn(n)),
				ability: ctx.flags.declared("ability").filter((n) => ctx.flags.isOn(n)),
				feature: ctx.flags.declared("feature").filter((n) => ctx.flags.isOn(n))
			},
			fold: ctx.contexts.fold.all(),
			dx: {
				errors: dxIssues.filter((i) => i.level === "error").length,
				warnings: dxIssues.filter((i) => i.level === "warn").length
			},
			ui
		};
	}
	/** UI/DOM-side snapshot — what the user actually sees. Counts what's rendered
	*  per kind, whether each place is mounted with non-zero size, and whether key
	*  surfaces (stage empty-state, item-toolbar, modal) are visible.
	*
	*  Code paths point at `ctx.contexts.places.el(...)` and `querySelectorAll`,
	*  which work identically in jsdom (tests) and the browser (recording). */
	function captureUi(ctx) {
		const placeEl = (place) => ctx.contexts.places.el(place);
		const stageEl = placeEl("stage");
		const modalEl = placeEl("modal");
		const topEl = placeEl("top");
		const leftEl = placeEl("left");
		const shellEl = topEl?.parentElement ?? null;
		const toolPanelInfo = (id) => {
			const el = stageEl?.querySelector(`.tool-panel[data-panel-id="${id}"]`);
			return {
				mounted: !!el,
				collapsed: el?.dataset.collapsed === "true",
				x: Math.round(Number.parseFloat(el?.style.left || "0")),
				y: Math.round(Number.parseFloat(el?.style.top || "0")),
				dragHandle: !!el?.querySelector("[data-tool-panel-drag]"),
				collapseHandle: !!el?.querySelector("[data-fold-id=\"shell.top\"]")
			};
		};
		const sizeOf = (el) => {
			if (!el) return {
				mounted: false,
				width: 0,
				height: 0
			};
			const rect = el.getBoundingClientRect();
			return {
				mounted: true,
				width: Math.round(rect.width),
				height: Math.round(rect.height)
			};
		};
		const count = (selector) => stageEl?.querySelectorAll(selector).length ?? 0;
		const leftCount = (selector) => leftEl?.querySelectorAll(selector).length ?? 0;
		const modalFields = {};
		modalEl?.querySelectorAll("[data-field]").forEach((el) => {
			const field = el.getAttribute("data-field");
			if (field) modalFields[field] = el.value ?? "";
		});
		const activeEl = (modalEl?.ownerDocument ?? document).activeElement;
		const focusedField = activeEl && modalEl?.contains(activeEl) ? activeEl.getAttribute("data-field") : null;
		return {
			places: {
				top: sizeOf(topEl),
				left: sizeOf(leftEl),
				stage: sizeOf(stageEl),
				modal: sizeOf(modalEl)
			},
			shell: {
				topFolded: shellEl?.dataset.topFolded === "true",
				zen: shellEl?.dataset.zen === "true"
			},
			colorscheme: shellEl?.dataset.colorscheme ?? shellEl?.getAttribute("data-theme") ?? "light",
			rendered: {
				nodes: count(".node[data-item-kind=\"node\"]"),
				textNodes: count(".node-type-text[data-item-kind=\"node\"]"),
				squareNodes: count(".node-type-square[data-item-kind=\"node\"]"),
				circleNodes: count(".node-type-circle[data-item-kind=\"node\"]"),
				describedNodes: count(".node.has-description[data-item-kind=\"node\"]"),
				edges: count("[data-item-kind=\"edge\"]"),
				containers: count(".container[data-item-kind=\"container\"]"),
				sectionedContainers: count(".container.has-sections[data-item-kind=\"container\"]"),
				overlays: count(".item-overlay")
			},
			stage: {
				emptyStateVisible: !!stageEl?.querySelector(".empty"),
				itemToolbarVisible: !!stageEl?.querySelector(".item-toolbar")
			},
			toolPanels: {
				top: toolPanelInfo("top"),
				nodeTypes: toolPanelInfo("node-types")
			},
			outline: {
				sections: leftCount(".outline-section"),
				rows: leftCount(".outline-row"),
				nested: leftCount(".outline-children .outline-row")
			},
			modal: {
				open: (modalEl?.children.length ?? 0) > 0,
				fields: modalFields,
				focusedField
			}
		};
	}
	/** Hand-tuned root-key → TS expression map. Anything not listed falls back to
	*  property access on `snapshot.<key>` which still works at runtime but reads
	*  less naturally in tests. */
	var ROOT_CODE = {
		graph: "ctx.graphs.current",
		selection: "ctx.selection",
		view: "ctx.contexts.view.get()",
		flags: "ctx.flags",
		fold: "ctx.contexts.fold.all()",
		dx: "ctx.contexts.dx.run()",
		ui: "/* see UI sub-paths */"
	};
	/** DOM-side helpers — each picked assertion under `ui.*` resolves to a query
	*  on the live element tree, so a regression test catches both "data is right"
	*  AND "the user actually sees it". */
	var PLACES_CODE = {
		top: "ctx.contexts.places.el('top')?.getBoundingClientRect()",
		left: "ctx.contexts.places.el('left')?.getBoundingClientRect()",
		stage: "ctx.contexts.places.el('stage')?.getBoundingClientRect()",
		modal: "ctx.contexts.places.el('modal')?.getBoundingClientRect()"
	};
	var SHELL_CODE = {
		topFolded: "ctx.contexts.places.el('top')?.parentElement?.dataset.topFolded === 'true'",
		zen: "ctx.contexts.places.el('top')?.parentElement?.dataset.zen === 'true'"
	};
	var COLORSCHEME_CODE = { colorscheme: "(ctx.contexts.places.el('top')?.parentElement?.dataset.colorscheme ?? ctx.contexts.places.el('top')?.parentElement?.getAttribute('data-theme') ?? 'light')" };
	var RENDERED_CODE = {
		nodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node[data-item-kind=\"node\"]').length",
		textNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node-type-text[data-item-kind=\"node\"]').length",
		squareNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node-type-square[data-item-kind=\"node\"]').length",
		circleNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node-type-circle[data-item-kind=\"node\"]').length",
		describedNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node.has-description[data-item-kind=\"node\"]').length",
		edges: "ctx.contexts.places.el('stage')?.querySelectorAll('[data-item-kind=\"edge\"]').length",
		containers: "ctx.contexts.places.el('stage')?.querySelectorAll('.container[data-item-kind=\"container\"]').length",
		sectionedContainers: "ctx.contexts.places.el('stage')?.querySelectorAll('.container.has-sections[data-item-kind=\"container\"]').length",
		overlays: "ctx.contexts.places.el('stage')?.querySelectorAll('.item-overlay').length"
	};
	var STAGE_CODE = {
		emptyStateVisible: "!!ctx.contexts.places.el('stage')?.querySelector('.empty')",
		itemToolbarVisible: "!!ctx.contexts.places.el('stage')?.querySelector('.item-toolbar')"
	};
	var MODAL_CODE = {
		open: "(ctx.contexts.places.el('modal')?.children.length ?? 0) > 0",
		focusedField: "(() => { const a = document.activeElement; const m = ctx.contexts.places.el('modal'); return a && m?.contains(a) ? a.getAttribute('data-field') : null; })()"
	};
	var OUTLINE_CODE = {
		sections: "ctx.contexts.places.el('left')?.querySelectorAll('.outline-section').length",
		rows: "ctx.contexts.places.el('left')?.querySelectorAll('.outline-row').length",
		nested: "ctx.contexts.places.el('left')?.querySelectorAll('.outline-children .outline-row').length"
	};
	var TOOL_PANEL_CODE = {
		top: "ctx.contexts.places.el('stage')?.querySelector('.tool-panel[data-panel-id=\"top\"]')",
		nodeTypes: "ctx.contexts.places.el('stage')?.querySelector('.tool-panel[data-panel-id=\"node-types\"]')"
	};
	/** Selection has method-shaped readers (`selected()`, `focused()`) instead of
	*  plain properties. Map those too so generated tests look idiomatic. */
	var SELECTION_CODE = {
		selected: "ctx.selection.selected()",
		focused: "ctx.selection.focused()",
		count: "ctx.selection.selectedAll().length"
	};
	/** Graph readers — same treatment. nodes/edges are methods; container kind
	*  lives behind `itemsOfKind`. */
	var GRAPH_CODE = {
		id: "ctx.graphs.current.id",
		nodes: "ctx.graphs.current.nodes()",
		edges: "ctx.graphs.current.edges()",
		containers: "ctx.graphs.current.itemsOfKind('container')"
	};
	var FLAGS_CODE = {
		system: "ctx.flags.declared('system').filter(n => ctx.flags.isOn(n))",
		ability: "ctx.flags.declared('ability').filter(n => ctx.flags.isOn(n))",
		feature: "ctx.flags.declared('feature').filter(n => ctx.flags.isOn(n))"
	};
	var DX_CODE = {
		errors: "ctx.contexts.dx.run().filter(i => i.level === 'error').length",
		warnings: "ctx.contexts.dx.run().filter(i => i.level === 'warn').length"
	};
	/** Build the clickable tree. Each level passes its computed `code` to its
	*  children. Optional chaining (`?.`) is inserted after any indexed access so
	*  generated assertions stay safe when the array is empty. */
	function snapshotTree(snap) {
		return makeNode("snapshot", snap, "ctx", "root", "");
	}
	function pickCode(parentCode, key, segment, optional) {
		if (segment === "root" && ROOT_CODE[key]) return ROOT_CODE[key];
		if (segment === "graph" && GRAPH_CODE[key]) return GRAPH_CODE[key];
		if (segment === "selection" && SELECTION_CODE[key]) return SELECTION_CODE[key];
		if (segment === "flags" && FLAGS_CODE[key]) return FLAGS_CODE[key];
		if (segment === "dx" && DX_CODE[key]) return DX_CODE[key];
		if (segment === "ui.places" && PLACES_CODE[key]) return PLACES_CODE[key];
		if (segment === "ui.shell" && SHELL_CODE[key]) return SHELL_CODE[key];
		if (segment === "ui.colorscheme" && COLORSCHEME_CODE[key]) return COLORSCHEME_CODE[key];
		if (segment === "ui.rendered" && RENDERED_CODE[key]) return RENDERED_CODE[key];
		if (segment === "ui.stage" && STAGE_CODE[key]) return STAGE_CODE[key];
		if (segment === "ui.modal" && MODAL_CODE[key]) return MODAL_CODE[key];
		if (segment === "ui.outline" && OUTLINE_CODE[key]) return OUTLINE_CODE[key];
		if (segment === "ui.toolPanels" && TOOL_PANEL_CODE[key]) return TOOL_PANEL_CODE[key];
		return `${parentCode}${optional ? "?." : "."}${key}`;
	}
	function nextSegment(parent, key) {
		if (parent === "root") {
			if (key === "graph") return "graph";
			if (key === "selection") return "selection";
			if (key === "flags") return "flags";
			if (key === "dx") return "dx";
			if (key === "ui") return "ui";
			return "plain";
		}
		if (parent === "ui") {
			if (key === "places") return "ui.places";
			if (key === "shell") return "ui.shell";
			if (key === "colorscheme") return "ui.colorscheme";
			if (key === "rendered") return "ui.rendered";
			if (key === "stage") return "ui.stage";
			if (key === "modal") return "ui.modal";
			if (key === "outline") return "ui.outline";
			if (key === "toolPanels") return "ui.toolPanels";
		}
		return "plain";
	}
	function makeNode(label, value, code, segment = "root", path = "") {
		if (Array.isArray(value)) return {
			label,
			path,
			code,
			value,
			kind: "array",
			children: value.map((v, i) => makeNode(`[${i}]`, v, `${code}[${i}]`, "plain", `${path}[${i}]`))
		};
		if (value && typeof value === "object") return {
			label,
			path,
			code,
			value,
			kind: "object",
			children: Object.entries(value).map(([k, v]) => {
				const childCode = pickCode(code, k, segment, /\]$/.test(code) || /\)$/.test(code));
				const childPath = path ? `${path}.${k}` : k;
				return makeNode(k, v, childCode, nextSegment(segment, k), childPath);
			})
		};
		return {
			label,
			path,
			code,
			value,
			kind: "literal"
		};
	}
	/** Flatten the tree for searching. Each entry's path is its `code` so filters
	*  match the way a user would type the assertion. */
	function flattenSnapshotTree(node, out = []) {
		out.push(node);
		node.children?.forEach((c) => flattenSnapshotTree(c, out));
		return out;
	}
	//#endregion
	//#region frontend/core/test-gen.ts
	/** Strip events that would either fire as a downstream of something we already
	*  keep, or that are pure UI/paint coordination:
	*
	*   - `render.*`, `affordance.*`, `fold.*`, `commandModal.*`, `outline.*` — UI
	*   - `app.start`, `app.notice`, `decoration.changed` — boot/notices
	*   - `view.changed` — fact emitted after every view set
	*   - `*.created` / `.updated` / `.deleted` / `.switched` / `.selected` /
	*     `.focused` / `.changed` — facts (storage emits them in response to
	*     imperatives we keep)
	*   - `graph.node.*`, `graph.edge.*`, `graph.container.*` — downstream storage
	*     CRUD that the `editing.*` features will emit when replayed
	*   - `selection.node.*`, `focus.*` — downstream of `selection.item.select`
	*   - `item.update` / `item.update.batch` — emitted by drag/edit/nudge from their own intent events;
	*     replaying those events reproduces it
	*
	*  What survives is the user-intent slice: `editing.*`, `commandForm.submit`,
	*  `commandPicker.*`, `selection.item.select`, `selection.item.delete`,
	*  top-level graph CRUD (`graph.create`, `graph.switch`, `graph.delete`),
	*  view commands, layout commands, modal toggles, jump/picker steps.
	*  Replaying that exact set drives the same lifecycle as the original
	*  recording without doubling the storage calls. */
	function defaultEventFilter(event) {
		const name = String(event.name);
		if (name.startsWith("render.")) return false;
		if (name.startsWith("affordance.")) return false;
		if (name.startsWith("fold.changed")) return false;
		if (name.startsWith("commandModal.")) return false;
		if (name.startsWith("outline.")) return false;
		if (name.startsWith("focus.")) return false;
		if (name === "view.changed") return false;
		if (name === "app.notice") return false;
		if (name === "app.start") return false;
		if (name === "decoration.changed") return false;
		if (name === "item.update" || name === "item.update.batch") return false;
		if (/^graph\.(node|edge|container)\.(create|update|delete)$/.test(name)) return false;
		if (/^selection\.(node|item)\.(selected|cleared)$/.test(name)) return false;
		if (/^selection\.node\.(select|clear)$/.test(name)) return false;
		if (/^container\.(children|collapsed)\.changed$/.test(name)) return false;
		if (/\.(created|updated|deleted|switched|selected|focused|changed)$/.test(name)) return false;
		return true;
	}
	var indent = (text, spaces) => {
		const pad = " ".repeat(spaces);
		return text.split("\n").map((line) => line ? pad + line : line).join("\n");
	};
	/** Render a value for inclusion in generated source. Wraps strings/numbers via
	*  JSON.stringify; `undefined` becomes the literal `undefined`. */
	var renderValue = (value) => {
		if (value === void 0) return "undefined";
		try {
			return JSON.stringify(value);
		} catch {
			return "undefined";
		}
	};
	/** Convert a recorded trace + chosen assertions into a complete vitest file
	*  string. The output is self-contained and runnable from `tests/commands/`
	*  using the existing `bootApp` testkit. */
	function traceToTest(opts) {
		const title = opts.title ?? "recorded case";
		const testName = opts.testName ?? "replays and asserts";
		const filter = opts.shouldInclude ?? defaultEventFilter;
		const traceLines = opts.trace.filter(filter).map((event) => `  { name: ${JSON.stringify(event.name)}, data: ${renderValue(event.data)}, at: 0 },`).join("\n");
		const assertLines = opts.assertions.length ? opts.assertions.map((a) => {
			const head = `expect(${a.code}).${a.matcher}`;
			return a.expected.length ? `    ${head}(${a.expected});` : `    ${head}();`;
		}).join("\n") : "    // TODO: click leaves in the snapshot tree to add assertions";
		return `import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';

const trace = [
${indent(traceLines, 0)}
];

describe('${title}', () => {
  it('${testName}', async () => {
    const ctx = bootApp();
    await settle();

    ctx.sim.replay(trace);
    await settle();

${assertLines}
  });
});
`;
	}
	//#endregion
	//#region frontend/core/semantics.ts
	var semanticTitle = (item) => [
		item.Purpose && `Purpose: ${item.Purpose}`,
		item.Assumptions && `Assumptions: ${item.Assumptions}`,
		item.Limits && `Limits: ${item.Limits}`,
		item.WhatThen && `What then: ${item.WhatThen}`,
		item.Observability && `Observe: ${item.Observability}`,
		item.FailureMode && `If fails: ${item.FailureMode}`,
		item.DataScale && `Data scale: ${item.DataScale}`,
		item.FreshnessMs != null && `Freshness: ${item.FreshnessMs}ms`
	].filter(Boolean).join("\n");
	//#endregion
	//#region frontend/core.ts
	var systemOf = (id) => id.split(".")[0] || "app";
	var uiValue = (value, item, fallback = "") => typeof value === "function" ? value(item) : value ?? fallback;
	function eventBus(perf) {
		const listeners = /* @__PURE__ */ new Map();
		const any = [];
		const listenerCounts = /* @__PURE__ */ new Map();
		const subscribed = /* @__PURE__ */ new Set();
		const emitted = /* @__PURE__ */ new Set();
		const subscribersOf = /* @__PURE__ */ new Map();
		const subscriptionsOf = /* @__PURE__ */ new Map();
		const emittersOf = /* @__PURE__ */ new Map();
		const emissionsOf = /* @__PURE__ */ new Map();
		const addSubscribed = (name) => {
			listenerCounts.set(name, (listenerCounts.get(name) ?? 0) + 1);
			subscribed.add(name);
		};
		const removeSubscribed = (name) => {
			const next = (listenerCounts.get(name) ?? 0) - 1;
			if (next > 0) listenerCounts.set(name, next);
			else {
				listenerCounts.delete(name);
				subscribed.delete(name);
			}
		};
		const remove = (list, item) => {
			const index = list.indexOf(item);
			if (index >= 0) list.splice(index, 1);
		};
		const dispatch = (name, data) => {
			emitted.add(name);
			const event = {
				name,
				data,
				at: performance.now()
			};
			perf?.count(`Bus.emit.${String(name)}`);
			const fireAny = () => [...any].forEach((fn) => fn(event));
			const fireNamed = () => [...listeners.get(name) || []].forEach((fn) => fn(event.data, event));
			if (perf?.enabled()) {
				perf.measure(`Bus.any.${String(name)}`, fireAny);
				perf.measure(`Bus.listeners.${String(name)}`, fireNamed);
			} else {
				fireAny();
				fireNamed();
			}
		};
		return {
			on(name, fn) {
				let active = true;
				const wrapped = fn;
				addSubscribed(name);
				(listeners.get(name) || listeners.set(name, []).get(name)).push(wrapped);
				return () => {
					if (!active) return;
					active = false;
					remove(listeners.get(name) ?? [], wrapped);
					removeSubscribed(name);
				};
			},
			onAny(fn) {
				let active = true;
				any.push(fn);
				return () => {
					if (!active) return;
					active = false;
					remove(any, fn);
				};
			},
			emit(name, ...args) {
				dispatch(name, args[0]);
			},
			forward(name, data) {
				dispatch(name, data);
			},
			_subscribed: subscribed,
			_emitted: emitted,
			_subscribersOf: (name) => [...subscribersOf.get(name)?.keys() ?? []],
			_emittersOf: (name) => [...emittersOf.get(name) ?? []],
			_subscriptionsOf: (origin) => [...subscriptionsOf.get(origin) ?? []],
			_emissionsOf: (origin) => [...emissionsOf.get(origin) ?? []],
			_trackSubscribe(name, origin) {
				const counts = subscribersOf.get(name) ?? subscribersOf.set(name, /* @__PURE__ */ new Map()).get(name);
				counts.set(origin, (counts.get(origin) ?? 0) + 1);
				(subscriptionsOf.get(origin) ?? subscriptionsOf.set(origin, /* @__PURE__ */ new Set()).get(origin)).add(name);
			},
			_untrackSubscribe(name, origin) {
				const counts = subscribersOf.get(name);
				if (!counts) return;
				const next = (counts.get(origin) ?? 0) - 1;
				if (next > 0) {
					counts.set(origin, next);
					return;
				}
				counts.delete(origin);
				if (!counts.size) subscribersOf.delete(name);
				const set = subscriptionsOf.get(origin);
				set?.delete(name);
				if (set && !set.size) subscriptionsOf.delete(origin);
			},
			_trackEmit(name, origin) {
				(emittersOf.get(name) ?? emittersOf.set(name, /* @__PURE__ */ new Set()).get(name)).add(origin);
				(emissionsOf.get(origin) ?? emissionsOf.set(origin, /* @__PURE__ */ new Set()).get(origin)).add(name);
			}
		};
	}
	function createContexts(bus, flags, io, perf) {
		const places = /* @__PURE__ */ new Map();
		const templates = templateContext();
		const view = viewContext(places);
		const properties = propertiesContext();
		const affordances = affordancesContext(bus);
		const cancellation = cancellationContext(bus);
		const decorations = decorationsContext(bus);
		const hierarchy = hierarchyContext();
		const keyboard = keyboardCaptureContext();
		const commands = commandsContext(bus, (origin) => !origin || flags.isOn(origin), io);
		const input = inputRouter(commands, perf);
		const storage = storageContext(bus);
		const fold = foldContext(bus, io);
		const placeContext = {
			set: (place, el) => {
				if (el) places.set(place, el);
			},
			el: (place) => places.get(place) ?? null
		};
		let lastDxIssues = [];
		let runner = () => lastDxIssues;
		return {
			commands,
			input,
			places: placeContext,
			templates,
			view,
			properties,
			dx: {
				issues: () => lastDxIssues,
				run: () => runner(),
				setIssues(issues) {
					lastDxIssues = issues;
				},
				setRunner(fn) {
					runner = fn;
				}
			},
			affordances,
			cancellation,
			decorations,
			hierarchy,
			keyboard,
			storage,
			fold,
			teardown: [
				commands,
				affordances,
				cancellation,
				decorations,
				hierarchy,
				keyboard,
				storage
			]
		};
	}
	/** Registry runs setup functions in insertion order, filtering by feature flag.
	*  Each setup gets `origin: <name>` injected so any commands it registers are tagged.
	*  The `defaultKind` tags every entry's flag unless `opts.kind` overrides it —
	*  lets demo/DX group entries without hardcoded name lists, while still letting
	*  a single registry hold system/ability/feature entries side by side. */
	function registry(defaultKind = "system") {
		const entries = [];
		const running = /* @__PURE__ */ new Map();
		const register = ((name, setup, opts = {}) => {
			entries.push({
				name,
				setup,
				requires: opts.requires ?? [],
				kind: opts.kind ?? defaultKind
			});
		});
		const stopEntry = (ctx, name) => {
			[...running.get(name) ?? []].reverse().forEach((dispose) => dispose());
			running.delete(name);
			ctx.contexts.teardown.forEach((c) => c.unregisterOrigin(name));
		};
		register.start = (ctx) => {
			entries.forEach((entry) => {
				ctx.flags.declare(entry.name, true, entry.requires, entry.kind);
				if (!ctx.flags.isOn(entry.name) || running.has(entry.name)) return;
				const disposers = [];
				const index = ctx.bus;
				const origin = entry.name;
				const trackedOn = (name, fn) => {
					const wrapped = ((data, event) => ctx.perf.enabled() ? ctx.perf.measure(`Bus.listener.${origin}.${String(name)}`, () => fn(data, event)) : fn(data, event));
					const off = ctx.bus.on(name, wrapped);
					index._trackSubscribe?.(name, origin);
					let alive = true;
					const wrappedOff = () => {
						if (!alive) return;
						alive = false;
						off();
						index._untrackSubscribe?.(name, origin);
					};
					disposers.push(wrappedOff);
					return wrappedOff;
				};
				const trackedEmit = ((name, ...args) => {
					index._trackEmit?.(name, origin);
					return ctx.bus.emit(name, ...args);
				});
				const trackedForward = (name, data) => {
					index._trackEmit?.(name, origin);
					return ctx.bus.forward(name, data);
				};
				const scopedBus = {
					on: trackedOn,
					onAny(fn) {
						const off = ctx.bus.onAny(fn);
						disposers.push(off);
						return off;
					},
					emit: trackedEmit,
					forward: trackedForward
				};
				const api = {
					...ctx,
					bus: scopedBus,
					on: trackedOn,
					emit: trackedEmit,
					forward: trackedForward,
					origin,
					contribute: (aff) => ctx.contexts.affordances.contribute({
						...aff,
						origin: aff.origin ?? origin
					}),
					declarePanel: (panel) => ctx.contexts.affordances.declarePanel({
						...panel,
						origin: panel.origin ?? origin
					}),
					expose: (key, value) => {
						ctx[key] = value;
					}
				};
				const original = ctx.contexts.commands.register;
				const taggedRegister = (specs) => original(specs, entry.name);
				const restore = ctx.contexts.commands.register;
				ctx.contexts.commands.register = taggedRegister;
				try {
					const dispose = entry.setup(api);
					if (dispose) disposers.push(dispose);
					running.set(entry.name, disposers);
				} finally {
					ctx.contexts.commands.register = restore;
				}
			});
		};
		register.stop = stopEntry;
		register.names = () => entries.map((entry) => entry.name);
		register.enabledNames = (flags) => entries.map((e) => e.name).filter((name) => flags.isOn(name));
		register.requires = (name) => entries.find((e) => e.name === name)?.requires ?? [];
		register.setRequires = (name, requires) => {
			const e = entries.find((e) => e.name === name);
			if (e) e.requires = requires;
		};
		register.kindOf = (name) => entries.find((e) => e.name === name)?.kind;
		return register;
	}
	/** Wrap a Registry so every call() injects a fixed `kind`. The wrapped object
	*  still delegates start/stop/names/etc. to the base, so multiple wrappers
	*  share one underlying registry — one flat list of entries, three external
	*  call surfaces tagged system / ability / feature. */
	function withKind(base, kind) {
		const wrapped = ((name, setup, opts = {}) => base(name, setup, {
			...opts,
			kind
		}));
		wrapped.start = base.start;
		wrapped.stop = base.stop;
		wrapped.names = base.names;
		wrapped.enabledNames = base.enabledNames;
		wrapped.requires = base.requires;
		wrapped.setRequires = base.setRequires;
		wrapped.kindOf = base.kindOf;
		return wrapped;
	}
	function createAppContext(graphs, model, initialFlags = {}, io = localStorageIo()) {
		const perf = createAppPerf(initialFlags);
		installGraphPerf(graphs, perf);
		const bus = eventBus(perf);
		const flags = createFlags(bus, initialFlags, io);
		return {
			bus,
			graphs,
			flags,
			selection: createSelectionStore(graphs, bus),
			io,
			perf,
			sim: createSim(bus),
			contexts: createContexts(bus, flags, io, perf),
			model: createModelRegistry(model, flags)
		};
	}
	//#endregion
	//#region frontend/abilities/shared.ts
	var action = (def) => ({
		ui: [],
		...def
	});
	var ability = (id, actions) => ({
		id,
		actions
	});
	//#endregion
	//#region frontend/abilities/collapsible.ts
	/** Collapsible — fold an item ("less detail"). Collapse is fold *state* (the
	*  shared `fold` store, Principle 18), not item data: toggling emits
	*  `fold.toggle` for the item's fold id, exactly like an outline section or zen.
	*  The item's rendered appearance (collapsed badge / `.collapsed` class) shows
	*  the open/closed state. */
	var collapsible = () => ability("collapsible", [action({
		id: "item.collapse",
		label: "Fold",
		paletteCommand: "item.collapse.toggle",
		ui: [{
			surface: "entity",
			command: "item.collapse.toggle",
			kind: "button",
			slot: Slots.HeaderStart,
			className: "node-action node-toggle",
			text: "▾",
			label: "Toggle fold"
		}]
	})]);
	function registerCollapsible(system) {
		system("ability.collapsible", ({ contexts, graphs, selection }) => {
			const refFromSource = (source) => itemRefFrom(source.target) ?? selection.selected();
			contexts.commands.register([{
				id: "item.collapse.toggle",
				label: "Toggle fold",
				event: "fold.toggle",
				group: "item",
				shortcut: "C",
				input: {
					on: "keydown",
					key: "c",
					prevent: true
				},
				available: (source) => !!refFromSource(source ?? {}),
				payload: (source) => {
					const ref = refFromSource(source);
					return ref ? { id: itemFoldId(ref, graphs.current.id) } : void 0;
				}
			}]);
		}, { requires: ["ability.selectable"] });
	}
	//#endregion
	//#region frontend/abilities/configurable.ts
	/** Configurable — any entity with declared `properties` can have this. The
	*  properties modal is rendered from `EntityDef.properties` and dispatch
	*  is generic: configurable emits `item.update` with the patch and the
	*  storage system for the ref's kind applies it. */
	var configurable = () => ability("configurable", [action({
		id: "item.configure",
		label: "Configure",
		paletteCommand: "item.properties.open",
		ui: [{
			surface: "entity",
			command: "item.properties.open",
			kind: "button",
			slot: Slots.HeaderEnd,
			className: "node-action node-config",
			text: "⚙",
			label: "Configure"
		}]
	})]);
	function registerConfigurable(system) {
		system("ability.configurable", ({ on, emit, contexts, graphs, model, selection }) => {
			const formRef = (target) => itemRefFrom(target?.closest(".properties")) ?? {
				kind: "node",
				id: ""
			};
			const item = (ref) => graphs.current.getItem(ref);
			const entityDef = (ref) => model.entity(ref.kind);
			const renderProperties = (ref, current, properties) => {
				const form = contexts.templates.clone("properties");
				form.dataset.itemKind = ref.kind;
				form.dataset.itemId = ref.id;
				const parent = itemParentAttr(ref.parent);
				if (parent) form.dataset.itemParent = parent;
				const fields = contexts.templates.slot(form, "fields");
				const byGroup = /* @__PURE__ */ new Map();
				properties.forEach((prop) => {
					const group = prop.group ?? "default";
					(byGroup.get(group) ?? byGroup.set(group, []).get(group)).push(prop);
				});
				byGroup.forEach((props, group) => {
					if (group !== "default") {
						const heading = document.createElement("div");
						heading.className = "property-group";
						heading.textContent = group;
						fields.append(heading);
					}
					props.forEach((prop) => fields.append(contexts.properties.render(prop, current)));
				});
				return form;
			};
			const applyProperty = (ref, field, value) => {
				const current = item(ref);
				const prop = entityDef(ref)?.properties?.find((candidate) => candidate.id === field);
				const patch = current && prop?.patch(current, value);
				if (!current || !patch) return;
				emit("item.update", {
					ref,
					patch
				});
			};
			const selected = () => selection.selected();
			contexts.commands.register([
				{
					id: "item.properties.open",
					label: "Open item properties",
					group: "item",
					shortcut: ".",
					input: {
						on: "keydown",
						key: ".",
						prevent: true
					},
					available: (source) => !!itemRefFrom(source?.target) || !!selected(),
					payload: (source) => itemRefFrom(source.target) ?? selected() ?? void 0
				},
				{
					id: "properties.item.input",
					label: "Edit item property",
					group: "properties",
					hidden: true,
					input: {
						on: "input",
						selector: ".properties input[data-field]:not([type=\"checkbox\"]), .properties textarea[data-field]"
					},
					payload: ({ target }) => ({
						ref: formRef(target),
						field: target?.getAttribute("data-field") ?? "",
						value: target.value
					})
				},
				{
					id: "properties.item.select",
					label: "Select item property",
					event: "properties.item.input",
					group: "properties",
					hidden: true,
					input: {
						on: "change",
						selector: ".properties select[data-field]"
					},
					payload: ({ target }) => ({
						ref: formRef(target),
						field: target?.getAttribute("data-field") ?? "",
						value: target.value
					})
				},
				{
					id: "properties.item.toggle",
					label: "Toggle item property",
					group: "properties",
					hidden: true,
					input: {
						on: "change",
						selector: ".properties input[type=\"checkbox\"][data-field]"
					},
					payload: ({ target }) => ({
						ref: formRef(target),
						field: target?.getAttribute("data-field") ?? "",
						checked: target.checked
					})
				}
			]);
			on("item.properties.open", (ref) => {
				const current = item(ref);
				const entity = entityDef(ref);
				const properties = entity?.properties ?? [];
				if (!current || !entity || !properties.length) return;
				emit("modal.open", {
					title: `${entity.label} Properties`,
					visual: "properties",
					body: () => renderProperties(ref, current, properties)
				});
			});
			on("properties.item.input", ({ ref, field, value }) => applyProperty(ref, field, value));
			on("properties.item.toggle", ({ ref, field, checked }) => applyProperty(ref, field, checked));
		}, { requires: ["ability.selectable", "modal"] });
	}
	//#endregion
	//#region frontend/abilities/draggable.ts
	/** Draggable — any item with a `Position` can be moved by pointer drag.
	*  The ability declares the drag handle slot; the renderer places it. */
	var draggable = () => ability("draggable", [action({
		id: "item.drag",
		label: "Drag with pointer",
		ui: [{
			surface: "entity",
			command: "drag.item.start",
			kind: "handler",
			slot: Slots.Drag,
			attrs: {
				"data-drag-handle": "",
				role: "button",
				"aria-label": "Drag item",
				title: "Drag item"
			}
		}]
	})]);
	function registerDraggable(system) {
		system("ability.draggable", ({ on, emit, contexts, graphs }) => {
			let drag = null;
			let pending = null;
			let scheduled = false;
			const applyPending = () => {
				scheduled = false;
				if (!drag || !pending) return;
				const pointer = contexts.view.clientToSpace(Places.Stage, pending);
				pending = null;
				const Position = {
					x: drag.start.x + pointer.x - drag.pointer.x,
					y: drag.start.y + pointer.y - drag.pointer.y
				};
				emit("item.update", {
					ref: drag.ref,
					patch: { Position }
				});
				emit("drag.item.moved", { ref: drag.ref });
			};
			const scheduleMove = (point) => {
				pending = point;
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(applyPending);
			};
			contexts.commands.register([
				{
					id: "drag.item.start",
					label: "Start drag",
					group: "drag",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: "[data-drag-handle]",
						when: (event) => !event.target.closest("[data-command]"),
						prevent: true
					},
					payload: ({ event, target }) => {
						const ref = itemRefFrom(target);
						return ref ? {
							ref,
							x: event.clientX,
							y: event.clientY
						} : void 0;
					}
				},
				{
					id: "drag.item.move",
					label: "Move dragged item",
					group: "drag",
					hidden: true,
					input: {
						on: "pointermove",
						when: () => !!drag,
						prevent: true
					},
					payload: ({ event }) => ({
						x: event.clientX,
						y: event.clientY
					})
				},
				{
					id: "drag.item.end",
					label: "End drag",
					group: "drag",
					hidden: true,
					input: {
						on: "pointerup",
						when: () => !!drag
					}
				}
			]);
			on("drag.item.start", ({ ref, x, y }) => {
				const item = graphs.current.getItem(ref);
				if (item?.Position) drag = {
					ref,
					pointer: contexts.view.clientToSpace(Places.Stage, {
						x,
						y
					}),
					start: { ...item.Position }
				};
			});
			on("drag.item.move", ({ x, y }) => {
				if (drag) scheduleMove({
					x,
					y
				});
			});
			on("drag.item.end", () => {
				if (pending) applyPending();
				drag = null;
				pending = null;
			});
		});
	}
	//#endregion
	//#region frontend/abilities/editable.ts
	/** Editable title — any item with a `Label.text` can use this.
	*  Convention: the entity's renderer must surface its title in an element
	*  carrying `[data-editable-title]`. Single click is selection; double-click
	*  (or Enter while selected) enters edit mode. */
	var editable = () => ability("editable", [action({
		id: "item.title.edit",
		label: "Edit title",
		paletteCommand: "item.title.edit",
		ui: []
	})]);
	function registerEditable(system) {
		system("ability.editable", ({ on, emit, contexts, graphs, selection, origin }) => {
			/** Find the title element belonging to a given ref. Generic over kind via the
			*  data-item-* tagging — works for node, container, or any future kind that
			*  marks its title with [data-editable-title]. */
			const titleEl = (ref) => {
				const el = (contexts.places.el(Places.Stage)?.querySelector(`[data-item-kind="${ref.kind}"][data-item-id="${ref.id}"]`))?.querySelector("[data-editable-title]") ?? null;
				return el instanceof HTMLElement ? el : null;
			};
			const refFromSource = (source) => itemRefFrom(source.target) ?? selection.selected();
			const titleCommit = (target, finish = false) => {
				const ref = itemRefFrom(target);
				return ref ? {
					ref,
					text: target?.textContent?.trim() ?? "",
					finish
				} : void 0;
			};
			/** Ref currently being edited (or null when no edit in progress). Powers
			*  the Cancellable + the focusout/Enter commit guard. */
			let editingRef = null;
			const enterEditMode = (el) => {
				el.contentEditable = "plaintext-only";
				el.classList.add("editing");
				el.focus();
				const range = document.createRange();
				range.selectNodeContents(el);
				const sel = getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			};
			const exitEditMode = (el) => {
				el.contentEditable = "inherit";
				el.classList.remove("editing");
			};
			contexts.commands.register([
				{
					id: "item.title.edit",
					label: "Edit title",
					group: "item",
					shortcut: "Enter",
					input: {
						on: "keydown",
						key: "Enter",
						prevent: true
					},
					available: (source) => !!refFromSource(source ?? {}),
					payload: (source) => {
						const ref = refFromSource(source);
						return ref ? { ref } : void 0;
					}
				},
				{
					id: "item.title.edit.dblclick",
					label: "Edit title on double-click",
					event: "item.title.edit",
					group: "item",
					hidden: true,
					input: {
						on: "dblclick",
						selector: "[data-editable-title]",
						prevent: true
					},
					payload: ({ target }) => {
						const ref = itemRefFrom(target);
						return ref ? { ref } : void 0;
					}
				},
				{
					id: "item.title.commit.enter",
					label: "Commit title (Enter)",
					event: "item.title.commit",
					group: "item",
					hidden: true,
					input: {
						on: "keydown",
						key: "Enter",
						selector: "[data-editable-title].editing",
						prevent: true,
						stop: true
					},
					payload: ({ target }) => titleCommit(target, true)
				},
				{
					id: "item.title.commit.focusout",
					label: "Commit title on focusout",
					event: "item.title.commit",
					group: "item",
					hidden: true,
					input: {
						on: "focusout",
						selector: "[data-editable-title].editing"
					},
					payload: ({ target }) => titleCommit(target)
				}
			]);
			on("item.title.edit", ({ ref }) => queueMicrotask(() => {
				const el = titleEl(ref);
				if (!el) return;
				editingRef = ref;
				enterEditMode(el);
			}));
			on("item.title.commit", ({ ref, text, finish }) => {
				const item = graphs.current.getItem(ref);
				if (!item) return;
				if (text && text !== item.Label.text) emit("item.update", {
					ref,
					patch: { Label: { text } }
				});
				if (!text) {
					const el = titleEl(ref);
					if (el) el.textContent = item.Label.text;
				}
				const el = titleEl(ref);
				if (el) exitEditMode(el);
				if (finish) queueMicrotask(() => {
					titleEl(ref)?.blur();
				});
				if (editingRef && editingRef.kind === ref.kind && editingRef.id === ref.id) editingRef = null;
			});
			contexts.cancellation.register({
				origin,
				active: () => !!editingRef,
				cancel: () => {
					const ref = editingRef;
					if (!ref) return;
					const el = titleEl(ref);
					if (!el) return;
					emit("item.title.commit", {
						ref,
						text: el.textContent?.trim() ?? "",
						finish: true
					});
				}
			});
		}, { requires: ["ability.selectable"] });
	}
	//#endregion
	//#region frontend/abilities/nudgeable.ts
	var NUDGE_DIRECTIONS = [
		{
			dir: "right",
			key: "ArrowRight",
			dx: 24,
			dy: 0
		},
		{
			dir: "left",
			key: "ArrowLeft",
			dx: -24,
			dy: 0
		},
		{
			dir: "up",
			key: "ArrowUp",
			dx: 0,
			dy: -24
		},
		{
			dir: "down",
			key: "ArrowDown",
			dx: 0,
			dy: 24
		}
	];
	/** Nudgeable — any positioned item can be moved by arrow keys when chosen.
	*  Keyboard-only: the affordance is the shortcut on the paletteCommand. Moves
	*  the entire chosen set, so arrows move 1 or N items with the same keystroke. */
	var nudgeable = () => ability("nudgeable", NUDGE_DIRECTIONS.map(({ dir }) => action({
		id: `item.nudge.${dir}`,
		label: `Nudge ${dir}`,
		paletteCommand: `item.nudge.${dir}`
	})));
	function registerNudgeable(system) {
		system("ability.nudgeable", ({ on, emit, contexts, graphs, selection }) => {
			const hasPositioned = () => selection.selectedAll().some((ref) => {
				return !!graphs.current.getItem(ref)?.Position;
			});
			contexts.commands.register(NUDGE_DIRECTIONS.map(({ dir, key, dx, dy }) => ({
				id: `item.nudge.${dir}`,
				label: `Nudge ${dir}`,
				event: "item.nudge",
				group: "item",
				shortcut: key,
				input: {
					on: "keydown",
					key,
					prevent: true
				},
				available: () => hasPositioned(),
				payload: () => ({
					dx,
					dy
				})
			})));
			on("item.nudge", ({ dx, dy }) => {
				const all = selection.selectedAll();
				const inSet = (ref) => all.some((r) => sameItemRef(r, ref));
				const updates = [];
				all.forEach((ref) => {
					if (contexts.hierarchy.parentChain(ref).some(inSet)) return;
					const item = graphs.current.getItem(ref);
					if (!item?.Position) return;
					updates.push({
						ref,
						patch: { Position: {
							x: item.Position.x + dx,
							y: item.Position.y + dy
						} }
					});
				});
				if (updates.length === 1) emit("item.update", updates[0]);
				else if (updates.length) emit("item.update.batch", { updates });
			});
		}, { requires: ["ability.selectable"] });
	}
	//#endregion
	//#region frontend/abilities/resizeable.ts
	/** Resizeable — any item with a `Size` can be resized by dragging a corner handle.
	*  The renderer must surface a `[data-resize-handle]` element somewhere on the
	*  item; the ability declaration only contributes the affordance metadata.
	*  Side effect on commit: a manual resize sets `AutoFit: false` on the item if
	*  the storage system supports auto-fit (containers do). Other kinds just get
	*  their Size updated. */
	var resizeable = () => ability("resizeable", [action({
		id: "item.resize",
		label: "Resize",
		ui: [{
			surface: "entity",
			command: "resize.item.start",
			kind: "handler",
			slot: Slots.Resize,
			attrs: {
				"data-resize-handle": "",
				role: "button",
				"aria-label": "Resize item",
				title: "Resize item"
			}
		}]
	})]);
	function registerResizeable(system) {
		system("ability.resizeable", ({ on, emit, contexts, graphs, model }) => {
			let resize = null;
			const itemRect = (ref, item) => {
				const rendered = model.entity(ref.kind)?.render?.bounds?.(item);
				if (rendered) return rendered;
				if (!item.Position) return null;
				return {
					x: item.Position.x - item.Size.w / 2,
					y: item.Position.y - item.Size.h / 2,
					w: item.Size.w,
					h: item.Size.h
				};
			};
			contexts.commands.register([
				{
					id: "resize.item.start",
					label: "Start resize",
					group: "resize",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: "[data-resize-handle]",
						prevent: true,
						stop: true
					},
					payload: ({ event, target }) => {
						const ref = itemRefFrom(target);
						return ref ? {
							ref,
							x: event.clientX,
							y: event.clientY
						} : void 0;
					}
				},
				{
					id: "resize.item.move",
					label: "Resize item",
					group: "resize",
					hidden: true,
					input: {
						on: "pointermove",
						when: () => !!resize,
						prevent: true
					},
					payload: ({ event }) => ({
						x: event.clientX,
						y: event.clientY
					})
				},
				{
					id: "resize.item.end",
					label: "End resize",
					group: "resize",
					hidden: true,
					input: {
						on: "pointerup",
						when: () => !!resize
					}
				}
			]);
			on("resize.item.start", ({ ref, x, y }) => {
				const item = graphs.current.getItem(ref);
				if (!item?.Size) return;
				const rect = itemRect(ref, item);
				if (!rect) return;
				resize = {
					ref,
					pointer: contexts.view.clientToSpace(Places.Stage, {
						x,
						y
					}),
					topLeft: {
						x: rect.x,
						y: rect.y
					}
				};
			});
			on("resize.item.move", ({ x, y }) => {
				if (!resize) return;
				const pointer = contexts.view.clientToSpace(Places.Stage, {
					x,
					y
				});
				const w = Math.max(40, pointer.x - resize.topLeft.x);
				const h = Math.max(40, pointer.y - resize.topLeft.y);
				const Position = {
					x: resize.topLeft.x + w / 2,
					y: resize.topLeft.y + h / 2
				};
				emit("item.update", {
					ref: resize.ref,
					patch: {
						Size: {
							w,
							h
						},
						Position,
						AutoFit: false
					}
				});
				emit("resize.item.changed", { ref: resize.ref });
			});
			on("resize.item.end", () => {
				resize = null;
			});
		}, { requires: ["ability.selectable"] });
	}
	//#endregion
	//#region frontend/abilities/selectable.ts
	/** Selectable — every entity that has an id can have this. The pointerdown
	*  handler is registered globally (looks for [data-item-kind][data-item-id]) so
	*  no template slot is required; declaring the ability is enough.
	*  Keyboard reachability: the entity-surface UI handler is the affordance; no
	*  paletteCommand because there's no concept of "select THIS item via keyboard"
	*  outside of Tab cycling (which lives as its own standalone command). */
	var selectable = () => ability("selectable", [action({
		id: "item.select",
		label: "Select item",
		ui: [{
			surface: "entity",
			command: "selection.item.select",
			kind: "handler"
		}]
	})]);
	function registerSelectable(system) {
		system("ability.selectable", ({ on, emit, contexts, graphs, selection, origin }) => {
			const selectedNodeId = () => selection.selectedNode()?.id ?? null;
			const nodeId = (source) => itemIdFrom(source.target) || selectedNodeId() || "";
			const visibleNodes = () => graphs.current.nodes().filter((node) => !foldHidden(nodeRef(node.id), contexts.hierarchy.parentChain, contexts.fold, graphs.current.id));
			const nextNodeId = () => {
				const nodes = visibleNodes();
				return nodes[(Math.max(0, nodes.findIndex((node) => node.id === selectedNodeId())) + 1) % nodes.length]?.id ?? nodes[0]?.id ?? "";
			};
			const previousNodeId = () => {
				const nodes = visibleNodes();
				const index = nodes.findIndex((node) => node.id === selectedNodeId());
				return nodes[(index <= 0 ? nodes.length : index) - 1]?.id ?? nodes[0]?.id ?? "";
			};
			contexts.commands.register([
				{
					id: "selection.item.select",
					label: "Select item",
					group: "selection",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: "[data-item-kind][data-item-id]",
						when: (event) => !event.target.closest("[data-command], [data-drag-handle], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .modal-layer, input, textarea, select, label"),
						prevent: true,
						stop: true
					},
					payload: (source) => itemRefFrom(source.target) ?? nodeRef(nodeId(source))
				},
				{
					id: "selection.item.toggle",
					label: "Toggle item in selection",
					group: "selection",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: "[data-item-kind][data-item-id]",
						shift: true,
						when: (event) => !event.target.closest("[data-command], [data-drag-handle], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .modal-layer, input, textarea, select, label"),
						prevent: true,
						stop: true
					},
					payload: (source) => itemRefFrom(source.target) ?? nodeRef(nodeId(source))
				},
				{
					id: "selection.node.select",
					label: "Select node",
					group: "selection",
					hidden: true,
					payload: (source) => ({ id: nodeId(source) })
				},
				{
					id: "selection.node.next",
					label: "Select next node",
					event: "selection.node.select",
					group: "selection",
					shortcut: "Tab",
					input: {
						on: "keydown",
						key: "Tab",
						prevent: true
					},
					available: () => graphs.current.nodes().length > 0,
					payload: () => ({ id: nextNodeId() })
				},
				{
					id: "selection.node.previous",
					label: "Select previous node",
					event: "selection.node.select",
					group: "selection",
					shortcut: "Shift+Tab",
					input: {
						on: "keydown",
						key: "Tab",
						shift: true,
						prevent: true
					},
					available: () => graphs.current.nodes().length > 0,
					payload: () => ({ id: previousNodeId() })
				},
				{
					id: "selection.node.clear",
					label: "Clear selection",
					group: "selection",
					available: () => !!selection.selected()
				},
				{
					id: "selection.item.delete",
					label: "Delete selection",
					group: "selection",
					shortcut: "X",
					input: {
						on: "keydown",
						key: "x",
						prevent: true
					},
					available: () => !!selection.selected()
				}
			]);
			on("selection.node.select", ({ id }) => emit("selection.item.select", nodeRef(id)));
			on("selection.node.clear", () => emit("selection.item.clear"));
			on("selection.item.select", (ref) => selection.select(ref));
			on("selection.item.toggle", (ref) => selection.toggle(ref));
			on("selection.item.clear", () => selection.select(null));
			on("selection.choose", ({ refs, mode }) => {
				if (mode === "add") refs.forEach((ref) => selection.add(ref));
				else if (mode === "remove") refs.forEach((ref) => selection.remove(ref));
				else if (mode === "toggle") refs.forEach((ref) => selection.toggle(ref));
				else selection.choose(refs);
			});
			on("selection.changed", ({ refs }) => {
				if (refs.length) contexts.decorations.modes.set(origin, "selected", refs);
				else contexts.decorations.unregisterOrigin(origin);
				const primary = refs[refs.length - 1] ?? null;
				if (primary) emit("focus.item.focus", primary);
				else emit("focus.item.clear");
			});
			on("selection.item.delete", () => {
				const refs = selection.selectedAll();
				selection.select(null);
				refs.forEach((ref) => {
					if (ref.kind === "node") emit("graph.node.delete", { id: ref.id });
					if (ref.kind === "edge") emit("graph.edge.delete", { id: ref.id });
				});
			});
			contexts.cancellation.register({
				origin,
				priority: -10,
				active: () => selection.selectedAll().length > 0,
				cancel: () => emit("selection.item.clear")
			});
		});
	}
	//#endregion
	//#region frontend/abilities/index.ts
	function registerAbilitySystems(system) {
		registerSelectable(system);
		registerDraggable(system);
		registerNudgeable(system);
		registerCollapsible(system);
		registerEditable(system);
		registerConfigurable(system);
		registerResizeable(system);
	}
	//#endregion
	//#region frontend/core/mount.ts
	/** Mount root indirection.
	*
	* The dev app renders into `#app` (index.html). When the app is embedded as a
	* library it must render into a caller-supplied element instead — the host page
	* owns its own DOM and there may be no `#app`. `setMountRoot` lets the library
	* point the renderer at any element before boot; `mountRoot` is what `render`
	* resolves against. Default preserves the standalone behaviour. */
	var root = null;
	var setMountRoot = (el) => {
		root = el;
	};
	var mountRoot = () => {
		if (root) return root;
		const el = document.getElementById("app");
		if (!el) throw new Error("mountRoot: no element set and no #app in document");
		return el;
	};
	//#endregion
	//#region frontend/features.ts
	function registerFeatures(feature) {
		feature("nodeLifecycle", ({ on, emit, contexts, graphs, selection }) => {
			const rectContains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
			const createdNodeIsOffscreen = (id) => {
				const node = graphs.current.getNode(id);
				const visible = contexts.view.visibleRect(Places.Stage);
				return !!node && !!visible && !rectContains(visible, nodeRect(node));
			};
			/** When a node is already selected, A creates a child of it and wires the
			*  edge in one keystroke; the new node becomes the selection so further
			*  A keystrokes build a chain. Shift+A does the same but keeps the
			*  selection on the source so sequence builders can fan out siblings. */
			const attachedDraft = (keepFocus) => {
				const selected = selection.selectedNode();
				const base = { Label: { text: `Node ${graphs.current.nodes().length + 1}` } };
				if (!selected) return base;
				return {
					...base,
					relativeTo: selected.id,
					connectFrom: selected.id,
					...keepFocus ? { keepFocus: true } : {}
				};
			};
			contexts.commands.register([{
				id: "editing.node.create",
				label: "Create node",
				group: "editing",
				shortcut: "A",
				input: {
					on: "keydown",
					key: "a",
					prevent: true
				},
				payload: () => attachedDraft(false)
			}, {
				id: "editing.node.create.keep",
				label: "Create attached node (keep selection)",
				event: "editing.node.create",
				group: "editing",
				shortcut: "Shift+A",
				input: {
					on: "keydown",
					key: "A",
					shift: true,
					prevent: true
				},
				available: () => !!selection.selectedNode(),
				payload: () => attachedDraft(true)
			}]);
			on("editing.node.create", (draft) => emit("graph.node.create", draft));
			on("graph.node.created", ({ id, hints }) => {
				if (!hints?.keepFocus) {
					emit("selection.node.select", { id });
					emit("focus.node.focus", { id });
				}
				if (hints?.connectFrom) emit("graph.edge.create", {
					From: hints.connectFrom,
					To: id,
					EdgeKind: hints.connectKind
				});
				if (createdNodeIsOffscreen(id)) emit("view.fit.item", {
					kind: "node",
					id
				});
			});
		}, { requires: [
			"graph",
			"ability.selectable",
			"focus"
		] });
		feature("edgeLifecycle", ({ on, emit, contexts, graphs, selection }) => {
			contexts.commands.register([{
				id: "editing.edge.create",
				label: "Create edge",
				group: "edge",
				shortcut: "E",
				input: {
					on: "keydown",
					key: "e",
					prevent: true
				},
				picker: {
					title: "Create edge",
					steps: [{
						id: "From",
						prompt: "Pick source node",
						filter: () => (ref) => ref.kind === "node",
						seed: () => {
							const ref = selection.selected();
							return ref?.kind === "node" ? ref : null;
						}
					}, {
						id: "To",
						prompt: "Pick target node",
						filter: (values) => (ref) => ref.kind === "node" && ref.id !== values.From?.id
					}],
					validate: (values) => {
						if (graphs.current.nodes().length < 2) return "Create at least two nodes before creating an edge.";
						if (!values.From || !values.To) return "Pick both source and target.";
						if (values.From.id === values.To.id) return "Source and target must be different nodes.";
					},
					payload: (values) => ({
						From: values.From?.id ?? "",
						To: values.To?.id ?? ""
					})
				}
			}]);
			on("editing.edge.create", (draft) => {
				const From = draft.From ?? "";
				const To = draft.To ?? "";
				if (!From || !To || From === To) return;
				if (!graphs.current.getNode(From) || !graphs.current.getNode(To)) return;
				emit("graph.edge.create", {
					From,
					To,
					Label: draft.Label
				});
			});
		}, { requires: ["graph"] });
		feature("autoLayout", ({ on, emit, graphs }) => {
			const MAX_AUTO_LAYOUT_NODES = 250;
			let pending = false;
			const scheduleTidy = () => {
				if (graphs.current.nodes().length > MAX_AUTO_LAYOUT_NODES) return;
				if (pending) return;
				pending = true;
				queueMicrotask(() => {
					pending = false;
					emit("layout.apply.tidy");
				});
			};
			on("graph.node.created", scheduleTidy);
			on("graph.node.deleted", scheduleTidy);
			on("container.children.changed", scheduleTidy);
		}, { requires: ["graph", "layout"] });
	}
	//#endregion
	//#region frontend/model/collections.ts
	var collection = (def) => def;
	var appCollections = [
		collection({
			id: "graphs",
			label: "Graphs",
			kind: "graph",
			items: (ctx) => ctx.graphs.all(),
			toolbar: {
				text: "+ Graph",
				order: 20
			}
		}),
		collection({
			id: "nodes",
			label: "Nodes",
			kind: "node",
			items: (ctx) => ctx.graphs.current.nodes(),
			toolbar: {
				text: "+ Node",
				order: 10
			}
		}),
		collection({
			id: "edges",
			label: "Edges",
			kind: "edge",
			items: (ctx) => ctx.graphs.current.edges(),
			toolbar: {
				text: "+ Edge",
				order: 15
			}
		})
	];
	//#endregion
	//#region frontend/core/markdown.ts
	var appendInline = (parent, text) => {
		const token = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
		let cursor = 0;
		for (const match of text.matchAll(token)) {
			const raw = match[0];
			const index = match.index ?? 0;
			if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)));
			if (raw.startsWith("**")) {
				const strong = document.createElement("strong");
				strong.textContent = raw.slice(2, -2);
				parent.appendChild(strong);
			} else if (raw.startsWith("`")) {
				const code = document.createElement("code");
				code.textContent = raw.slice(1, -1);
				parent.appendChild(code);
			} else {
				const [, label, href] = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
				const link = document.createElement("a");
				link.textContent = label ?? raw;
				link.href = href && /^(https?:|mailto:|#|\/)/i.test(href) ? href : "#";
				link.rel = "noreferrer";
				link.target = "_blank";
				parent.appendChild(link);
			}
			cursor = index + raw.length;
		}
		if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
	};
	function renderMarkdown(markdown) {
		const fragment = document.createDocumentFragment();
		const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
		let list = null;
		const endList = () => {
			list = null;
		};
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				endList();
				continue;
			}
			if (trimmed.startsWith("- ")) {
				list ??= document.createElement("ul");
				if (!fragment.contains(list)) fragment.append(list);
				const item = document.createElement("li");
				appendInline(item, trimmed.slice(2));
				list.append(item);
				continue;
			}
			endList();
			const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
			const block = document.createElement(heading ? "h4" : "p");
			appendInline(block, heading?.[2] ?? trimmed);
			fragment.append(block);
		}
		return fragment;
	}
	//#endregion
	//#region frontend/model/entities.ts
	/** Built-in entity declarations — what a graph / node / edge *is*: its label,
	*  abilities, properties, and renderer. Behavior (commands, storage handlers,
	*  lifecycle) lives in `systems/graph.ts`; this file is pure declaration so
	*  "what is a node" and "what happens to a node" have separate homes. Plugin
	*  kinds (containers) declare themselves inside their own system file; the
	*  built-ins live here in the model. */
	var SVG_NS = "http://www.w3.org/2000/svg";
	var svg = (name, attrs) => {
		const el = document.createElementNS(SVG_NS, name);
		Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
		return el;
	};
	var property = (def) => def;
	var entityDef = (kind, def) => ({
		kind,
		...def
	});
	var NODE_TYPES = [
		{
			value: "text",
			label: "Text"
		},
		{
			value: "square",
			label: "Square"
		},
		{
			value: "circle",
			label: "Circle"
		},
		{
			value: "user-input",
			label: "User input"
		},
		{
			value: "gateway",
			label: "Gateway"
		},
		{
			value: "service",
			label: "Service"
		},
		{
			value: "database",
			label: "Database"
		},
		{
			value: "kafka",
			label: "Kafka"
		},
		{
			value: "index",
			label: "Index"
		},
		{
			value: "cache",
			label: "Cache"
		},
		{
			value: "rate-limit",
			label: "Rate limiter"
		},
		{
			value: "circuit-breaker",
			label: "Circuit breaker"
		}
	];
	var isNodeType = (value) => NODE_TYPES.some((option) => option.value === value);
	var EDGE_KINDS = [
		{
			value: "sync",
			label: "Sync request"
		},
		{
			value: "async",
			label: "Async request"
		},
		{
			value: "read",
			label: "Read"
		},
		{
			value: "write",
			label: "Write"
		}
	];
	var isEdgeKind = (value) => EDGE_KINDS.some((option) => option.value === value);
	var typeLabel = (type) => NODE_TYPES.find((option) => option.value === type)?.label ?? type;
	var numberPatch = (key, value) => {
		const n = Number(value);
		return value === "" || !Number.isFinite(n) ? { [key]: void 0 } : { [key]: n };
	};
	var graphEntity = entityDef("graph", {
		label: "Graph",
		labelOf: (graph) => graph.id,
		abilities: []
	});
	/** Shrink the line endpoint to the target rect's border so the arrowhead lands
	*  outside the card, not inside it. Treats the target as an axis-aligned
	*  rectangle centered on `(cx, cy)` with half-dims `(hw, hh)`. */
	var intersectRectBoundary = (outside, rectCenter, half) => {
		const { x: cx, y: cy } = rectCenter;
		const dx = outside.x - cx, dy = outside.y - cy;
		if (dx === 0 && dy === 0) return {
			x: cx,
			y: cy
		};
		const tx = dx === 0 ? Infinity : Math.abs(half.w / dx);
		const ty = dy === 0 ? Infinity : Math.abs(half.h / dy);
		const t = Math.min(tx, ty);
		return {
			x: cx + dx * t,
			y: cy + dy * t
		};
	};
	/** Compute the visible endpoint for an edge anchor: if the node is inside a
	*  Collapsed container, the endpoint snaps to the outermost collapsed
	*  ancestor's visual rect. Otherwise it's the node itself. Returns null when
	*  neither resolves (orphaned edge — render skips it). */
	var resolveEndpoint = (nodeRef, ctx) => {
		const collapsed = ctx.parentChain(nodeRef).find((a) => ctx.isFolded(a));
		if (collapsed) {
			const rect = ctx.boundsOf(collapsed);
			if (!rect) return null;
			return {
				ref: collapsed,
				center: {
					x: rect.x + rect.w / 2,
					y: rect.y + rect.h / 2
				},
				half: {
					w: rect.w / 2,
					h: rect.h / 2
				}
			};
		}
		const node = ctx.graph.getItem(nodeRef);
		if (!node?.Position) return null;
		return {
			ref: nodeRef,
			center: node.Position,
			half: {
				w: node.Size.w / 2,
				h: node.Size.h / 2
			}
		};
	};
	var edgeEntity = entityDef("edge", {
		label: "Edge",
		labelOf: (edge) => edge.Label?.text ?? `${edge.From}->${edge.To}`,
		abilities: [],
		render: {
			layer: "svg",
			collect(graph, hiddenByFold, visibleNodeIds) {
				const g = graph;
				const nodeIds = visibleNodeIds ?? new Set(g.nodes().map((n) => n.id));
				const seen = /* @__PURE__ */ new Set();
				const edges = [];
				for (const nid of nodeIds) for (const e of g.edgesOf(nid)) {
					const k = e.id;
					if (!seen.has(k)) {
						seen.add(k);
						edges.push(e);
					}
				}
				return edges;
			},
			draw(edge, ctx) {
				const from = resolveEndpoint({
					kind: "node",
					id: edge.From
				}, ctx);
				const to = resolveEndpoint({
					kind: "node",
					id: edge.To
				}, ctx);
				if (!from || !to) return null;
				if (from.ref.kind === to.ref.kind && from.ref.id === to.ref.id) return null;
				const ref = ctx.refOf(edge.id);
				const tipAtTarget = intersectRectBoundary(from.center, to.center, to.half);
				const tipAtSource = intersectRectBoundary(to.center, from.center, from.half);
				const g = svg("g", {});
				const edgeKind = isEdgeKind(edge.EdgeKind) ? edge.EdgeKind : "sync";
				g.setAttribute("class", `edge edge-kind-${edgeKind}`);
				const titleText = semanticTitle(edge);
				if (titleText) {
					const title = svg("title", {});
					title.textContent = titleText;
					g.append(title);
				}
				const line = (className, x1, y1, x2, y2, extra = {}) => {
					const el = svg("line", {
						x1,
						y1,
						x2,
						y2,
						class: `${className} edge-kind-${edgeKind}`,
						...extra
					});
					ctx.tagItem(el, ref);
					ctx.applyItemModes(el, ref);
					return el;
				};
				g.append(line("edge-hit", from.center.x, from.center.y, to.center.x, to.center.y, { tabindex: -1 }));
				g.append(line("edge-line", tipAtSource.x, tipAtSource.y, tipAtTarget.x, tipAtTarget.y, { "marker-end": "url(#edge-arrow)" }));
				const label = edge.Label?.text;
				if (label) {
					const midX = (from.center.x + to.center.x) / 2;
					const midY = (from.center.y + to.center.y) / 2;
					const lines = label.split(/\r?\n/);
					const lineH = 14;
					const startY = midY - (lines.length - 1) * lineH / 2 - 4;
					const text = svg("text", {
						class: `edge-label edge-kind-${edgeKind}`,
						"text-anchor": "middle"
					});
					lines.forEach((line, i) => {
						const tspan = svg("tspan", {
							x: midX,
							y: startY + i * lineH
						});
						tspan.textContent = line;
						text.append(tspan);
					});
					g.append(text);
				}
				return g;
			},
			signature(edge) {
				return `${edge.From}->${edge.To}|${edge.Label?.text ?? ""}|${edge.EdgeKind ?? ""}|${edge.LatencyMs ?? ""}|${edge.ThroughputRps ?? ""}|${edge.PayloadKb ?? ""}|${edge.Purpose ?? ""}|${edge.Assumptions ?? ""}|${edge.Limits ?? ""}|${edge.WhatThen ?? ""}|${edge.Observability ?? ""}|${edge.FailureMode ?? ""}|${edge.DataScale ?? ""}|${edge.FreshnessMs ?? ""}`;
			}
		},
		properties: [
			property({
				id: "label",
				label: "Label",
				input: "text",
				value: (edge) => edge.Label?.text ?? "",
				patch: (_edge, value) => ({ Label: { text: String(value) } })
			}),
			property({
				id: "edgeKind",
				label: "Type",
				input: "select",
				options: EDGE_KINDS,
				value: (edge) => edge.EdgeKind ?? "sync",
				patch: (_edge, value) => isEdgeKind(value) ? { EdgeKind: value } : void 0
			}),
			property({
				id: "latencyMs",
				label: "Latency ms",
				input: "number",
				min: 0,
				step: 1,
				group: "Performance",
				value: (edge) => edge.LatencyMs ?? "",
				patch: (_edge, value) => numberPatch("LatencyMs", value)
			}),
			property({
				id: "throughputRps",
				label: "Throughput rps",
				input: "number",
				min: 0,
				step: 10,
				group: "Performance",
				value: (edge) => edge.ThroughputRps ?? "",
				patch: (_edge, value) => numberPatch("ThroughputRps", value)
			}),
			property({
				id: "payloadKb",
				label: "Payload KB",
				input: "number",
				min: 0,
				step: 1,
				group: "Performance",
				value: (edge) => edge.PayloadKb ?? "",
				patch: (_edge, value) => numberPatch("PayloadKb", value)
			}),
			property({
				id: "purpose",
				label: "Purpose",
				input: "textarea",
				rows: 3,
				group: "Semantics",
				value: (edge) => edge.Purpose ?? "",
				patch: (_edge, value) => ({ Purpose: String(value) })
			}),
			property({
				id: "assumptions",
				label: "Assumptions",
				input: "textarea",
				rows: 3,
				group: "Semantics",
				value: (edge) => edge.Assumptions ?? "",
				patch: (_edge, value) => ({ Assumptions: String(value) })
			}),
			property({
				id: "limits",
				label: "Limits",
				input: "textarea",
				rows: 3,
				group: "Semantics",
				value: (edge) => edge.Limits ?? "",
				patch: (_edge, value) => ({ Limits: String(value) })
			}),
			property({
				id: "whatThen",
				label: "What then",
				input: "textarea",
				rows: 3,
				group: "Semantics",
				value: (edge) => edge.WhatThen ?? "",
				patch: (_edge, value) => ({ WhatThen: String(value) })
			}),
			property({
				id: "observability",
				label: "Observability",
				input: "textarea",
				rows: 3,
				group: "Observability",
				value: (edge) => edge.Observability ?? "",
				patch: (_edge, value) => ({ Observability: String(value) })
			}),
			property({
				id: "failureMode",
				label: "What if fails",
				input: "textarea",
				rows: 3,
				group: "Observability",
				value: (edge) => edge.FailureMode ?? "",
				patch: (_edge, value) => ({ FailureMode: String(value) })
			}),
			property({
				id: "freshnessMs",
				label: "Freshness budget ms",
				input: "number",
				min: 0,
				step: 100,
				group: "Observability",
				value: (edge) => edge.FreshnessMs ?? "",
				patch: (_edge, value) => numberPatch("FreshnessMs", value)
			})
		]
	});
	var nodeBoundsOf = (node) => {
		const pos = node.Position ?? {
			x: 0,
			y: 0
		};
		return {
			x: pos.x - node.Size.w / 2,
			y: pos.y - node.Size.h / 2,
			w: node.Size.w,
			h: node.Size.h
		};
	};
	//#endregion
	//#region frontend/model/app.ts
	/** The built-in domain. Entities (graph / node / edge) are declared in
	*  `entities.ts`, collections in `collections.ts`. Behavior lives in systems.
	*  Plugin kinds (containers, future groups/regions) register themselves at boot
	*  via `ctx.model.registerEntity` from their own system file — the model seed is
	*  only the always-on built-ins. */
	var appModel = {
		entities: [
			graphEntity,
			entityDef("node", {
				label: "Node",
				labelOf: (node) => node.Label.text,
				render: {
					layer: "html",
					bounds: nodeBoundsOf,
					collect(graph, hiddenByFold, visibleNodeIds) {
						const g = graph;
						return (visibleNodeIds ? [...visibleNodeIds].map((id) => g.node(id)).filter((n) => !!n) : g.nodes()).filter((n) => !hiddenByFold({
							kind: "node",
							id: n.id
						}));
					},
					draw(node, ctx) {
						const el = ctx.cloneTemplate("node");
						const pos = node.Position ?? {
							x: 0,
							y: 0
						};
						const ref = ctx.refOf(node.id);
						const nodeType = node.NodeType ?? "text";
						const description = node.Description?.trim() ?? "";
						const meta = [
							node.ExpectedRps != null ? `${node.ExpectedRps}/s` : "",
							node.LatencyMs != null ? `${node.LatencyMs}ms` : "",
							node.ComputeMs != null ? `${node.ComputeMs}ms cpu` : ""
						].filter(Boolean).join(" · ");
						ctx.tagItem(el, ref);
						el.tabIndex = -1;
						ctx.applyItemModes(el, ref);
						el.classList.toggle("collapsed", ctx.isFolded(ref));
						el.classList.add(`node-type-${nodeType}`);
						el.classList.toggle("has-description", !!description);
						el.classList.toggle("semantic-big-data", node.DataScale === "big" || node.DataScale === "huge");
						el.classList.toggle("semantic-stale-risk", node.FreshnessMs != null && node.FreshnessMs > 6e4);
						el.dataset.nodeType = nodeType;
						if (node.DataScale) el.dataset.dataScale = node.DataScale;
						const titleText = semanticTitle(node);
						if (titleText) el.title = titleText;
						el.style.left = `${pos.x}px`;
						el.style.top = `${pos.y}px`;
						el.style.width = `${node.Size.w}px`;
						el.style.height = `${node.Size.h}px`;
						ctx.templateText(el, "type", typeLabel(nodeType));
						ctx.templateText(el, "metrics", meta);
						ctx.templateText(el, "title", node.Label.text);
						ctx.templateSlot(el, "description").replaceChildren(renderMarkdown(description));
						ctx.wireAffordances(el);
						return el;
					},
					/** Drag / nudge only changes where the node sits — move the existing element
					*  (keeps its identity so CSS can ease the move; no rebuild). */
					reposition(el, node) {
						const pos = node.Position ?? {
							x: 0,
							y: 0
						};
						el.style.left = `${pos.x}px`;
						el.style.top = `${pos.y}px`;
					},
					/** Everything the drawn node depends on *except* position. Unchanged ⇒ the
					*  stage takes the cheap `reposition` path instead of a full redraw. */
					signature(node) {
						return `${node.NodeType ?? "text"}|${node.Size.w}x${node.Size.h}|${node.Label.text}|${node.Description ?? ""}|${node.ComputeMs ?? ""}|${node.ExpectedRps ?? ""}|${node.LatencyMs ?? ""}|${node.Purpose ?? ""}|${node.Assumptions ?? ""}|${node.Limits ?? ""}|${node.WhatThen ?? ""}|${node.Observability ?? ""}|${node.FailureMode ?? ""}|${node.DataScale ?? ""}|${node.FreshnessMs ?? ""}`;
					}
				},
				abilities: [
					selectable(),
					draggable(),
					nudgeable(),
					collapsible(),
					editable(),
					configurable()
				],
				properties: [
					property({
						id: "title",
						label: "Title",
						input: "text",
						value: (node) => node.Label.text,
						patch: (_node, value) => ({ Label: { text: String(value) } })
					}),
					property({
						id: "nodeType",
						label: "Type",
						input: "select",
						options: NODE_TYPES,
						value: (node) => node.NodeType ?? "text",
						patch: (_node, value) => isNodeType(value) ? { NodeType: value } : void 0
					}),
					property({
						id: "description",
						label: "Markdown description",
						input: "textarea",
						rows: 6,
						group: "Content",
						value: (node) => node.Description ?? "",
						patch: (_node, value) => ({ Description: String(value) })
					}),
					property({
						id: "width",
						label: "Width",
						input: "number",
						min: 96,
						step: 8,
						value: (node) => node.Size.w,
						patch: (node, value) => {
							const width = Number(value);
							return Number.isFinite(width) ? { Size: {
								...node.Size,
								w: clamp$1(width, 96, 900)
							} } : void 0;
						}
					}),
					property({
						id: "height",
						label: "Height",
						input: "number",
						min: 40,
						step: 8,
						value: (node) => node.Size.h,
						patch: (node, value) => {
							const height = Number(value);
							return Number.isFinite(height) ? { Size: {
								...node.Size,
								h: clamp$1(height, 40, 900)
							} } : void 0;
						}
					})
				]
			}),
			edgeEntity
		],
		collections: appCollections
	};
	//#endregion
	//#region frontend/runtime.ts
	/** Hot-toggle the flag-driven lifecycle of any registered entry. One flat
	*  registry now holds system / ability / feature entries — distinguished by
	*  `kind`, not by which list they live in — so flag toggles call
	*  `registry.stop` / `registry.start` directly. */
	function installRuntimeFeatureManager(ctx, registry) {
		const redraw = () => {
			ctx.bus.emit("render.stage.draw", { full: true });
			ctx.bus.emit("outline.draw");
		};
		const manager = {
			registry,
			setFlag(name, on) {
				ctx.flags.set(name, on);
				if (registry.names().includes(name)) if (on) registry.start(ctx);
				else registry.stop(ctx, name);
				redraw();
			},
			refresh() {
				registry.start(ctx);
				redraw();
			}
		};
		ctx.registry = registry;
		ctx.runtime = manager;
		return ctx.bus.on("flag.toggle", ({ name, on }) => {
			if (name) manager.setFlag(name, on);
		});
	}
	//#endregion
	//#region frontend/systems/cancellation.ts
	/** Owns the two app-wide cancellation triggers. Both fire `app.cancel`, which
	*  the cancellation context routes to the topmost active Cancellable. Systems
	*  that want to opt into Esc / background-click cancellation only have to
	*  register a Cancellable via `contexts.cancellation.register(...)` — they
	*  never wire their own Escape binding. */
	function registerCancellation(system) {
		system("cancellation", ({ contexts }) => {
			contexts.commands.register([{
				id: "app.cancel.escape",
				label: "Cancel current action",
				event: "app.cancel",
				group: "app",
				shortcut: "Esc",
				input: {
					on: "keydown",
					key: "Escape",
					global: true,
					prevent: true
				},
				payload: () => ({ source: "escape" })
			}, {
				id: "app.cancel.background",
				label: "Cancel on canvas background click",
				event: "app.cancel",
				group: "app",
				hidden: true,
				input: {
					on: "pointerdown",
					selector: `[data-place="${Places.Stage}"]`,
					when: isStageSurface
				},
				payload: () => ({ source: "background" })
			}]);
		}, { requires: ["input"] });
	}
	//#endregion
	//#region frontend/systems/choose.ts
	/** Proximity threshold (graph-space) for the "grow by radius" chooser. */
	var RADIUS = 240;
	function registerChoose(system) {
		system("choose", ({ on, emit, contexts, graphs, selection, flags, contribute }) => {
			const allRefs = () => contexts.hierarchy.items().map((item) => item.ref);
			const chosenNodes = () => selection.selectedAll().filter((ref) => ref.kind === "node");
			contexts.commands.register([
				{
					id: "choose.all",
					label: "Choose all",
					group: "choose",
					shortcut: "Ctrl+A",
					input: {
						on: "keydown",
						key: "a",
						ctrl: true,
						prevent: true
					},
					available: () => allRefs().length > 0
				},
				{
					id: "choose.all.cmd",
					label: "Choose all (Cmd+A)",
					event: "choose.all",
					group: "choose",
					hidden: true,
					shortcut: "Cmd+A",
					input: {
						on: "keydown",
						key: "a",
						meta: true,
						prevent: true
					},
					available: () => allRefs().length > 0
				},
				{
					id: "choose.none",
					label: "Choose none",
					group: "choose",
					available: () => selection.selectedAll().length > 0
				},
				{
					id: "choose.invert",
					label: "Invert choice",
					group: "choose",
					available: () => allRefs().length > 0,
					shortcut: "I",
					input: {
						on: "keydown",
						key: "i",
						prevent: true
					}
				},
				{
					id: "choose.follow",
					label: "Grow along edges",
					group: "choose",
					available: () => chosenNodes().length > 0
				},
				{
					id: "choose.radius",
					label: "Grow by proximity",
					group: "choose",
					available: () => chosenNodes().length > 0
				},
				{
					id: "choose.search",
					label: "Choose by search",
					group: "choose",
					form: {
						title: "Choose by search",
						submitLabel: "Choose",
						shouldOpen: () => true,
						fields: [{
							id: "q",
							label: "Label contains",
							autofocus: true
						}],
						payload: (values) => ({ q: values.q ?? "" })
					},
					available: () => allRefs().length > 0
				},
				{
					id: "selection.group",
					label: "Group into container",
					group: "choose",
					shortcut: "Ctrl+G",
					input: {
						on: "keydown",
						key: "g",
						ctrl: true,
						prevent: true
					},
					available: () => flags.isOn("containers") && selection.selectedAll().some((ref) => ref.kind === "node" || ref.kind === "container")
				}
			]);
			on("choose.all", () => emit("selection.choose", {
				refs: allRefs(),
				mode: "replace"
			}));
			on("choose.none", () => emit("selection.item.clear"));
			on("choose.invert", () => emit("selection.choose", {
				refs: allRefs().filter((ref) => !selection.has(ref)),
				mode: "replace"
			}));
			on("choose.follow", () => {
				const ids = new Set(chosenNodes().map((ref) => ref.id));
				const add = [];
				graphs.current.edges().forEach((edge) => {
					if (ids.has(edge.From)) add.push(nodeRef(edge.To));
					if (ids.has(edge.To)) add.push(nodeRef(edge.From));
				});
				if (add.length) emit("selection.choose", {
					refs: add,
					mode: "add"
				});
			});
			on("choose.radius", () => {
				const centers = selection.selectedAll().map((ref) => graphs.current.getItem(ref)?.Position).filter((p) => !!p);
				if (!centers.length) return;
				const near = graphs.current.nodes().filter((n) => n.Position && centers.some((c) => Math.hypot(n.Position.x - c.x, n.Position.y - c.y) <= RADIUS)).map((n) => nodeRef(n.id));
				if (near.length) emit("selection.choose", {
					refs: near,
					mode: "add"
				});
			});
			on("choose.search", ({ q }) => {
				const needle = q.trim().toLowerCase();
				if (!needle) return;
				emit("selection.choose", {
					refs: contexts.hierarchy.items().filter((item) => (item.label ?? "").toLowerCase().includes(needle)).map((item) => item.ref),
					mode: "replace"
				});
			});
			on("selection.group", () => {
				const members = selection.selectedAll().filter((ref) => ref.kind === "node" || ref.kind === "container");
				if (!members.length) return;
				const off = on("container.created", ({ id }) => {
					off();
					members.forEach((childRef) => emit("container.add-child", {
						containerId: id,
						childRef
					}));
				});
				emit("editing.container.create", {});
			});
			contribute({
				surface: "top",
				command: "choose.all",
				kind: "button",
				text: "All",
				order: 40,
				group: "edit"
			});
			contribute({
				surface: "top",
				command: "selection.group",
				kind: "button",
				text: "Group",
				order: 41,
				group: "edit"
			});
		}, { requires: ["ability.selectable", "graph"] });
	}
	//#endregion
	//#region frontend/systems/collections.ts
	/** Materialise the commands and toolbar buttons declared by each CollectionDef.
	*  Adding a new collection in model.ts requires zero edits in systems/ — the create
	*  command, delete command, and toolbar button all derive from the collection's
	*  declaration. */
	function registerCollections(system) {
		system("collections", (ctx) => {
			ctx.model.collections().forEach((coll) => {
				if (coll.toolbar === false) return;
				const button = {
					surface: coll.toolbar?.surface ?? "top",
					command: collectionCreateCommand(coll),
					kind: "button",
					text: coll.toolbar?.text ?? `+ ${coll.entity?.label ?? coll.kind}`,
					order: coll.toolbar?.order,
					group: coll.kind === "graph" ? void 0 : "edit"
				};
				ctx.contribute(button);
			});
		}, { requires: ["graph"] });
	}
	//#endregion
	//#region frontend/systems/command-modal.ts
	var PLACEHOLDER = "Search commands & nodes";
	var ALT_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
	/** The palette is the single command+search surface (⌘K / `?`). Navigate with
	*  arrow keys (Enter runs the highlighted row); each search result also gets an
	*  `Alt+<key>` accelerator, where <key> is the first character (unique across
	*  results) that follows the typed query in the result's label — so typing
	*  "kaf" turns "kafka" into Alt+K and "kafkian" into Alt+I. */
	function registerCommandModal(system) {
		system("commandModal", (ctx) => {
			const { on, emit, contexts, contribute } = ctx;
			contribute({
				surface: "top",
				command: "help.open",
				kind: "button",
				text: "?",
				label: "Help",
				slot: Slots.End,
				order: 99
			});
			contribute({
				surface: "top",
				command: "palette.open",
				kind: "button",
				text: "🔍",
				label: "Search (P)",
				slot: Slots.End,
				order: 100
			});
			let query = "";
			let selected = 0;
			let currentRows = [];
			let altOfRow = /* @__PURE__ */ new Map();
			let rowOfAlt = /* @__PURE__ */ new Map();
			const modalEl = () => contexts.places.el(Places.Modal);
			const activePalette = () => !!modalEl()?.querySelector("[data-command-modal=\"palette\"]");
			const visibleCommands = (q = "") => {
				const needle = q.trim().toLowerCase();
				return contexts.commands.all().filter((command) => !command.hidden).filter((command) => !!needle || command.available?.() !== false).filter((command) => !needle || `${command.id} ${command.label} ${command.group ?? ""} ${shortcutOf(command)}`.toLowerCase().includes(needle));
			};
			const TARGET_GROUPS = new Set([
				"item",
				"selection",
				"choose",
				"editing",
				"edge",
				"container"
			]);
			const groupRank = (group) => TARGET_GROUPS.has(group) === ctx.selection.selectedAll().length > 0 ? 0 : 1;
			const orderedCommands = (q = "") => {
				const ordered = [];
				[...grouped(visibleCommands(q), (command) => command.group ?? systemOf(command.id))].sort((a, b) => groupRank(a[0]) - groupRank(b[0])).forEach(([, commands]) => ordered.push(...commands));
				return ordered;
			};
			const itemResults = (q) => {
				const needle = q.trim().toLowerCase();
				if (!needle) return [];
				return contexts.hierarchy.targets().filter((item) => item.label.toLowerCase().includes(needle)).slice(0, 8);
			};
			const buildRows = (q) => {
				const rows = [];
				itemResults(q).forEach((item) => rows.push({
					kind: "goto",
					ref: item.ref,
					label: item.label,
					group: "go to",
					shortcut: ""
				}));
				orderedCommands(q).forEach((command) => rows.push({
					kind: "command",
					id: command.id,
					label: command.label,
					group: command.group ?? systemOf(command.id),
					shortcut: shortcutOf(command)
				}));
				return rows;
			};
			const assignAlt = (rows, q) => {
				altOfRow = /* @__PURE__ */ new Map();
				rowOfAlt = /* @__PURE__ */ new Map();
				const needle = q.trim().toLowerCase();
				if (!needle) return;
				const used = /* @__PURE__ */ new Set();
				rows.forEach((row, i) => {
					const label = row.label.toLowerCase();
					const at = label.indexOf(needle);
					const start = at >= 0 ? at + needle.length : 0;
					const seq = label.slice(start) + label.slice(0, start);
					for (const ch of seq) {
						if (!ALT_CHARS.includes(ch) || used.has(ch)) continue;
						used.add(ch);
						altOfRow.set(i, ch);
						rowOfAlt.set(ch, i);
						break;
					}
				});
			};
			const rowEl = (row, index) => {
				const el = contexts.templates.clone("command-row");
				el.dataset.index = String(index);
				if (index === selected) el.classList.add("is-selected");
				if (row.kind === "command") {
					el.dataset.command = "commandModal.run";
					el.dataset.commandId = row.id;
					contexts.templates.text(el, "id", row.id);
				} else {
					el.dataset.command = "palette.goto";
					el.dataset.gotoKind = row.ref.kind;
					el.dataset.gotoId = row.ref.id;
					contexts.templates.text(el, "id", row.ref.kind);
				}
				contexts.templates.text(el, "label", row.label);
				const alt = altOfRow.get(index);
				const chip = [alt ? `⌥${alt.toUpperCase()}` : "", row.shortcut].filter(Boolean).join(" · ");
				if (chip) contexts.templates.text(el, "shortcut", chip);
				else el.querySelector("kbd")?.remove();
				return el;
			};
			const renderList = (q = "") => {
				currentRows = buildRows(q);
				assignAlt(currentRows, q);
				if (selected >= currentRows.length) selected = Math.max(0, currentRows.length - 1);
				const fragment = document.createDocumentFragment();
				let index = 0;
				const sections = /* @__PURE__ */ new Map();
				const rowsSlotFor = (group) => {
					let section = sections.get(group);
					if (!section) {
						section = contexts.templates.clone("command-section");
						contexts.templates.text(section, "group", group);
						sections.set(group, section);
						fragment.append(section);
					}
					return contexts.templates.slot(section, "rows");
				};
				currentRows.forEach((row) => rowsSlotFor(row.group).append(rowEl(row, index++)));
				return fragment;
			};
			const renderPalette = () => {
				const palette = contexts.templates.clone("palette");
				palette.dataset.commandModal = "palette";
				const input = palette.querySelector(".palette-search");
				if (input instanceof HTMLInputElement) input.placeholder = PLACEHOLDER;
				contexts.templates.slot(palette, "commands").append(renderList());
				return palette;
			};
			const renderHelp = () => {
				const fragment = document.createDocumentFragment();
				contexts.commands.all().filter((command) => !command.hidden).sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label)).forEach((command) => {
					const row = contexts.templates.clone("help-row");
					contexts.templates.text(row, "label", command.label);
					contexts.templates.text(row, "id", command.id);
					const input = row.querySelector(".shortcut-edit");
					if (input) {
						input.value = shortcutOf(command);
						input.dataset.shortcutCommand = command.id;
					}
					fragment.append(row);
				});
				return fragment;
			};
			const rerender = () => {
				const list = modalEl()?.querySelector("[data-command-modal=\"palette\"] [data-slot=\"commands\"]");
				if (!list) return;
				list.replaceChildren(renderList(query));
				list.querySelector(".is-selected")?.scrollIntoView?.({ block: "nearest" });
			};
			const runRow = (row) => {
				if (!row) return;
				emit("modal.close");
				if (row.kind === "command") {
					if (contexts.commands.get(row.id)) contexts.commands.run(row.id, { origin: "palette" });
				} else {
					emit("selection.item.select", row.ref);
					emit("view.fit.item", row.ref);
				}
			};
			contexts.commands.register([
				{
					id: "palette.open",
					label: "Open palette",
					group: "modal",
					shortcut: "P",
					input: {
						on: "keydown",
						key: "p",
						prevent: true
					}
				},
				{
					id: "help.open",
					label: "Open help",
					group: "modal",
					shortcut: "?"
				},
				{
					id: "palette.open.alt",
					label: "Open palette (?)",
					event: "palette.open",
					group: "modal",
					hidden: true,
					shortcut: "?",
					input: {
						on: "keydown",
						key: "?",
						prevent: true
					}
				},
				{
					id: "palette.nav.down",
					label: "Palette: next row",
					event: "palette.nav",
					group: "modal",
					hidden: true,
					input: {
						on: "keydown",
						key: "ArrowDown",
						global: true,
						prevent: true,
						stop: true,
						when: activePalette
					},
					payload: () => ({ delta: 1 })
				},
				{
					id: "palette.nav.up",
					label: "Palette: previous row",
					event: "palette.nav",
					group: "modal",
					hidden: true,
					input: {
						on: "keydown",
						key: "ArrowUp",
						global: true,
						prevent: true,
						stop: true,
						when: activePalette
					},
					payload: () => ({ delta: -1 })
				},
				{
					id: "palette.activate",
					label: "Palette: run highlighted",
					group: "modal",
					hidden: true,
					input: {
						on: "keydown",
						key: "Enter",
						global: true,
						prevent: true,
						stop: true,
						when: activePalette
					}
				},
				...ALT_CHARS.map((char) => ({
					id: `palette.alt.${char}`,
					label: `Palette: Alt+${char}`,
					event: "palette.alt",
					group: "modal",
					hidden: true,
					input: {
						on: "keydown",
						key: char,
						alt: true,
						global: true,
						prevent: true,
						stop: true,
						when: activePalette
					},
					payload: () => ({ char })
				})),
				{
					id: "commandModal.run",
					label: "Run command modal item",
					group: "modal",
					hidden: true,
					payload: ({ target }) => ({ commandId: target?.closest("[data-command-id]")?.getAttribute("data-command-id") ?? "" })
				},
				{
					id: "palette.goto",
					label: "Go to item",
					group: "modal",
					hidden: true,
					payload: ({ target }) => {
						const el = target?.closest("[data-goto-id]") ?? null;
						return el ? {
							kind: el.getAttribute("data-goto-kind"),
							id: el.getAttribute("data-goto-id")
						} : void 0;
					}
				},
				{
					id: "commandModal.search.change",
					label: "Search command modal",
					event: "commandModal.search.changed",
					group: "modal",
					hidden: true,
					input: {
						on: "input",
						selector: ".palette-search"
					},
					payload: ({ target }) => ({ query: target.value })
				},
				{
					id: "shortcut.edit.preview",
					label: "Preview shortcut edit",
					group: "modal",
					hidden: true,
					input: {
						on: "input",
						selector: ".shortcut-edit"
					},
					payload: ({ target }) => ({
						id: target.dataset.shortcutCommand ?? "",
						shortcut: target.value
					})
				},
				{
					id: "shortcut.edit.commit",
					label: "Commit shortcut edit",
					group: "modal",
					hidden: true,
					input: {
						on: "focusout",
						selector: ".shortcut-edit"
					},
					payload: ({ target }) => ({
						id: target.dataset.shortcutCommand ?? "",
						shortcut: target.value
					})
				}
			]);
			const open = () => emit("modal.open", {
				title: "Palette",
				visual: "command",
				body: () => renderPalette()
			});
			on("palette.open", () => {
				query = "";
				selected = 0;
				open();
			});
			on("help.open", () => emit("modal.open", {
				title: "Help",
				visual: "command",
				body: () => renderHelp()
			}));
			on("palette.nav", ({ delta }) => {
				if (!currentRows.length) return;
				selected = (selected + delta + currentRows.length) % currentRows.length;
				rerender();
			});
			on("palette.activate", () => runRow(currentRows[selected]));
			on("palette.alt", ({ char }) => {
				const index = rowOfAlt.get(char);
				if (index != null) runRow(currentRows[index]);
			});
			on("commandModal.run", ({ commandId }) => {
				if (!contexts.commands.get(commandId)) return;
				emit("modal.close");
				contexts.commands.run(commandId, { origin: "palette" });
			});
			on("palette.goto", (ref) => {
				if (!ref?.id) return;
				emit("modal.close");
				emit("selection.item.select", ref);
				emit("view.fit.item", ref);
			});
			on("commandModal.search.changed", ({ query: q }) => {
				query = q;
				selected = 0;
				rerender();
			});
			const shortcutInput = (id) => modalEl()?.querySelector(`.shortcut-edit[data-shortcut-command="${CSS.escape(id)}"]`);
			const markShortcutConflict = (id, shortcut) => {
				const input = shortcutInput(id);
				if (!input) return false;
				const conflict = !!contexts.commands.shortcutConflict(id, shortcut ?? input.value);
				input.classList.toggle("is-conflict", conflict);
				input.closest(".help-row")?.classList.toggle("has-conflict", conflict);
				return conflict;
			};
			on("shortcut.edit.preview", ({ id, shortcut }) => {
				if (!contexts.commands.get(id)) return;
				markShortcutConflict(id, shortcut);
			});
			on("shortcut.edit.commit", ({ id, shortcut }) => {
				const command = contexts.commands.get(id);
				if (!command) return;
				if (markShortcutConflict(id, shortcut)) {
					const input = shortcutInput(id);
					if (input) input.value = shortcutOf(command);
					return;
				}
				contexts.commands.setShortcut(id, shortcut ?? "");
				const input = shortcutInput(id);
				if (input) input.value = shortcutOf(command);
			});
		}, { requires: ["modal"] });
	}
	//#endregion
	//#region frontend/systems/command-form.ts
	var fieldId = (commandId, field) => `form-${commandId.replace(/[^a-z0-9_-]/gi, "-")}-${field.id}`;
	function registerCommandForm(system) {
		system("commandForm", ({ on, emit, forward, contexts }) => {
			const collectValues = (root) => {
				const values = {};
				root.querySelectorAll("[data-form-field]").forEach((input) => {
					values[input.dataset.formField] = input.value.trim();
				});
				return values;
			};
			const errorEl = (root) => root.querySelector("[data-form-error]");
			const showError = (root, message = "") => {
				const el = root ? errorEl(root) : null;
				if (el) el.textContent = message;
			};
			const formField = (commandId, field, value = "") => {
				const label = document.createElement("label");
				const input = document.createElement("input");
				input.dataset.formField = field.id;
				input.name = field.id;
				input.value = value;
				input.required = field.required !== false;
				input.placeholder = field.placeholder ?? "";
				if (field.autofocus) input.autofocus = true;
				label.append(field.label, input);
				const options = field.options?.() ?? [];
				if (!options.length) return label;
				const list = document.createElement("datalist");
				list.id = fieldId(commandId, field);
				options.forEach((option) => {
					const item = document.createElement("option");
					item.value = option.value;
					item.label = option.label;
					list.append(item);
				});
				input.setAttribute("list", list.id);
				label.append(list);
				return label;
			};
			const renderForm = (commandId, seed, initialError = "") => {
				const command = contexts.commands.get(commandId);
				const form = command?.form;
				if (!command || !form) return document.createDocumentFragment();
				const root = document.createElement("section");
				root.className = "command-form properties";
				root.dataset.commandForm = commandId;
				const fields = document.createElement("div");
				fields.dataset.slot = "fields";
				form.fields.forEach((field) => fields.append(formField(commandId, field, seed[field.id] ?? "")));
				const error = document.createElement("div");
				error.className = "form-error";
				error.dataset.formError = "";
				error.textContent = initialError;
				const actions = document.createElement("div");
				actions.className = "form-actions";
				const submit = document.createElement("button");
				submit.type = "button";
				submit.className = "primary";
				submit.dataset.command = "commandForm.submit";
				submit.textContent = form.submitLabel ?? "Apply";
				actions.append(submit);
				root.append(fields, error, actions);
				return root;
			};
			contexts.commands.register([{
				id: "commandForm.submit",
				label: "Submit command form",
				group: "modal",
				hidden: true,
				input: {
					on: "keydown",
					key: "Enter",
					selector: ".command-form input",
					prevent: true,
					stop: true
				},
				payload: ({ target }) => {
					const root = target?.closest("[data-command-form]");
					return {
						commandId: root?.dataset.commandForm ?? "",
						values: root ? collectValues(root) : {}
					};
				}
			}]);
			on("commandForm.open", ({ commandId, seed = {} }) => {
				const command = contexts.commands.get(commandId);
				if (!command?.form) return;
				const initialError = command.form.validate?.(seed, {}) ?? "";
				emit("modal.open", {
					title: command.form.title ?? command.label,
					visual: "properties",
					body: () => renderForm(commandId, seed, initialError)
				});
				if (initialError) emit("app.notice", {
					message: initialError,
					level: "warn"
				});
			});
			on("commandForm.submit", ({ commandId, values }) => {
				const command = contexts.commands.get(commandId);
				const form = command?.form;
				const root = contexts.places.el(Places.Modal)?.querySelector(`[data-command-form="${commandId}"]`);
				if (!command || !form) return;
				const error = form.validate?.(values, {});
				if (error) {
					showError(root, error);
					emit("app.notice", {
						message: error,
						level: "warn"
					});
					return;
				}
				const payload = form.payload(values, {});
				if (payload == null) {
					const message = "Fill the required fields.";
					showError(root, message);
					emit("app.notice", {
						message,
						level: "warn"
					});
					return;
				}
				forward(command.event, payload);
				emit("modal.close");
			});
		}, { requires: ["modal"] });
	}
	//#endregion
	//#region frontend/systems/command-picker.ts
	/** Letter pool. Order matches a US keyboard home-row reach, so the first few
	*  letters are the easiest to hit (matches jump.ts on purpose). */
	var LETTERS$1 = "asdfghjklqwertyuiopzxcvbnm";
	/** Driver for CommandSpec.picker. Walks each PickerStep in order:
	*
	*    seed → if it returns a ref, fill and advance (one-keystroke fast paths)
	*    otherwise → letter overlays for filtered refs + keyboard.capture
	*
	*  On the final step the picked values are run through `validate`, packed by
	*  `payload`, and forwarded to the command's event. The whole thing lives
	*  next to commandForm so any single-file system can opt into either UI by
	*  declaring `form` or `picker` on its CommandSpec — no system-level glue. */
	function registerCommandPicker(system) {
		system("commandPicker", ({ on, emit, forward, contexts, origin }) => {
			let active = null;
			const clearStageOverlay = () => {
				contexts.decorations.unregisterOrigin("commandPicker");
				contexts.keyboard.unregisterOrigin("commandPicker");
				emit("render.view.clear", {
					place: Places.Stage,
					key: "picker-prompt"
				});
			};
			const cancel = () => {
				if (!active) return;
				active = null;
				clearStageOverlay();
			};
			const finish = () => {
				if (!active) return;
				const a = active;
				active = null;
				clearStageOverlay();
				const error = a.picker.validate?.(a.values, a.source);
				if (error) {
					emit("app.notice", {
						message: error,
						level: "warn"
					});
					return;
				}
				const payload = a.picker.payload(a.values, a.source);
				if (payload == null) return;
				emit("commandPicker.submit", {
					commandId: a.commandId,
					values: a.values
				});
				forward(a.command.event, payload);
			};
			const promptBanner = (step, index, total) => {
				const el = document.createElement("div");
				el.className = "picker-prompt";
				const title = document.createElement("strong");
				title.textContent = step.prompt ?? `Pick ${step.id}`;
				const meta = document.createElement("span");
				meta.textContent = total > 1 ? ` (${index + 1}/${total})` : "";
				const hint = document.createElement("em");
				hint.textContent = " · Esc to cancel";
				el.append(title, meta, hint);
				return el;
			};
			const runStep = () => {
				if (!active) return;
				const step = active.picker.steps[active.stepIndex];
				if (!step) {
					finish();
					return;
				}
				const seed = step.seed?.(active.values, active.source);
				if (seed) {
					active.values[step.id] = seed;
					active.stepIndex++;
					runStep();
					return;
				}
				const filterFn = step.filter?.(active.values, active.source) ?? (() => true);
				const targets = contexts.hierarchy.items().filter((target) => filterFn(target.ref)).slice(0, 26);
				if (!targets.length) {
					emit("app.notice", {
						message: `Nothing to pick for ${step.prompt ?? step.id}`,
						level: "warn"
					});
					cancel();
					return;
				}
				const letterMap = /* @__PURE__ */ new Map();
				const overlays = targets.map((target, i) => {
					const letter = LETTERS$1[i];
					letterMap.set(letter, target.ref);
					return {
						ref: target.ref,
						text: letter.toUpperCase(),
						className: "picker-letter",
						id: `picker-${letter}`
					};
				});
				contexts.decorations.overlays.set("commandPicker", overlays);
				emit("render.view.set", {
					place: Places.Stage,
					key: "picker-prompt",
					view: () => promptBanner(step, active.stepIndex, active.picker.steps.length)
				});
				contexts.keyboard.capture("commandPicker", { onKey(event) {
					if (event.key === "Escape") return;
					const letter = event.key.toLowerCase();
					if (!/^[a-z]$/.test(letter)) return;
					event.preventDefault();
					const ref = letterMap.get(letter);
					if (!ref || !active) {
						emit("commandPicker.cancel");
						return;
					}
					active.values[step.id] = ref;
					active.stepIndex++;
					emit("commandPicker.step", {
						commandId: active.commandId,
						step: step.id,
						ref
					});
					contexts.keyboard.unregisterOrigin("commandPicker");
					contexts.decorations.unregisterOrigin("commandPicker");
					runStep();
				} });
			};
			on("commandPicker.open", ({ commandId, source }) => {
				const command = contexts.commands.get(commandId);
				if (!command?.picker) return;
				const pickerSource = source ?? { origin: "keyboard" };
				cancel();
				active = {
					commandId,
					command,
					picker: command.picker,
					source: pickerSource,
					values: {},
					stepIndex: 0
				};
				runStep();
			});
			on("commandPicker.cancel", cancel);
			contexts.cancellation.register({
				origin,
				active: () => !!active,
				cancel: () => emit("commandPicker.cancel")
			});
			return cancel;
		}, { requires: ["render.stage", "graph"] });
	}
	//#endregion
	//#region frontend/systems/containers.ts
	var DEFAULT_SIZE = {
		w: 320,
		h: 200
	};
	/** Compact size used when collapsed — just enough room for the label badge. */
	var COLLAPSED_SIZE = {
		w: 140,
		h: 36
	};
	var PADDING = 24;
	var LABEL_BAND = 18;
	var parseSections = (value, existing = []) => String(value).split(/\r?\n/).map((title) => title.trim()).filter(Boolean).map((title, index) => ({
		id: existing[index]?.id ?? `s${index + 1}`,
		title,
		weight: existing[index]?.weight ?? 1
	}));
	var validAxis = (value) => value === "rows" || value === "columns";
	var firstSectionId = (c) => c.Sections?.[0]?.id;
	var sanitizeSections = (c) => {
		c.Sections = c.Sections?.map((section, index) => ({
			id: section.id || `s${index + 1}`,
			title: section.title || `Section ${index + 1}`,
			weight: Math.max(.15, Number(section.weight) || 1)
		})) ?? [];
		c.SectionAxis = c.SectionAxis ?? "rows";
		const valid = new Set(c.Sections.map((section) => section.id));
		const refKeys = new Set(c.Children.map(refKey));
		const fallback = firstSectionId(c);
		const next = {};
		Object.entries(c.ChildSections ?? {}).forEach(([key, sectionId]) => {
			if (!refKeys.has(key)) return;
			if (valid.has(sectionId)) next[key] = sectionId;
			else if (fallback) next[key] = fallback;
		});
		c.Children.forEach((child) => {
			const key = refKey(child);
			if (fallback && !next[key]) next[key] = fallback;
		});
		c.ChildSections = next;
	};
	function registerContainers(system) {
		system("containers", (ctx) => {
			const { on, emit, contexts, graphs, selection, contribute, origin } = ctx;
			let next = 1;
			const states = /* @__PURE__ */ new Map();
			const ensureState = (gid) => {
				const existing = states.get(gid);
				if (existing) return existing;
				const containers = /* @__PURE__ */ new Map();
				const state = {
					containers,
					nest: createNesting({
						parents: containers,
						parentKind: "container",
						onChange: (id) => emit("container.children.changed", { id })
					}),
					storeOff: (graphs.get(gid) ?? graphs.current).registerItemStore("container", () => [...containers.values()])
				};
				states.set(gid, state);
				return state;
			};
			const stateOf = () => ensureState(graphs.current.id);
			const containersHere = () => stateOf().containers;
			const nestHere = () => stateOf().nest;
			let sectionTitleEdit = null;
			let sectionResize = null;
			const containerOfChild = (childRef) => {
				const parent = nestHere().parentRefOf(childRef);
				return parent?.kind === "container" ? containersHere().get(parent.id) ?? null : null;
			};
			const assignChildSection = (c, childRef, sectionId) => {
				sanitizeSections(c);
				if (!c.Sections?.length) return false;
				const valid = new Set(c.Sections.map((section) => section.id));
				const next = sectionId && valid.has(sectionId) ? sectionId : firstSectionId(c);
				if (!next) return false;
				const key = refKey(childRef);
				const before = c.ChildSections?.[key];
				c.ChildSections = {
					...c.ChildSections ?? {},
					[key]: next
				};
				return before !== next;
			};
			const removeChildSection = (childRef, parentId) => {
				(parentId ? [containersHere().get(parentId)] : [...containersHere().values()]).forEach((c) => {
					if (!c?.ChildSections) return;
					delete c.ChildSections[refKey(childRef)];
				});
			};
			const sectionTitleTarget = (target) => {
				const el = target?.closest("[data-container-section-title]");
				const containerId = el?.dataset.containerId ?? "";
				const sectionId = el?.dataset.sectionId ?? "";
				return el && containerId && sectionId ? {
					el,
					containerId,
					sectionId
				} : null;
			};
			const enterSectionTitleEdit = (el) => {
				el.contentEditable = "plaintext-only";
				el.classList.add("editing");
				el.focus();
				const range = document.createRange();
				range.selectNodeContents(el);
				const sel = getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			};
			const exitSectionTitleEdit = (el) => {
				el.contentEditable = "inherit";
				el.classList.remove("editing");
			};
			on("graph.switched", () => {
				ensureState(graphs.current.id);
			});
			on("graph.deleted", ({ id }) => {
				const s = states.get(id);
				if (!s) return;
				s.storeOff();
				states.delete(id);
			});
			contexts.hierarchy.parents.register(origin, { parentRefOf: (ref) => stateOf().nest.parentRefOf(ref) });
			contexts.hierarchy.sources.register(origin, () => [...containersHere().values()].map((c) => {
				const rect = visualRect(c);
				return {
					ref: {
						kind: "container",
						id: c.id
					},
					label: c.Label.text || c.id,
					anchor: {
						x: rect.x + rect.w / 2,
						y: rect.y + rect.h / 2
					}
				};
			}));
			const childBounds = (ref) => {
				if (ref.kind === "container") return visualRect(containersHere().get(ref.id) ?? null);
				return boundsOf(graphs.current.getItem(ref) ?? {}, {
					w: 80,
					h: 40
				});
			};
			/** Is this container folded? Collapse is fold state (the `fold` store),
			*  not container data — same concept as outline/panel/zen folding. */
			const folded = (c) => contexts.fold.folded(itemFoldId({
				kind: "container",
				id: c.id
			}, graphs.current.id));
			/** The expanded rect (children union + padding, or a default/manual box).
			*  Independent of fold state, so the folded badge can center on it. */
			const expandedRect = (c) => {
				if (c.AutoFit === false || c.Sections?.length) return boundsOf(c);
				const kids = c.Children.map(childBounds).filter((r) => !!r);
				if (!kids.length) return boundsOf({
					Position: c.Position,
					Size: DEFAULT_SIZE
				});
				return expandRect(kids.reduce(unionRect), PADDING, LABEL_BAND);
			};
			const visualRect = (c) => {
				if (!c) return boundsOf({
					Position: {
						x: 0,
						y: 0
					},
					Size: DEFAULT_SIZE
				});
				if (folded(c)) return boundsOf({
					Position: rectCenter(expandedRect(c)),
					Size: COLLAPSED_SIZE
				});
				return expandedRect(c);
			};
			const render = {
				layer: "html",
				bounds: visualRect,
				draw(c, r) {
					const rect = visualRect(c);
					const el = document.createElement("div");
					el.className = "container";
					if (folded(c)) el.classList.add("collapsed");
					if (c.AutoFit === false) el.classList.add("manual");
					el.dataset.sectionAxis = c.SectionAxis ?? "rows";
					el.style.left = `${rect.x + rect.w / 2}px`;
					el.style.top = `${rect.y + rect.h / 2}px`;
					el.style.width = `${rect.w}px`;
					el.style.height = `${rect.h}px`;
					const ref = r.refOf(c.id);
					r.tagItem(el, ref);
					r.applyItemModes(el, ref);
					if (!folded(c) && c.Sections?.length) {
						el.classList.add("has-sections");
						const sections = document.createElement("div");
						sections.className = "container-sections";
						sections.dataset.axis = c.SectionAxis ?? "rows";
						c.Sections.forEach((section, index) => {
							const band = document.createElement("div");
							band.className = "container-section";
							band.dataset.sectionId = section.id;
							band.style.flexGrow = `${Math.max(.15, section.weight ?? 1)}`;
							const title = document.createElement("span");
							title.dataset.containerSectionTitle = "";
							title.dataset.containerId = c.id;
							title.dataset.sectionId = section.id;
							title.tabIndex = 0;
							title.textContent = section.title;
							band.append(title);
							sections.append(band);
							if (index < (c.Sections?.length ?? 0) - 1) {
								const divider = document.createElement("button");
								divider.type = "button";
								divider.className = "container-section-divider";
								divider.dataset.containerSectionResize = "";
								divider.dataset.containerId = c.id;
								divider.dataset.sectionIndex = `${index}`;
								divider.setAttribute("aria-label", "Resize container sections");
								sections.append(divider);
							}
						});
						el.append(sections);
					}
					const label = document.createElement("div");
					label.className = "container-label";
					label.dataset.editableTitle = "";
					label.textContent = c.Label.text;
					const handle = document.createElement("div");
					handle.className = "container-resize";
					handle.dataset.slot = Slots.Resize;
					el.append(label, handle);
					r.wireAffordances(el);
					return el;
				}
			};
			const entity = {
				kind: "container",
				label: "Container",
				labelOf: (c) => c.Label.text || c.id,
				order: -10,
				abilities: [
					selectable(),
					draggable(),
					nudgeable(),
					editable(),
					collapsible(),
					configurable(),
					resizeable()
				],
				properties: [
					{
						id: "title",
						label: "Title",
						input: "text",
						value: (c) => c.Label.text,
						patch: (_c, v) => ({ Label: { text: String(v) } })
					},
					{
						id: "width",
						label: "Width",
						input: "number",
						min: 120,
						step: 8,
						value: (c) => c.Size.w,
						patch: (c, v) => Number.isFinite(Number(v)) ? { Size: {
							...c.Size,
							w: Math.max(120, Number(v))
						} } : void 0
					},
					{
						id: "height",
						label: "Height",
						input: "number",
						min: 80,
						step: 8,
						value: (c) => c.Size.h,
						patch: (c, v) => Number.isFinite(Number(v)) ? { Size: {
							...c.Size,
							h: Math.max(80, Number(v))
						} } : void 0
					},
					{
						id: "sectionAxis",
						label: "Section axis",
						input: "select",
						group: "Structure",
						options: [{
							value: "rows",
							label: "Rows"
						}, {
							value: "columns",
							label: "Columns"
						}],
						value: (c) => c.SectionAxis ?? "rows",
						patch: (_c, v) => validAxis(v) ? { SectionAxis: v } : void 0
					},
					{
						id: "sections",
						label: "Sections",
						input: "textarea",
						rows: 4,
						group: "Structure",
						value: (c) => c.Sections?.map((s) => s.title).join("\n") ?? "",
						patch: (c, v) => ({ Sections: parseSections(v, c.Sections) })
					}
				],
				render
			};
			const offEntity = ctx.model.registerEntity(entity);
			const offCollection = ctx.model.registerCollection({
				id: "containers",
				label: "Containers",
				kind: "container",
				items: () => [...containersHere().values()],
				toolbar: false,
				section: false
			});
			contexts.commands.register([
				{
					id: "editing.container.create",
					label: "Create container",
					group: "container",
					shortcut: "Y",
					input: {
						on: "keydown",
						key: "y",
						prevent: true
					},
					payload: () => ({
						Label: { text: `Container ${containersHere().size + 1}` },
						at: contexts.view.spaceCenter(Places.Stage)
					})
				},
				{
					id: "graph.container.delete",
					label: "Delete container",
					group: "container",
					available: (source) => {
						const fromDom = !!source?.target?.closest("[data-item-kind=\"container\"]") && !!itemIdFrom(source?.target);
						const ref = selection.selected();
						return fromDom || ref?.kind === "container";
					},
					payload: (source) => {
						const fromDom = source.target?.closest("[data-item-kind=\"container\"]")?.getAttribute("data-item-id");
						if (fromDom) return { id: fromDom };
						const ref = selection.selected();
						return ref?.kind === "container" ? { id: ref.id } : void 0;
					}
				},
				{
					id: "container.add-child",
					label: "Move into container",
					group: "container",
					shortcut: "M",
					input: {
						on: "keydown",
						key: "m",
						prevent: true
					},
					picker: {
						title: "Move into container",
						steps: [{
							id: "child",
							prompt: "Pick a node or container to move",
							filter: () => (ref) => ref.kind === "node" || ref.kind === "container",
							seed: () => {
								const r = selection.selected();
								return r && (r.kind === "node" || r.kind === "container") ? r : null;
							}
						}, {
							id: "container",
							prompt: "Pick a container",
							filter: (vs) => (ref) => ref.kind === "container" && !!vs.child && !nestHere().isAncestorOrSelf(vs.child, ref)
						}],
						validate: (vs) => !containersHere().size ? "Create a container first (Y)." : !vs.child || !vs.container ? "Pick an item and a container." : void 0,
						payload: (vs) => ({
							containerId: vs.container.id,
							childRef: vs.child
						})
					}
				},
				{
					id: "container.remove-child",
					label: "Remove from container",
					group: "container",
					available: () => {
						const r = selection.selected();
						return !!r && !!nestHere().parentRefOf(r);
					},
					payload: () => {
						const r = selection.selected();
						return r ? { childRef: r } : void 0;
					}
				},
				{
					id: "container.child.section.set",
					label: "Move item to container section",
					group: "container",
					hidden: true,
					payload: (source) => {
						const target = source.target;
						const childKind = target?.dataset.childKind;
						const childId = target?.dataset.childId;
						const childRef = childKind && childId ? {
							kind: childKind,
							id: childId
						} : selection.selected() ?? void 0;
						return {
							containerId: target?.dataset.containerId,
							childRef,
							sectionId: target?.dataset.sectionId
						};
					}
				},
				{
					id: "container.child.section.next",
					label: "Move to next section",
					event: "container.child.section.set",
					group: "container",
					available: () => {
						const ref = selection.selected();
						return ((ref ? containerOfChild(ref) : null)?.Sections?.length ?? 0) > 1;
					},
					payload: () => {
						const childRef = selection.selected() ?? void 0;
						const c = childRef ? containerOfChild(childRef) : null;
						if (!childRef || !c?.Sections?.length) return void 0;
						const current = c.ChildSections?.[refKey(childRef)] ?? firstSectionId(c);
						const index = Math.max(0, c.Sections.findIndex((section) => section.id === current));
						return {
							containerId: c.id,
							childRef,
							sectionId: c.Sections[(index + 1) % c.Sections.length].id
						};
					}
				},
				{
					id: "container.section.title.edit.dblclick",
					label: "Edit section title",
					event: "container.section.title.edit",
					group: "container",
					hidden: true,
					input: {
						on: "dblclick",
						selector: "[data-container-section-title]",
						prevent: true,
						stop: true
					},
					payload: ({ target }) => {
						const hit = sectionTitleTarget(target);
						return hit ? {
							containerId: hit.containerId,
							sectionId: hit.sectionId
						} : void 0;
					}
				},
				{
					id: "container.section.title.commit.enter",
					label: "Commit section title",
					event: "container.section.title.commit",
					group: "container",
					hidden: true,
					input: {
						on: "keydown",
						key: "Enter",
						selector: "[data-container-section-title].editing",
						prevent: true,
						stop: true
					},
					payload: ({ target }) => {
						const hit = sectionTitleTarget(target);
						return hit ? {
							containerId: hit.containerId,
							sectionId: hit.sectionId,
							title: hit.el.textContent?.trim() ?? "",
							finish: true
						} : void 0;
					}
				},
				{
					id: "container.section.title.commit.focusout",
					label: "Commit section title on blur",
					event: "container.section.title.commit",
					group: "container",
					hidden: true,
					input: {
						on: "focusout",
						selector: "[data-container-section-title].editing"
					},
					payload: ({ target }) => {
						const hit = sectionTitleTarget(target);
						return hit ? {
							containerId: hit.containerId,
							sectionId: hit.sectionId,
							title: hit.el.textContent?.trim() ?? ""
						} : void 0;
					}
				},
				{
					id: "container.section.resize.start",
					label: "Start section resize",
					group: "container",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: "[data-container-section-resize]",
						prevent: true,
						stop: true
					},
					payload: ({ event, target }) => ({
						containerId: target.dataset.containerId ?? "",
						index: Number(target.dataset.sectionIndex ?? 0),
						x: event.clientX,
						y: event.clientY
					})
				},
				{
					id: "container.section.resize.move",
					label: "Resize sections",
					group: "container",
					hidden: true,
					input: {
						on: "pointermove",
						when: () => !!sectionResize,
						prevent: true,
						stop: true
					},
					payload: ({ event }) => ({
						x: event.clientX,
						y: event.clientY
					})
				},
				{
					id: "container.section.resize.end",
					label: "End section resize",
					group: "container",
					hidden: true,
					input: {
						on: "pointerup",
						when: () => !!sectionResize,
						stop: true
					}
				}
			]);
			on("editing.container.create", (draft) => {
				const id = `c${next++}`;
				containersHere().set(id, {
					id,
					kind: "container",
					Label: draft.Label ?? { text: id },
					Position: draft.at ?? {
						x: 0,
						y: 0
					},
					Size: { ...DEFAULT_SIZE },
					Sections: [],
					SectionAxis: "rows",
					ChildSections: {},
					Children: []
				});
				emit("container.created", { id });
				emit("selection.item.select", {
					kind: "container",
					id
				});
			});
			on("container.import.snapshot", ({ containers }) => {
				const here = containersHere();
				const nest = nestHere();
				[...here.values()].forEach((c) => c.Children.forEach((child) => nest.remove(child)));
				here.clear();
				containers.forEach((input) => {
					here.set(input.id, {
						id: input.id,
						kind: "container",
						Label: { text: input.label },
						Position: {
							x: 0,
							y: 0
						},
						Size: { ...DEFAULT_SIZE },
						AutoFit: true,
						Sections: [],
						SectionAxis: "rows",
						ChildSections: {},
						Children: []
					});
					input.children.forEach((id) => nest.add(input.id, {
						kind: "node",
						id
					}));
					emit("container.created", { id: input.id });
				});
				emit("selection.item.clear");
			});
			on("graph.container.delete", ({ id }) => {
				const here = containersHere();
				const nest = nestHere();
				const c = here.get(id);
				if (!c) return;
				[...c.Children].forEach((childRef) => {
					if (childRef.kind === "container") emit("graph.container.delete", { id: childRef.id });
					else if (childRef.kind === "node") emit("graph.node.delete", { id: childRef.id });
					else nest.remove(childRef);
				});
				nest.remove({
					kind: "container",
					id
				});
				here.delete(id);
				emit("container.deleted", { id });
			});
			on("container.add-child", ({ containerId, childRef, sectionId }) => {
				if (!graphs.current.getItem(childRef)) return;
				const result = nestHere().add(containerId, childRef);
				const c = containersHere().get(containerId);
				const sectionChanged = c ? assignChildSection(c, childRef, sectionId) : false;
				if (result === "cycle") emit("app.notice", {
					message: "Cannot nest a container into its own descendant.",
					level: "warn"
				});
				else if (sectionChanged) {
					emit("container.children.changed", { id: containerId });
					emit("container.updated", { id: containerId });
				}
			});
			on("container.remove-child", ({ childRef }) => {
				removeChildSection(childRef, nestHere().remove(childRef));
			});
			on("container.child.section.set", ({ containerId, childRef, sectionId }) => {
				if (!childRef) return;
				const c = containerId ? containersHere().get(containerId) ?? null : containerOfChild(childRef);
				if (!c || !sectionId) return;
				if (assignChildSection(c, childRef, sectionId)) {
					emit("container.children.changed", { id: c.id });
					emit("container.updated", { id: c.id });
				}
			});
			on("container.section.title.edit", ({ containerId, sectionId }) => queueMicrotask(() => {
				const el = contexts.places.el(Places.Stage)?.querySelector(`[data-container-section-title][data-container-id="${containerId}"][data-section-id="${sectionId}"]`);
				if (!(el instanceof HTMLElement)) return;
				sectionTitleEdit = {
					containerId,
					sectionId
				};
				enterSectionTitleEdit(el);
			}));
			on("container.section.title.commit", ({ containerId, sectionId, title, finish }) => {
				const c = containersHere().get(containerId);
				const section = c?.Sections?.find((candidate) => candidate.id === sectionId);
				if (!c || !section) return;
				const next = title || section.title;
				if (section.title !== next) {
					section.title = next;
					emit("container.updated", { id: c.id });
				}
				const el = contexts.places.el(Places.Stage)?.querySelector(`[data-container-section-title][data-container-id="${containerId}"][data-section-id="${sectionId}"]`);
				if (el instanceof HTMLElement) {
					el.textContent = section.title;
					exitSectionTitleEdit(el);
					if (finish) queueMicrotask(() => el.blur());
				}
				if (sectionTitleEdit?.containerId === containerId && sectionTitleEdit.sectionId === sectionId) sectionTitleEdit = null;
			});
			on("container.section.resize.start", ({ containerId, index, x, y }) => {
				const c = containersHere().get(containerId);
				if (!c?.Sections || index < 0 || index >= c.Sections.length - 1) return;
				const rect = visualRect(c);
				sectionResize = {
					containerId,
					index,
					axis: c.SectionAxis ?? "rows",
					pointer: contexts.view.clientToSpace(Places.Stage, {
						x,
						y
					}),
					rect,
					weights: c.Sections.map((section) => Math.max(.15, section.weight ?? 1))
				};
			});
			on("container.section.resize.move", ({ x, y }) => {
				if (!sectionResize) return;
				const c = containersHere().get(sectionResize.containerId);
				if (!c?.Sections) return;
				const pointer = contexts.view.clientToSpace(Places.Stage, {
					x,
					y
				});
				const size = sectionResize.axis === "columns" ? sectionResize.rect.w : sectionResize.rect.h;
				const deltaPx = sectionResize.axis === "columns" ? pointer.x - sectionResize.pointer.x : pointer.y - sectionResize.pointer.y;
				const total = sectionResize.weights.reduce((sum, weight) => sum + weight, 0);
				const deltaWeight = size > 0 ? deltaPx / size * total : 0;
				const next = [...sectionResize.weights];
				const a = sectionResize.index;
				const b = a + 1;
				const min = .15;
				const applied = Math.max(min - next[a], Math.min(deltaWeight, next[b] - min));
				next[a] += applied;
				next[b] -= applied;
				c.Sections = c.Sections.map((section, i) => ({
					...section,
					weight: next[i] ?? section.weight ?? 1
				}));
				emit("container.updated", { id: c.id });
				emit("container.children.changed", { id: c.id });
			});
			on("container.section.resize.end", () => {
				sectionResize = null;
			});
			on("graph.node.deleted", ({ id }) => {
				const ref = {
					kind: "node",
					id
				};
				removeChildSection(ref, nestHere().remove(ref));
			});
			on("selection.item.delete", () => {
				selection.selectedAll().forEach((ref) => {
					if (ref.kind === "container") emit("graph.container.delete", { id: ref.id });
				});
			});
			contexts.storage.register("container", origin, (ref, patch) => {
				const c = containersHere().get(ref.id);
				if (!c) return;
				const p = patch;
				const oldPos = { ...c.Position };
				Object.assign(c, p);
				if (p.Sections || p.SectionAxis || p.ChildSections) sanitizeSections(c);
				if (p.Position && (p.Position.x !== oldPos.x || p.Position.y !== oldPos.y)) {
					const dx = p.Position.x - oldPos.x;
					const dy = p.Position.y - oldPos.y;
					c.Children.forEach((childRef) => {
						const child = graphs.current.getItem(childRef);
						if (!child?.Position) return;
						emit("item.update", {
							ref: childRef,
							patch: { Position: {
								x: child.Position.x + dx,
								y: child.Position.y + dy
							} }
						});
					});
				}
				emit("container.updated", { id: c.id });
				if (p.Sections || p.SectionAxis || p.ChildSections) emit("container.children.changed", { id: c.id });
			});
			contribute({
				surface: "top",
				command: "editing.container.create",
				kind: "button",
				text: "+ Container",
				order: 17,
				group: "edit"
			});
			return () => {
				offEntity();
				offCollection();
				states.forEach((s) => s.storeOff());
				states.clear();
			};
		}, { requires: ["render.stage", "graph"] });
	}
	//#endregion
	//#region frontend/systems/context-actions.ts
	var childKey = (ref) => `${ref.kind}:${ref.id}`;
	function registerContextActions(system) {
		system("context.actions", ({ on, emit, contexts, graphs, selection }) => {
			const selected = () => selection.selected();
			const refFrom = (target) => itemRefFrom(target) ?? selected() ?? void 0;
			const button = (label, command, attrs = {}) => {
				const el = document.createElement("button");
				el.type = "button";
				el.className = "context-action";
				el.dataset.command = command;
				Object.entries(attrs).forEach(([key, value]) => {
					el.dataset[key] = value;
				});
				el.textContent = label;
				return el;
			};
			contexts.commands.register([
				{
					id: "item.context.open",
					label: "Open context actions",
					group: "item",
					available: (source) => !!refFrom(source?.target),
					payload: (source) => refFrom(source.target)
				},
				{
					id: "item.context.edit-title",
					label: "Edit title from context actions",
					group: "item",
					hidden: true,
					payload: (source) => refFrom(source.target)
				},
				{
					id: "item.context.properties",
					label: "Open properties from context actions",
					group: "item",
					hidden: true,
					payload: (source) => refFrom(source.target)
				}
			]);
			const bodyFor = (ref) => () => {
				const wrap = document.createElement("section");
				wrap.className = "context-actions";
				wrap.dataset.itemKind = ref.kind;
				wrap.dataset.itemId = ref.id;
				wrap.append(button("Edit title", "item.context.edit-title", {
					itemKind: ref.kind,
					itemId: ref.id
				}), button("Properties", "item.context.properties", {
					itemKind: ref.kind,
					itemId: ref.id
				}));
				if (ref.kind === "node") {
					const shapes = document.createElement("div");
					shapes.className = "context-action-row";
					shapes.append(button("Text", "node.type.text"), button("Box", "node.type.square"), button("Circle", "node.type.circle"));
					wrap.append(shapes);
				}
				const parent = contexts.hierarchy.parentRefOf(ref);
				const container = parent?.kind === "container" ? graphs.current.getItem(parent) : null;
				if (parent?.kind === "container" && container) {
					wrap.append(button("Move out of container", "container.remove-child"));
					if (container.Sections?.length) {
						const heading = document.createElement("div");
						heading.className = "context-action-heading";
						heading.textContent = "Move to section";
						wrap.append(heading);
						container.Sections.forEach((section) => {
							const move = button(`${container.ChildSections?.[childKey(ref)] === section.id ? "✓ " : ""}${section.title}`, "container.child.section.set", {
								containerId: parent.id,
								childKind: ref.kind,
								childId: ref.id,
								sectionId: section.id
							});
							wrap.append(move);
						});
					}
				}
				return wrap;
			};
			on("item.context.open", (ref) => {
				if (!graphs.current.getItem(ref)) return;
				emit("modal.open", {
					title: "Context Actions",
					visual: "properties",
					body: bodyFor(ref)
				});
			});
			on("item.context.edit-title", (ref) => {
				emit("modal.close");
				queueMicrotask(() => emit("item.title.edit", { ref }));
			});
			on("item.context.properties", (ref) => {
				emit("item.properties.open", ref);
			});
		}, { requires: ["modal", "ability.selectable"] });
	}
	//#endregion
	//#region frontend/systems/dark-theme.ts
	var KEY = "theme";
	/** Dark mode toggle. Persisted via IoApi; falls back to OS preference when set to
	*  'system'. Applies `data-theme` on `.shell` so CSS custom properties cascade
	*  without touching the flag/plugin machinery. Theme is UI state, not a feature
	*  toggle — it doesn't go through the registry flag system. */
	function registerDarkTheme(system) {
		system("dark.theme", ({ io, contexts, on, contribute }) => {
			const shellEl = () => contexts.places.el("top")?.parentElement;
			const prefersDark = () => typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false;
			const resolveTheme = (stored) => {
				if (stored === "light" || stored === "dark") return stored;
				return prefersDark() ? "dark" : "light";
			};
			const applyTheme = () => {
				const shell = shellEl();
				if (!shell) return;
				const resolved = resolveTheme(io.get(KEY, "system"));
				shell.setAttribute("data-theme", resolved);
				shell.dataset.colorscheme = resolved;
			};
			if (typeof window.matchMedia === "function") {
				const mq = window.matchMedia("(prefers-color-scheme: dark)");
				mq.onchange = () => {
					if (io.get(KEY, "system") === "system") applyTheme();
				};
			}
			contexts.commands.register([{
				id: "theme.toggle",
				label: "Toggle dark mode",
				group: "view",
				event: "theme.toggle",
				shortcut: "Shift+D",
				input: {
					on: "keydown",
					key: "d",
					shift: true,
					prevent: true
				},
				payload: () => void 0
			}]);
			on("theme.toggle", () => {
				const next = resolveTheme(io.get(KEY, "system")) === "dark" ? "light" : "dark";
				io.set(KEY, next);
				applyTheme();
			});
			on("app.start", () => {
				applyTheme();
			});
			contribute({
				origin: "dark.theme",
				surface: "top",
				command: "theme.toggle",
				kind: "button",
				text: "☀",
				label: "Toggle theme",
				slot: "end",
				order: 78
			});
		}, { requires: ["render"] });
	}
	//#endregion
	//#region frontend/systems/debug.ts
	var STORAGE_KEY = "frontend.debug.enabled";
	function registerDebug(system) {
		system("debug", (ctx) => {
			const { on, emit, contexts, contribute, io, sim } = ctx;
			let enabled = io.get(STORAGE_KEY, false);
			let recording = false;
			let trace = [];
			const recorder = sim.record();
			let assertions = [];
			let assertSearch = "";
			let lastSnapshot = null;
			let replayDraft = "";
			/** Manual edits to the generated test. When non-null, takes over the
			*  textarea instead of the auto-generated string — lets the user flip
			*  captured-actual into desired-actual (e.g. `toBe(false)` → `toBe(true)`)
			*  to encode a regression. New picks re-generate from scratch (clearing
			*  the override), so the convention is "pick, then edit". */
			let manualOverride = null;
			const writeEnabled = (on) => {
				enabled = on;
				io.set(STORAGE_KEY, on);
				emit("debug.enabled.changed", { on });
			};
			const writeRecording = (active) => {
				recording = active;
				emit("debug.recording.changed", {
					active,
					count: trace.length
				});
			};
			contexts.commands.register([
				{
					id: "debug.enable",
					label: "Toggle debug tools",
					group: "debug",
					payload: () => ({ on: !enabled })
				},
				{
					id: "debug.record.start",
					label: "Start recording",
					group: "debug",
					available: () => enabled && !recording
				},
				{
					id: "debug.record.stop",
					label: "Stop recording",
					group: "debug",
					available: () => enabled && recording
				},
				{
					id: "debug.record.clear",
					label: "Clear recording",
					group: "debug",
					available: () => enabled
				},
				{
					id: "debug.assert.open",
					label: "Open assertion authoring",
					group: "debug",
					available: () => enabled
				},
				{
					id: "debug.replay.open",
					label: "Open replay modal",
					group: "debug",
					available: () => enabled
				},
				{
					id: "debug.assert.pick",
					label: "Pick assertion",
					group: "debug",
					hidden: true,
					input: {
						on: "click",
						selector: "[data-snapshot-pick]",
						prevent: true,
						stop: true
					},
					payload: ({ target }) => {
						const el = target?.closest("[data-snapshot-pick]");
						if (!el) return void 0;
						return {
							code: el.dataset.code ?? "",
							matcher: el.dataset.matcher ?? "toBe",
							expected: el.dataset.expected ?? ""
						};
					}
				},
				{
					id: "debug.assert.search",
					label: "Filter snapshot tree",
					group: "debug",
					hidden: true,
					input: {
						on: "input",
						selector: ".debug-assert .debug-search"
					},
					payload: ({ target }) => ({ query: target.value })
				},
				{
					id: "debug.assert.edit",
					label: "Edit generated test",
					group: "debug",
					hidden: true,
					input: {
						on: "input",
						selector: ".debug-assert .debug-code"
					},
					payload: ({ target }) => ({ code: target.value })
				},
				{
					id: "debug.assert.clear-asserts",
					label: "Clear picked assertions",
					group: "debug",
					hidden: true
				},
				{
					id: "debug.assert.copy",
					label: "Copy generated test",
					group: "debug",
					hidden: true
				},
				{
					id: "debug.assert.download",
					label: "Download generated test",
					group: "debug",
					hidden: true
				},
				{
					id: "debug.assert.replay",
					label: "Replay recording in place",
					group: "debug",
					hidden: true
				},
				{
					id: "debug.replay.run",
					label: "Run pasted trace",
					group: "debug",
					hidden: true,
					payload: () => {
						const textarea = contexts.places.el(Places.Modal)?.querySelector(".debug-replay textarea");
						if (textarea) replayDraft = textarea.value;
					}
				}
			]);
			on("debug.enable", ({ on }) => writeEnabled(on));
			on("debug.record.start", () => {
				recorder.start();
				trace = [];
				writeRecording(true);
			});
			on("debug.record.stop", () => {
				trace = recorder.stop();
				writeRecording(false);
			});
			on("debug.record.clear", () => {
				trace = [];
				if (recording) recorder.start();
				writeRecording(recording);
			});
			const renderTreeNode = (node, depth) => {
				const row = document.createElement("div");
				row.className = `debug-tree-row depth-${depth}`;
				row.dataset.path = node.code;
				const label = document.createElement("span");
				label.className = "debug-tree-label";
				label.textContent = node.label;
				row.append(label);
				if (node.kind === "literal") {
					const value = document.createElement("button");
					value.type = "button";
					value.className = "debug-tree-value";
					value.dataset.snapshotPick = "";
					value.dataset.code = node.code;
					value.dataset.matcher = node.value === null ? "toBeNull" : node.value === void 0 ? "toBeUndefined" : "toBe";
					value.dataset.expected = node.value === null || node.value === void 0 ? "" : JSON.stringify(node.value);
					value.textContent = node.value === null ? "null" : node.value === void 0 ? "undefined" : JSON.stringify(node.value);
					value.title = `Click → expect(${node.code}).${value.dataset.matcher}(${value.dataset.expected})`;
					row.append(value);
				} else if (node.kind === "array") {
					const length = node.value.length;
					const value = document.createElement("button");
					value.type = "button";
					value.className = "debug-tree-value debug-tree-array";
					value.dataset.snapshotPick = "";
					value.dataset.code = node.code;
					value.dataset.matcher = "toHaveLength";
					value.dataset.expected = String(length);
					value.textContent = `Array(${length})`;
					value.title = `Click → expect(${node.code}).toHaveLength(${length})`;
					row.append(value);
				} else {
					const summary = document.createElement("span");
					summary.className = "debug-tree-summary";
					summary.textContent = "{…}";
					row.append(summary);
				}
				return row;
			};
			const buildTree = (root, query) => {
				const list = document.createElement("div");
				list.className = "debug-tree";
				const q = query.trim().toLowerCase();
				const flat = flattenSnapshotTree(root);
				const visible = q ? flat.filter((n) => n.path.toLowerCase().includes(q) || n.code.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)) : flat;
				visible.forEach((n) => {
					const depth = (n.path.match(/[.[]/g) || []).length;
					list.append(renderTreeNode(n, depth));
				});
				if (!visible.length) {
					const empty = document.createElement("div");
					empty.className = "debug-tree-empty";
					empty.textContent = `No matches for "${query}".`;
					list.append(empty);
				}
				return list;
			};
			const buildAssertModal = () => {
				const snap = lastSnapshot ?? snapshot(ctx);
				lastSnapshot = snap;
				const tree = snapshotTree(snap);
				const wrap = document.createElement("section");
				wrap.className = "debug-assert";
				const left = document.createElement("div");
				left.className = "debug-state";
				const search = document.createElement("input");
				search.className = "debug-search";
				search.placeholder = "Filter state… (ctx.graphs.current.nodes…)";
				search.value = assertSearch;
				search.autofocus = true;
				left.append(search);
				left.append(buildTree(tree, assertSearch));
				wrap.append(left);
				const right = document.createElement("div");
				right.className = "debug-test";
				const heading = document.createElement("div");
				heading.className = "debug-test-head";
				const count = document.createElement("strong");
				count.textContent = `${trace.length} events captured · ${assertions.length} assertion${assertions.length === 1 ? "" : "s"}`;
				heading.append(count);
				const clearAsserts = document.createElement("button");
				clearAsserts.type = "button";
				clearAsserts.dataset.command = "debug.assert.clear-asserts";
				clearAsserts.textContent = "Clear asserts";
				clearAsserts.className = "icon-button";
				heading.append(clearAsserts);
				right.append(heading);
				const code = document.createElement("textarea");
				code.className = "debug-code";
				code.spellcheck = false;
				code.value = manualOverride ?? traceToTest({
					trace,
					assertions
				});
				right.append(code);
				const actions = document.createElement("div");
				actions.className = "debug-actions";
				const copy = document.createElement("button");
				copy.type = "button";
				copy.dataset.command = "debug.assert.copy";
				copy.textContent = "Copy";
				const dl = document.createElement("button");
				dl.type = "button";
				dl.dataset.command = "debug.assert.download";
				dl.textContent = "Download .test.ts";
				const replay = document.createElement("button");
				replay.type = "button";
				replay.dataset.command = "debug.assert.replay";
				replay.textContent = "Replay in place";
				actions.append(copy, dl, replay);
				right.append(actions);
				wrap.append(right);
				return wrap;
			};
			const reopenAssertModal = () => emit("modal.open", {
				title: "Debug · author assertion",
				visual: "panel",
				body: buildAssertModal
			});
			on("debug.assert.open", () => {
				assertions = [];
				assertSearch = "";
				manualOverride = null;
				lastSnapshot = snapshot(ctx);
				reopenAssertModal();
			});
			on("debug.assert.pick", ({ code, matcher, expected }) => {
				assertions.push({
					code,
					matcher,
					expected
				});
				manualOverride = null;
				reopenAssertModal();
			});
			on("debug.assert.search", ({ query }) => {
				assertSearch = query;
				const modalBody = contexts.places.el(Places.Modal)?.querySelector(".debug-assert .debug-state");
				if (!modalBody) return;
				const tree = snapshotTree(lastSnapshot ?? snapshot(ctx));
				modalBody.querySelector(".debug-tree")?.remove();
				modalBody.querySelector(".debug-tree-empty")?.remove();
				modalBody.append(buildTree(tree, query));
			});
			on("debug.assert.edit", ({ code }) => {
				manualOverride = code;
			});
			on("debug.assert.clear-asserts", () => {
				assertions = [];
				manualOverride = null;
				reopenAssertModal();
			});
			/** Pull the text currently in the textarea — that's the user's
			*  authoritative version (auto-generated or hand-edited). Falls back to a
			*  fresh generation when the modal isn't mounted. */
			const currentTestText = () => {
				const textarea = contexts.places.el(Places.Modal)?.querySelector(".debug-code");
				if (textarea) return textarea.value;
				return manualOverride ?? traceToTest({
					trace,
					assertions
				});
			};
			on("debug.assert.copy", () => {
				const text = currentTestText();
				navigator.clipboard?.writeText(text).then(() => emit("app.notice", {
					message: "Test copied to clipboard.",
					level: "info"
				}), () => emit("app.notice", {
					message: "Copy failed — see textarea.",
					level: "warn"
				}));
			});
			on("debug.assert.download", () => {
				const text = currentTestText();
				const blob = new Blob([text], { type: "text/typescript" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = `recorded-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.test.ts`;
				a.click();
				URL.revokeObjectURL(url);
			});
			on("debug.assert.replay", () => {
				ctx.sim.replay(trace);
				lastSnapshot = snapshot(ctx);
				reopenAssertModal();
			});
			on("debug.replay.open", () => {
				emit("modal.open", {
					title: "Debug · paste & replay",
					visual: "panel",
					body: () => {
						const wrap = document.createElement("section");
						wrap.className = "debug-replay";
						const hint = document.createElement("p");
						hint.className = "debug-replay-hint";
						hint.textContent = "Paste a recorded trace (array of {name, data, at}) and Run.";
						wrap.append(hint);
						const textarea = document.createElement("textarea");
						textarea.spellcheck = false;
						textarea.placeholder = "[\n  { \"name\": \"editing.node.create\", \"data\": {}, \"at\": 0 }\n]";
						textarea.value = replayDraft || JSON.stringify(trace, null, 2);
						wrap.append(textarea);
						const actions = document.createElement("div");
						actions.className = "debug-actions";
						const run = document.createElement("button");
						run.type = "button";
						run.dataset.command = "debug.replay.run";
						run.textContent = "Run";
						run.className = "primary";
						actions.append(run);
						wrap.append(actions);
						return wrap;
					}
				});
			});
			on("debug.replay.run", () => {
				let parsed;
				try {
					parsed = JSON.parse(replayDraft || "[]");
				} catch (err) {
					emit("app.notice", {
						message: `Invalid JSON: ${err.message}`,
						level: "error"
					});
					return;
				}
				if (!Array.isArray(parsed)) {
					emit("app.notice", {
						message: "Trace must be a JSON array.",
						level: "error"
					});
					return;
				}
				emit("modal.close");
				ctx.sim.replay(parsed);
				emit("app.notice", {
					message: `Replayed ${parsed.length} event${parsed.length === 1 ? "" : "s"}.`,
					level: "info"
				});
			});
			const api = {
				enabled: () => enabled,
				recording: () => recording,
				trace: () => trace.slice(),
				setEnabled: writeEnabled,
				start: () => {
					recorder.start();
					trace = [];
					writeRecording(true);
				},
				stop: () => {
					trace = recorder.stop();
					writeRecording(false);
				},
				clear: () => {
					trace = [];
					if (recording) recorder.start();
					writeRecording(recording);
				},
				snapshot: () => snapshot(ctx),
				generate: (a = [], title) => traceToTest({
					trace,
					assertions: a,
					title
				})
			};
			ctx.expose("debug", api);
			on("app.start", () => emit("debug.enabled.changed", { on: enabled }));
		}, { requires: ["render", "modal"] });
	}
	//#endregion
	//#region frontend/systems/detail.ts
	/** The polymorphic "less / more detail" verb, resolved against the current
	*  context (Principle 18): with a chosen set it folds / unfolds those items;
	*  with nothing chosen it zooms the canvas. One verb, target by "currentness" —
	*  the seed of the context command-algebra (additive for now: palette-reachable,
	*  existing zoom/collapse keys still work). */
	function registerDetail(system) {
		system("detail", ({ on, emit, contexts, selection, graphs }) => {
			contexts.commands.register([{
				id: "detail.less",
				label: "Less detail (fold / zoom out)",
				group: "view",
				shortcut: "[",
				input: {
					on: "keydown",
					key: "[",
					prevent: true
				}
			}, {
				id: "detail.more",
				label: "More detail (unfold / zoom in)",
				group: "view",
				shortcut: "]",
				input: {
					on: "keydown",
					key: "]",
					prevent: true
				}
			}]);
			const setFold = (open) => selection.selectedAll().forEach((ref) => contexts.fold.set(itemFoldId(ref, graphs.current.id), open));
			on("detail.less", () => selection.selectedAll().length ? setFold(false) : emit("view.zoom.out"));
			on("detail.more", () => selection.selectedAll().length ? setFold(true) : emit("view.zoom.in"));
		}, { requires: ["view.zoom"] });
	}
	//#endregion
	//#region frontend/systems/demo.ts
	/** Self-graph: the live composition of the app rendered as nodes + edges + one
	*  container per kind so the picture stays readable. Sources its data
	*  exclusively from `introspect(ctx)`, so adding a new system / ability /
	*  feature / entity / collection shows up here with zero edits. */
	function registerDemo(system) {
		system("demo", (ctx) => {
			const { on, emit, graphs, contribute } = ctx;
			contribute({
				surface: "top",
				command: "demo.render-self",
				kind: "button",
				text: "★ Self",
				order: 60
			});
			ctx.contexts.commands.register([
				{
					id: "demo.render-self",
					label: "Render self-graph",
					event: "demo.run-self",
					group: "demo"
				},
				{
					id: "demo.render-java",
					label: "Render Java memory model map",
					event: "demo.run-java",
					group: "demo"
				},
				{
					id: "demo.render-concurrency",
					label: "Render concurrency/process map",
					event: "demo.run-concurrency",
					group: "demo"
				},
				{
					id: "demo.render-jira",
					label: "Render JIRA workflow map",
					event: "demo.run-jira",
					group: "demo"
				}
			]);
			const NODE_KINDS = [
				"system",
				"ability",
				"feature",
				"entity",
				"collection"
			];
			const EDGE_RELATIONS = new Set([
				"requires",
				"declares",
				"lists"
			]);
			/** Plural human label per kind — used as the container title. */
			const KIND_LABEL = {
				system: "Systems",
				ability: "Abilities",
				feature: "Features",
				entity: "Entities",
				collection: "Collections",
				command: "Commands",
				event: "Events"
			};
			const refKey = (ref) => `${ref.kind}:${ref.id}`;
			const containerIds = () => graphs.current.itemsOfKind("container").map((c) => c.id);
			const clearGraph = () => {
				graphs.current.nodes().slice().forEach((node) => emit("graph.node.delete", { id: node.id }));
				containerIds().forEach((id) => emit("graph.container.delete", { id }));
			};
			const makeContainer = (title, at, sections, axis = "rows") => {
				const before = new Set(containerIds());
				emit("editing.container.create", {
					Label: { text: title },
					at
				});
				const id = containerIds().find((candidate) => !before.has(candidate));
				if (id) emit("item.update", {
					ref: {
						kind: "container",
						id
					},
					patch: {
						SectionAxis: axis,
						Sections: sections.map((name, index) => ({
							id: `s${index + 1}`,
							title: name,
							weight: 1
						}))
					}
				});
				return id;
			};
			const makeNode = (label, nodeType, description, containerId, sectionId) => {
				const node = graphs.current.createNode({
					Label: { text: label },
					NodeType: nodeType,
					Description: description,
					Size: nodeType === "text" ? {
						w: 190,
						h: 108
					} : {
						w: 118,
						h: 118
					}
				});
				if (containerId) emit("container.add-child", {
					containerId,
					childRef: {
						kind: "node",
						id: node.id
					},
					sectionId
				});
				emit("graph.node.created", {
					graphId: graphs.current.id,
					id: node.id
				});
				return node.id;
			};
			on("demo.run-self", () => {
				const graph = graphs.current;
				clearGraph();
				const snapshot = introspect(ctx);
				const wantedNodes = snapshot.nodes.filter((n) => NODE_KINDS.includes(n.kind));
				const containerOfKind = /* @__PURE__ */ new Map();
				NODE_KINDS.forEach((kind, i) => {
					const before = new Set(containerIds());
					emit("editing.container.create", {
						Label: { text: KIND_LABEL[kind] },
						at: {
							x: i * 600,
							y: 0
						}
					});
					const created = containerIds().find((id) => !before.has(id));
					if (created) containerOfKind.set(kind, created);
				});
				const idOf = /* @__PURE__ */ new Map();
				wantedNodes.forEach((n) => {
					const created = graph.createNode({ Label: { text: n.id } });
					idOf.set(refKey(n), created.id);
					const containerId = containerOfKind.get(n.kind);
					if (containerId) emit("container.add-child", {
						containerId,
						childRef: {
							kind: "node",
							id: created.id
						}
					});
					emit("graph.node.created", {
						graphId: graph.id,
						id: created.id
					});
				});
				snapshot.edges.forEach((e) => {
					if (!EDGE_RELATIONS.has(e.relation)) return;
					const from = idOf.get(refKey(e.from));
					const to = idOf.get(refKey(e.to));
					if (!from || !to || from === to) return;
					const created = graph.createEdge({
						From: from,
						To: to,
						Label: { text: e.relation }
					});
					emit("graph.edge.created", {
						graphId: graph.id,
						id: created.id,
						edge: created
					});
				});
				emit("layout.apply.tidy");
				emit("view.fit.all");
				console.info("[demo] self-graph rendered", {
					nodes: wantedNodes.length,
					containers: containerOfKind.size,
					edges: snapshot.edges.filter((e) => EDGE_RELATIONS.has(e.relation)).length
				});
			});
			on("demo.run-java", () => {
				clearGraph();
				const runtime = makeContainer("Runtime Data Areas", {
					x: -520,
					y: 0
				}, [
					"Heap",
					"Thread stacks",
					"Metaspace"
				]);
				const execution = makeContainer("Execution + JMM", {
					x: 0,
					y: 0
				}, [
					"Threads",
					"Synchronization",
					"Happens-before"
				]);
				const toolchain = makeContainer("Toolchain", {
					x: 520,
					y: 0
				}, [
					"Source",
					"Bytecode",
					"JIT"
				]);
				const source = makeNode("Java source", "text", "Classes, methods, fields, and generic source-level intent.", toolchain);
				const bytecode = makeNode("Bytecode", "square", "`javac` emits class files with symbolic refs and stack-machine ops.", toolchain);
				const jit = makeNode("JIT compiler", "circle", "Hot methods become optimized machine code; deopt keeps the story reversible.", toolchain);
				const heap = makeNode("Heap objects", "square", "Shared object graph: headers, fields, arrays, and references.", runtime);
				const stacks = makeNode("Thread stacks", "text", "Frames hold locals, operand stacks, return points, and monitor records.", runtime);
				const gc = makeNode("GC roots", "circle", "Stacks, statics, JNI refs, and VM roots seed reachability.", runtime);
				const threads = makeNode("Threads", "circle", "Each thread executes frames while sharing heap state.", execution);
				const sync = makeNode("Monitors + volatile", "square", "Synchronization creates ordering edges and visibility guarantees.", execution);
				const hb = makeNode("Happens-before", "text", "- program order\n- monitor unlock -> lock\n- volatile write -> read", execution);
				[
					[
						source,
						bytecode,
						"compile"
					],
					[
						bytecode,
						jit,
						"hot path"
					],
					[
						threads,
						stacks,
						"executes"
					],
					[
						stacks,
						heap,
						"references"
					],
					[
						gc,
						heap,
						"traces"
					],
					[
						threads,
						sync,
						"coordinates"
					],
					[
						sync,
						hb,
						"orders"
					],
					[
						hb,
						heap,
						"visibility"
					],
					[
						jit,
						threads,
						"runs code"
					]
				].forEach(([From, To, label]) => emit("graph.edge.create", {
					From,
					To,
					Label: { text: label }
				}));
				emit("layout.apply.tidy");
				emit("view.fit.all");
			});
			on("demo.run-concurrency", () => {
				clearGraph();
				const shared = makeContainer("Shared Memory", {
					x: -420,
					y: 0
				}, [
					"ordinary field",
					"volatile flag",
					"mutex-protected"
				], "rows");
				const threads = makeContainer("Process Threads", {
					x: 260,
					y: 0
				}, [
					"Thread A",
					"Thread B",
					"Scheduler"
				], "columns");
				const write = makeNode("write x = 1", "square", "Ordinary write can be reordered unless a happens-before edge constrains it.", threads, "s1");
				const volatileWrite = makeNode("volatile ready = true", "circle", "Volatile write publishes prior writes to later volatile readers.", threads, "s1");
				const readFlag = makeNode("read ready", "circle", "Volatile read observes the publication edge.", threads, "s2");
				const readX = makeNode("read x", "square", "If ready is observed, `x` is visible through happens-before.", threads, "s2");
				const mutex = makeNode("mutex lock", "circle", "Mutual exclusion serializes the critical section.", shared, "s3");
				const counter = makeNode("counter++", "square", "Read-modify-write needs atomicity: lock, CAS, or atomic classes.", shared, "s3");
				const cache = makeNode("CPU cache / store buffer", "text", "Local execution can temporarily diverge from shared visibility.", shared, "s1");
				const scheduler = makeNode("time slice", "text", "Interleavings create many legal traces; synchronization prunes them.", threads, "s3");
				[
					[
						write,
						volatileWrite,
						"program order"
					],
					[
						volatileWrite,
						readFlag,
						"synchronizes-with"
					],
					[
						readFlag,
						readX,
						"visibility"
					],
					[
						mutex,
						counter,
						"guards"
					],
					[
						scheduler,
						write,
						"runs A"
					],
					[
						scheduler,
						readFlag,
						"runs B"
					],
					[
						cache,
						write,
						"buffers"
					],
					[
						counter,
						readX,
						"shared state"
					]
				].forEach(([From, To, label]) => emit("graph.edge.create", {
					From,
					To,
					Label: { text: label }
				}));
				emit("layout.apply.tidy");
				emit("view.fit.all");
			});
			on("demo.run-jira", () => {
				clearGraph();
				const board = makeContainer("JIRA Workflow", {
					x: 0,
					y: 0
				}, [
					"Backlog",
					"In progress",
					"Review",
					"Done"
				], "columns");
				const idea = makeNode("Clarify request", "text", "Question, acceptance criteria, and rough slices.", board, "s1");
				const build = makeNode("Implement slice", "square", "Code + local verification.", board, "s2");
				const review = makeNode("Review / QA", "circle", "Check behavior, edge cases, and regressions.", board, "s3");
				const done = makeNode("Release note", "text", "Merge once quality gates and story are clear.", board, "s4");
				[
					[
						idea,
						build,
						"ready"
					],
					[
						build,
						review,
						"PR"
					],
					[
						review,
						done,
						"approved"
					]
				].forEach(([From, To, label]) => emit("graph.edge.create", {
					From,
					To,
					Label: { text: label }
				}));
				emit("layout.apply.tidy");
				emit("view.fit.all");
			});
		}, { requires: [
			"graph",
			"render",
			"containers"
		] });
	}
	//#endregion
	//#region frontend/systems/dx.ts
	function registerDx(system) {
		system("dx", (ctx) => {
			ctx.expose("dx", { run: () => runDx(ctx) });
			ctx.contexts.dx.setRunner(() => runDx(ctx));
			ctx.on("app.start", () => {
				queueMicrotask(() => {
					const issues = runDx(ctx);
					ctx.contexts.dx.setIssues(issues);
					const errors = issues.filter((i) => i.level === "error");
					const warns = issues.filter((i) => i.level === "warn");
					if (errors.length) {
						console.error("[dx] errors:");
						errors.forEach((i) => console.error(`  ${i.rule}: ${i.message}`));
						throw new Error(`DX contract failed (${errors.length} error${errors.length > 1 ? "s" : ""}). See console.`);
					}
					if (warns.length) {
						console.warn(`[dx] ${warns.length} warning(s):`);
						warns.forEach((i) => console.warn(`  ${i.rule}: ${i.message}`));
					} else console.info("[dx] all checks passed");
				});
			});
		});
	}
	/** Run DX checks against the live app context: model + commands + flags + observed runtime activity. */
	function runDx(ctx) {
		const issues = [];
		const error = (rule, message) => issues.push({
			level: "error",
			rule,
			message
		});
		const warn = (rule, message) => issues.push({
			level: "warn",
			rule,
			message
		});
		const commands = ctx.contexts.commands.all();
		const commandIds = new Set(commands.map((c) => c.id));
		const visibleCommandIds = new Set(commands.filter((c) => !c.hidden).map((c) => c.id));
		const knownSlots = EntitySlots;
		ctx.model.entities().forEach((entityDef) => entityDef.abilities.forEach((abilityDef) => {
			if (!abilityDef.actions.length) error("ability.no-actions", `${entityDef.kind}.${abilityDef.id} has no actions`);
			if (abilityDef.id === "configurable" && !entityDef.properties?.length) error("configurable.no-properties", `${entityDef.kind}.configurable declares no properties`);
			abilityDef.actions.forEach((actionDef) => {
				const paletteCmd = actionDef.paletteCommand != null ? ctx.contexts.commands.get(actionDef.paletteCommand) : void 0;
				if (actionDef.paletteCommand != null && (!paletteCmd || !visibleCommandIds.has(actionDef.paletteCommand))) error("action.palette-missing", `${actionDef.id} missing visible palette command ${actionDef.paletteCommand}`);
				const hasUi = actionDef.ui.length > 0;
				const hasInputBinding = !!paletteCmd?.input;
				if (!hasUi && !hasInputBinding) error("action.no-affordance", `${actionDef.id} has neither a UI affordance nor an input-bound palette command`);
				actionDef.ui.forEach((ui) => {
					if (!commandIds.has(ui.command)) error("action.ui-command-missing", `${actionDef.id} UI missing command ${ui.command}`);
					if (ui.slot != null && !knownSlots.has(ui.slot)) error("slot.unknown", `${actionDef.id} uses unknown slot "${ui.slot}" — add it to Slots in types.ts`);
				});
			});
		}));
		const PATCHABLE_ABILITIES = new Set([
			"draggable",
			"nudgeable",
			"editable",
			"configurable",
			"resizeable"
		]);
		ctx.model.entities().forEach((entityDef) => {
			if ((entityDef.abilities.some((a) => PATCHABLE_ABILITIES.has(a.id)) || (entityDef.properties?.length ?? 0) > 0) && !ctx.contexts.storage.has(entityDef.kind)) error("storage.missing", `entity kind "${entityDef.kind}" has patchable abilities/properties but no storage handler`);
		});
		ctx.model.collections().forEach((collectionDef) => {
			const create = collectionCreateCommand(collectionDef);
			const del = collectionDeleteCommand(collectionDef);
			const missingId = collectionDef.items(ctx).some((item) => !collectionDef.itemId(item));
			if (!commandIds.has(create)) error("collection.no-create", `${collectionDef.id} missing create command ${create}`);
			if (!commandIds.has(del)) error("collection.no-delete", `${collectionDef.id} missing delete command ${del}`);
			if (missingId) error("collection.item-id-missing", `${collectionDef.id} has an item without an id`);
			if (!collectionDef.search) error("collection.no-search", `${collectionDef.id} missing search`);
			if (!collectionDef.order) error("collection.no-order", `${collectionDef.id} missing order`);
		});
		(ctx.model.rawEntities?.() ?? []).forEach((entityDef) => entityDef.abilities.forEach((abilityDef) => {
			if (!ctx.flags.isOn(`ability.${abilityDef.id}`)) warn("ability.disabled", `${entityDef.kind}.${abilityDef.id} is declared but its flag 'ability.${abilityDef.id}' is off`);
		}));
		const bindingKey = (c) => {
			const b = c.input;
			if (!b) return null;
			return [
				b.on,
				b.key ?? "",
				b.ctrl ? "C" : "",
				b.shift ? "S" : "",
				b.alt ? "A" : "",
				b.meta ? "M" : "",
				b.selector ?? ""
			].join("|");
		};
		const scopedBinding = (c) => !!c.input?.when;
		const seenBindings = /* @__PURE__ */ new Map();
		ctx.contexts.commands.enabled().forEach((c) => {
			const key = bindingKey(c);
			if (!key) return;
			if (scopedBinding(c)) return;
			const prev = seenBindings.get(key);
			if (prev) warn("binding.duplicate", `commands "${prev.id}" and "${c.id}" share input binding ${key}`);
			else seenBindings.set(key, c);
		});
		const paletteOwners = /* @__PURE__ */ new Map();
		ctx.model.entities().forEach((entityDef) => entityDef.abilities.forEach((abilityDef) => {
			abilityDef.actions.forEach((actionDef) => {
				if (!actionDef.paletteCommand) return;
				const prev = paletteOwners.get(actionDef.paletteCommand);
				if (prev && prev !== actionDef.id) error("action.palette-shared", `paletteCommand "${actionDef.paletteCommand}" is the canonical for both "${prev}" and "${actionDef.id}"`);
				else if (!prev) paletteOwners.set(actionDef.paletteCommand, actionDef.id);
			});
		}));
		(ctx.contexts.templates._cloned ?? /* @__PURE__ */ new Set()).forEach((name) => {
			if (!document.getElementById(`tpl-${name}`)) error("template.missing", `templates.clone("${name}") but no <template id="tpl-${name}"> exists`);
		});
		commands.forEach((c) => {
			if (!c.origin) error("command.no-origin", `command "${c.id}" has no origin — won't unregister when its system flag flips`);
		});
		const CONTEXT_BUDGET = 14;
		const contextNames = Object.keys(ctx.contexts).filter((name) => name !== "teardown");
		if (contextNames.length > CONTEXT_BUDGET) error("contexts.budget", `ctx.contexts has ${contextNames.length} contexts (budget ${CONTEXT_BUDGET}); merge two before adding one — ${contextNames.join(", ")}`);
		ctx.flags.declared().forEach((name) => {
			if (!ctx.flags.isOn(name)) return;
			const missing = ctx.flags.requires(name).filter((dep) => !ctx.flags.isOn(dep));
			if (missing.length) warn("requires.unmet", `"${name}" is on but its dependencies are off: ${missing.join(", ")}`);
		});
		const bus = ctx.bus;
		const knownKinds = new Set(ctx.model.entities().map((e) => e.kind));
		const collectionKinds = new Set(ctx.model.collections().map((c) => collectionKind(c)));
		const eventKinds = /* @__PURE__ */ new Set();
		[...bus._subscribed ?? [], ...bus._emitted ?? []].forEach((name) => {
			const m = name.match(/^graph\.([a-z]+)\.(?:create|created|update|updated|delete|deleted)$/);
			if (m) eventKinds.add(m[1]);
		});
		eventKinds.forEach((kind) => {
			if (!knownKinds.has(kind)) warn("entity.kind-no-declaration", `bus emits/handles graph.${kind}.* but no entity is declared for "${kind}"`);
			if (!collectionKinds.has(kind)) warn("entity.kind-no-collection", `kind "${kind}" has no collection — it won't appear in outline / palette`);
		});
		return issues;
	}
	//#endregion
	//#region frontend/systems/foldable.ts
	/** Foldable: turns any element with `[data-fold-id]` into a fold toggle, and
	*  routes `fold.toggle` bus events through the shared `contexts.fold` store.
	*  Sections (outline collections), the whole left panel, and any future
	*  collapsible region plug into the same machinery — one click pattern, one
	*  persisted state map, one `.changed` fact event consumers listen to. */
	function registerFoldable(system) {
		system("foldable", ({ on, contexts }) => {
			contexts.commands.register([{
				id: "fold.toggle",
				label: "Toggle fold",
				group: "ui",
				hidden: true,
				input: {
					on: "click",
					selector: "[data-fold-id]",
					prevent: true,
					stop: true
				},
				payload: ({ target }) => {
					const el = target?.closest("[data-fold-id]");
					return el ? { id: el.dataset.foldId ?? "" } : void 0;
				}
			}]);
			on("fold.toggle", ({ id }) => {
				if (id) contexts.fold.toggle(id);
			});
		}, { requires: ["input"] });
	}
	//#endregion
	//#region frontend/systems/focus.ts
	function registerFocus(system) {
		system("focus", ({ on, emit, selection, contexts, origin }) => {
			on("focus.node.focus", ({ id }) => emit("focus.item.focus", nodeRef(id)));
			on("focus.node.clear", () => emit("focus.item.clear"));
			on("focus.item.focus", (ref) => {
				selection.focus(ref);
				contexts.decorations.modes.set(origin, "focused", [ref]);
				emit("focus.item.focused", ref);
				emit("focus.node.focused", { id: ref.kind === "node" ? ref.id : null });
			});
			on("focus.item.clear", () => {
				selection.focus(null);
				contexts.decorations.unregisterOrigin(origin);
				emit("focus.item.focused", null);
				emit("focus.node.focused", { id: null });
			});
		}, { requires: ["graph"] });
	}
	//#endregion
	//#region frontend/systems/graph.ts
	var nextGraphId = (graphs) => graphs.all().find((g) => g.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;
	function registerGraph(system) {
		system("graph", ({ on, emit, graphs, contexts, selection, origin }) => {
			contexts.storage.register("node", origin, (ref, patch) => {
				if (graphs.current.updateNode(ref.id, patch)) emit("graph.node.updated", {
					graphId: graphs.current.id,
					id: ref.id,
					patch
				});
			});
			contexts.storage.register("edge", origin, (ref, patch) => {
				if (graphs.current.updateEdge(ref.id, patch)) emit("graph.edge.updated", {
					graphId: graphs.current.id,
					id: ref.id
				});
			});
			const selectedEdgeId = () => {
				const ref = selection.selected();
				return ref?.kind === "edge" ? ref.id : "";
			};
			contexts.commands.register([
				{
					id: "graph.export.json",
					label: "Export graph JSON",
					group: "graph"
				},
				{
					id: "graph.edge.reverse",
					label: "Reverse edge",
					group: "edge",
					shortcut: "Shift+E",
					available: () => !!selectedEdgeId(),
					payload: () => ({ id: selectedEdgeId() })
				},
				{
					id: "graph.create",
					label: "Create graph",
					group: "graph",
					shortcut: "N",
					input: {
						on: "keydown",
						key: "n",
						prevent: true
					}
				},
				{
					id: "graph.switch.next",
					label: "Switch graph",
					event: "graph.switch",
					group: "graph",
					shortcut: "Alt+G",
					input: {
						on: "keydown",
						key: "g",
						alt: true,
						prevent: true
					},
					payload: () => ({ id: nextGraphId(graphs) })
				},
				{
					id: "graph.switch",
					label: "Switch graph",
					group: "graph",
					hidden: true,
					payload: (source) => ({ id: itemIdFrom(source.target) || graphs.current.id })
				},
				{
					id: "graph.delete",
					label: "Delete graph",
					group: "graph",
					available: (source) => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
					payload: (source) => ({ id: itemIdFrom(source.target) || graphs.current.id })
				},
				{
					id: "graph.node.delete",
					label: "Delete node",
					group: "graph",
					available: (source) => !!itemIdFrom(source?.target) || !!selection.selectedNode(),
					payload: (source) => ({ id: itemIdFrom(source.target) || selection.selectedNode()?.id || "" })
				},
				{
					id: "graph.edge.delete",
					label: "Delete edge",
					group: "edge",
					available: (source) => !!itemIdFrom(source?.target) || !!selectedEdgeId(),
					payload: (source) => ({ id: itemIdFrom(source.target) || selectedEdgeId() })
				}
			]);
			on("graph.export.json", () => {
				const json = JSON.stringify(graphs.current.snapshot());
				(globalThis.navigator?.clipboard)?.writeText?.(json)?.catch?.(() => {});
				emit("graph.exported", { json });
			});
			on("graph.import.snapshot", (snapshot) => {
				graphs.current.replace(snapshot);
				emit("graph.imported", { graphId: graphs.current.id });
				emit("graph.switched", { id: graphs.current.id });
			});
			on("graph.edge.reverse", ({ id }) => {
				const edge = graphs.current.getEdge(id);
				if (!edge) return;
				if (graphs.current.updateEdge(id, {
					From: edge.To,
					To: edge.From
				})) emit("graph.edge.updated", {
					graphId: graphs.current.id,
					id
				});
			});
			on("graph.create", () => {
				const graph = graphs.create();
				graphs.switch(graph.id);
				emit("graph.created", { id: graph.id });
				emit("graph.switched", { id: graph.id });
			});
			on("graph.switch", ({ id }) => {
				emit("graph.switched", { id: graphs.switch(id).id });
			});
			on("graph.node.create", (draft) => {
				const { relativeTo, keepFocus, connectFrom, connectKind, ...store } = draft;
				const anchorNode = relativeTo ? graphs.current.getNode(relativeTo) : selection.selectedNode();
				const node = graphs.current.createNode(store, {
					at: contexts.view.spaceCenter(Places.Stage),
					nearPosition: anchorNode?.Position
				});
				emit("graph.node.created", {
					graphId: graphs.current.id,
					id: node.id,
					hints: {
						keepFocus,
						connectFrom,
						connectKind,
						relativeTo
					}
				});
			});
			on("graph.node.update", ({ id, patch }) => {
				if (graphs.current.updateNode(id, patch)) emit("graph.node.updated", {
					graphId: graphs.current.id,
					id,
					patch
				});
			});
			on("graph.node.delete", ({ id }) => {
				const incident = graphs.current.edgesOf(id).map((e) => e.id);
				if (graphs.current.deleteNode(id)) {
					incident.forEach((eid) => emit("graph.edge.deleted", {
						graphId: graphs.current.id,
						id: eid
					}));
					emit("graph.node.deleted", {
						graphId: graphs.current.id,
						id
					});
				}
			});
			on("graph.edge.create", (draft) => {
				if (!draft.From || !draft.To || draft.From === draft.To) return;
				if (!graphs.current.getNode(draft.From) || !graphs.current.getNode(draft.To)) return;
				const edge = graphs.current.createEdge(draft);
				emit("graph.edge.created", {
					graphId: graphs.current.id,
					id: edge.id,
					edge
				});
			});
			on("graph.edge.update", ({ id, patch }) => {
				if (graphs.current.updateEdge(id, patch)) emit("graph.edge.updated", {
					graphId: graphs.current.id,
					id
				});
			});
			on("graph.edge.delete", ({ id }) => {
				if (graphs.current.deleteEdge(id)) emit("graph.edge.deleted", {
					graphId: graphs.current.id,
					id
				});
			});
			on("graph.delete", ({ id }) => {
				const next = graphs.delete(id);
				emit("graph.deleted", {
					id,
					nextId: next.id
				});
				emit("graph.switched", { id: next.id });
			});
			const offTargets = contexts.hierarchy.sources.register(origin, () => {
				const nodes = graphs.current.nodes().map((node) => ({
					ref: nodeRef(node.id),
					label: node.Label.text || node.id,
					anchor: node.Position ?? {
						x: 0,
						y: 0
					}
				}));
				const edges = graphs.current.edges().flatMap((edge) => {
					const from = graphs.current.getNode(edge.From);
					const to = graphs.current.getNode(edge.To);
					if (!from?.Position || !to?.Position) return [];
					return [{
						ref: edgeRef(edge.id),
						label: edge.Label?.text || `${from.Label.text} to ${to.Label.text}`,
						anchor: {
							x: (from.Position.x + to.Position.x) / 2,
							y: (from.Position.y + to.Position.y) / 2
						}
					}];
				});
				return [...nodes, ...edges];
			});
			return () => {
				offTargets();
			};
		});
	}
	//#endregion
	//#region frontend/systems/input.ts
	function registerInput(system) {
		system("input", ({ on, contexts }) => {
			let stopInput;
			on("app.start", () => {
				stopInput?.();
				stopInput = contexts.input.start();
			});
			return () => stopInput?.();
		});
	}
	//#endregion
	//#region frontend/systems/io.ts
	/** io — persist flag / command / fold state to the IoApi adapter.
	*  Reads happen at boot (core contexts hydrate from io.get); writes go through
	*  events so core contexts never call io.set directly (Principle 9).
	*  The io system owns the persistence boundary — all other systems just emit
	*  facts that end in `.changed` and this system writes them to storage. */
	function registerIo(system) {
		system("io", ({ on, io, flags, contexts }) => {
			on("flag.changed", () => io.set(STORAGE_KEYS.flags, flags.all()));
			on("command.shortcut.changed", ({ id, shortcut }) => {
				const overrides = io.get(STORAGE_KEYS.shortcuts, {});
				overrides[id] = shortcut;
				io.set(STORAGE_KEYS.shortcuts, overrides);
			});
			on("command.enabled.changed", ({ id, enabled }) => {
				const disabled = new Set(io.get(STORAGE_KEYS.disabledCommands, []));
				if (enabled) disabled.delete(id);
				else disabled.add(id);
				io.set(STORAGE_KEYS.disabledCommands, [...disabled]);
			});
			on("fold.changed", () => io.set("frontend.fold", contexts.fold.all()));
		});
	}
	//#endregion
	//#region frontend/systems/jump.ts
	var LETTERS = "asdfghjklqwertyuiopzxcvbnm";
	function registerJump(system) {
		system("jump", ({ on, emit, contexts, graphs, origin }) => {
			let letterToRef = null;
			const cancel = () => {
				if (!letterToRef) return;
				letterToRef = null;
				contexts.decorations.unregisterOrigin("jump");
				contexts.keyboard.unregisterOrigin("jump");
			};
			const start = () => {
				const targets = contexts.hierarchy.targets().filter((target) => !foldHidden(target.ref, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id)).slice(0, 26);
				if (!targets.length) return;
				const next = /* @__PURE__ */ new Map();
				const overlays = targets.map((target, i) => {
					const letter = LETTERS[i];
					next.set(letter, target.ref);
					return {
						ref: target.ref,
						text: letter.toUpperCase(),
						className: "jump-letter",
						id: `jump-${letter}`
					};
				});
				letterToRef = next;
				contexts.decorations.overlays.set("jump", overlays);
				contexts.keyboard.capture("jump", { onKey(event) {
					if (event.key === "Escape") return;
					if (event.key === "Enter") {
						event.preventDefault();
						emit("jump.cancel");
						return;
					}
					const letter = event.key.toLowerCase();
					if (!/^[a-z]$/.test(letter)) return;
					event.preventDefault();
					const ref = letterToRef?.get(letter);
					if (!ref) {
						emit("jump.cancel");
						return;
					}
					emit("focus.item.focus", ref);
					emit("view.fit.item", ref);
					emit("jump.cancel");
				} });
			};
			contexts.commands.register([{
				id: "jump.start",
				label: "Jump to item",
				group: "jump",
				shortcut: "g",
				input: {
					on: "keydown",
					key: "g",
					prevent: true,
					stop: true
				},
				available: () => contexts.hierarchy.targets().length > 0
			}, {
				id: "jump.cancel",
				label: "Cancel jump",
				group: "jump",
				hidden: true
			}]);
			on("jump.start", start);
			on("jump.cancel", cancel);
			contexts.cancellation.register({
				origin,
				active: () => !!letterToRef,
				cancel: () => emit("jump.cancel")
			});
			return cancel;
		}, { requires: [
			"render.stage",
			"graph",
			"focus",
			"view.zoom"
		] });
	}
	//#endregion
	//#region frontend/systems/layout.ts
	/** Partition the current graph's nodes by hierarchy. Returns one scope per
	*  parent (plus one for the root scope). Edges are split so each scope only
	*  sees its own. With no hierarchy providers (the flat case), every node is
	*  in the root scope and behavior is identical to a flat graph.
	*
	*  Nodes nested inside a `Collapsed` ancestor are excluded — moving hidden
	*  nodes would scramble their positions for when the user expands again. */
	function partitionByScope(ctx) {
		const graph = ctx.graphs.current;
		const hierarchy = ctx.contexts.hierarchy;
		const fold = ctx.contexts.fold;
		const all = graph.nodes();
		const hiddenByCollapse = (node) => hierarchy.parentChain({
			kind: "node",
			id: node.id
		}).some((ancestor) => fold.folded(itemFoldId(ancestor, graph.id)));
		const groups = /* @__PURE__ */ new Map();
		for (const node of all) {
			if (hiddenByCollapse(node)) continue;
			const chain = hierarchy.parentChain({
				kind: "node",
				id: node.id
			});
			const parent = chain.length ? chain[chain.length - 1] : null;
			const key = parent ? `${parent.kind}:${parent.id}` : "";
			const group = groups.get(key) ?? {
				parent,
				nodes: []
			};
			group.nodes.push(node);
			groups.set(key, group);
		}
		const rootOrigin = (nodes) => {
			const positioned = nodes.map((node) => node.Position).filter((p) => !!p);
			if (!positioned.length) return {
				x: 0,
				y: 0
			};
			return {
				x: positioned.reduce((sum, p) => sum + p.x, 0) / positioned.length,
				y: positioned.reduce((sum, p) => sum + p.y, 0) / positioned.length
			};
		};
		return [...groups.values()].map(({ parent, nodes }) => {
			const parentItem = parent ? graph.getItem(parent) : void 0;
			const parentEntity = parent ? ctx.model.entity(parent.kind) : void 0;
			const parentBounds = parent && parentItem ? parentEntity?.render?.bounds?.(parentItem) ?? void 0 : void 0;
			const origin = parent ? parentItem?.Position ?? {
				x: 0,
				y: 0
			} : rootOrigin(nodes);
			const nodeIds = new Set(nodes.map((n) => n.id));
			return {
				origin,
				parent,
				nodes,
				edges: graph.edges().filter((e) => nodeIds.has(e.From) && nodeIds.has(e.To)),
				bounds: parentBounds,
				sections: parentItem?.Sections?.map((section, index) => ({
					id: section.id || `s${index + 1}`,
					title: section.title,
					weight: Math.max(.15, Number(section.weight) || 1)
				})),
				sectionAxis: parentItem?.SectionAxis ?? "rows",
				childSections: parentItem?.ChildSections
			};
		});
	}
	var nodeKey = (id) => `node:${id}`;
	var GAP_X = 56;
	var GAP_Y = 72;
	var sizeOf = (node) => node.Size ?? {
		w: 160,
		h: 72
	};
	function sectionRects(scope) {
		if (!scope.bounds || !scope.sections?.length) return [];
		const inset = 32;
		const rect = {
			x: scope.bounds.x + inset,
			y: scope.bounds.y + LABEL_SECTION_TOP,
			w: Math.max(80, scope.bounds.w - inset * 2),
			h: Math.max(60, scope.bounds.h - LABEL_SECTION_TOP - inset)
		};
		const total = scope.sections.reduce((sum, section) => sum + section.weight, 0) || 1;
		let cursor = scope.sectionAxis === "columns" ? rect.x : rect.y;
		return scope.sections.map((section) => {
			const ratio = section.weight / total;
			if (scope.sectionAxis === "columns") {
				const w = rect.w * ratio;
				const out = {
					section,
					rect: {
						x: cursor,
						y: rect.y,
						w,
						h: rect.h
					}
				};
				cursor += w;
				return out;
			}
			const h = rect.h * ratio;
			const out = {
				section,
				rect: {
					x: rect.x,
					y: cursor,
					w: rect.w,
					h
				}
			};
			cursor += h;
			return out;
		});
	}
	var LABEL_SECTION_TOP = 36;
	function sectionedScope(scope, set) {
		const bands = sectionRects(scope);
		if (!bands.length) return false;
		const fallback = bands[0].section.id;
		bands.forEach(({ section, rect }) => {
			const nodes = scope.nodes.filter((node) => (scope.childSections?.[nodeKey(node.id)] ?? fallback) === section.id);
			if (!nodes.length) return;
			const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
			const rows = Math.max(1, Math.ceil(nodes.length / cols));
			nodes.forEach((node, index) => {
				const col = index % cols;
				const row = Math.floor(index / cols);
				const x = rect.x + (col + 1) / (cols + 1) * rect.w;
				const y = rect.y + (row + 1) / (rows + 1) * rect.h;
				set(node.id, {
					x,
					y
				});
			});
		});
		return true;
	}
	/** Tidy tree per scope: BFS levels from in-degree-zero roots, columns spread
	*  around scope.origin.x, rows step down from scope.origin.y. */
	function tidyScope(scope, set) {
		if (sectionedScope(scope, set)) return;
		const inDeg = new Map(scope.nodes.map((n) => [n.id, 0]));
		scope.edges.forEach((e) => inDeg.set(e.To, (inDeg.get(e.To) ?? 0) + 1));
		const roots = scope.nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0);
		if (!roots.length) return;
		const level = /* @__PURE__ */ new Map();
		const queue = [];
		roots.forEach((r) => {
			level.set(r.id, 0);
			queue.push(r.id);
		});
		while (queue.length) {
			const id = queue.shift();
			const lv = level.get(id);
			scope.edges.filter((e) => e.From === id).forEach((e) => {
				if (!level.has(e.To)) {
					level.set(e.To, lv + 1);
					queue.push(e.To);
				}
			});
		}
		const byLevel = /* @__PURE__ */ new Map();
		scope.nodes.forEach((n) => {
			const lv = level.get(n.id) ?? 0;
			(byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)).push(n);
		});
		const levels = [...byLevel.entries()].sort((a, b) => a[0] - b[0]);
		let y = scope.origin.y;
		for (const [, nodes] of levels) {
			const rowH = Math.max(...nodes.map((n) => sizeOf(n).h));
			const totalW = nodes.reduce((sum, n) => sum + sizeOf(n).w, 0) + GAP_X * Math.max(0, nodes.length - 1);
			let x = scope.origin.x - totalW / 2;
			nodes.forEach((n) => {
				const w = sizeOf(n).w;
				set(n.id, {
					x: x + w / 2,
					y: y + rowH / 2
				});
				x += w + GAP_X;
			});
			y += rowH + GAP_Y;
		}
	}
	/** Square-ish grid per scope, centered at scope.origin. Cell size = the largest
	*  node in the scope + gaps, so no two boxes touch regardless of text length. */
	function gridScope(scope, set) {
		const cols = Math.max(1, Math.ceil(Math.sqrt(scope.nodes.length)));
		const rows = Math.ceil(scope.nodes.length / cols);
		const maxW = Math.max(...scope.nodes.map((n) => sizeOf(n).w), 0);
		const maxH = Math.max(...scope.nodes.map((n) => sizeOf(n).h), 0);
		const colSize = maxW + GAP_X, rowSize = maxH + GAP_Y;
		const startX = scope.origin.x - (cols - 1) * colSize / 2;
		const startY = scope.origin.y - (rows - 1) * rowSize / 2;
		scope.nodes.forEach((n, i) => {
			const col = i % cols, row = Math.floor(i / cols);
			set(n.id, {
				x: startX + col * colSize,
				y: startY + row * rowSize
			});
		});
	}
	/** Radial per scope: pick a center (focused if it lives in this scope, else
	*  the first node), arrange the rest in a ring. The center node itself is not
	*  moved — radial preserves where the picked anchor sits. */
	function radialScope(scope, focusedId, set) {
		if (!scope.nodes.length) return;
		const inScope = (id) => !!id && scope.nodes.some((n) => n.id === id);
		const root = focusedId && inScope(focusedId) ? scope.nodes.find((n) => n.id === focusedId) : scope.nodes[0];
		const others = scope.nodes.filter((n) => n.id !== root.id);
		const circumference = others.reduce((sum, n) => sum + sizeOf(n).w + GAP_X, 0);
		const rootReach = Math.max(sizeOf(root).w, sizeOf(root).h) / 2;
		const radius = Math.max(160, 60 + others.length * 22, circumference / (2 * Math.PI) + rootReach);
		const center = root.Position ?? scope.origin;
		others.forEach((n, i) => {
			const angle = i / Math.max(1, others.length) * Math.PI * 2 - Math.PI / 2;
			set(n.id, {
				x: center.x + Math.cos(angle) * radius,
				y: center.y + Math.sin(angle) * radius
			});
		});
	}
	function registerLayout(system) {
		system("layout", (ctx) => {
			const { on, emit, contexts, selection, contribute, declarePanel } = ctx;
			declarePanel({
				id: "layout",
				anchor: "bottom-left",
				movable: false,
				layout: "toolbar",
				order: 10
			});
			contribute({
				surface: "top",
				panel: "layout",
				command: "layout.apply.tidy",
				kind: "button",
				text: "Tidy",
				order: 65
			});
			contribute({
				surface: "top",
				panel: "layout",
				command: "layout.apply.grid",
				kind: "button",
				text: "Grid",
				order: 66
			});
			contribute({
				surface: "top",
				panel: "layout",
				command: "layout.apply.radial",
				kind: "button",
				text: "Radial",
				order: 67
			});
			contexts.commands.register([
				{
					id: "layout.apply.radial",
					label: "Radial layout",
					group: "layout",
					input: {
						on: "keydown",
						key: "r",
						prevent: true
					}
				},
				{
					id: "layout.apply.grid",
					label: "Grid layout",
					group: "layout",
					input: {
						on: "keydown",
						key: "G",
						shift: true,
						prevent: true
					}
				},
				{
					id: "layout.apply.tidy",
					label: "Tidy tree layout",
					group: "layout",
					input: {
						on: "keydown",
						key: "t",
						prevent: true
					}
				}
			]);
			const set = (id, Position) => emit("item.update", {
				ref: nodeRef(id),
				patch: { Position }
			});
			on("layout.apply.tidy", () => partitionByScope(ctx).forEach((scope) => tidyScope(scope, set)));
			on("layout.apply.grid", () => partitionByScope(ctx).forEach((scope) => gridScope(scope, set)));
			on("layout.apply.radial", () => {
				const focusedId = selection.focusedNode()?.id ?? selection.selectedNode()?.id;
				partitionByScope(ctx).forEach((scope) => radialScope(scope, focusedId, set));
			});
		}, { requires: ["graph"] });
	}
	//#endregion
	//#region frontend/systems/log.ts
	/** Event log. Subscribes via bus.onAny, prepends each non-render.* event to a
	*  capped ring, and emits the render.view.set on a single rAF — even under a
	*  100-event burst, the log paints at most once per frame (principle 8). */
	function registerLog(system) {
		system("log", ({ bus, emit, contexts }) => {
			const rows = [];
			const renderLog = () => {
				const panel = contexts.templates.clone("log");
				const list = contexts.templates.slot(panel, "rows");
				rows.forEach((row) => {
					const item = contexts.templates.clone("log-row");
					contexts.templates.text(item, "name", row);
					list.append(item);
				});
				return panel;
			};
			let scheduled = false;
			const scheduleDraw = () => {
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(() => {
					scheduled = false;
					emit("render.view.set", {
						place: Places.Left,
						key: "log",
						view: renderLog
					});
				});
			};
			bus.onAny((event) => {
				if (event.name.startsWith("render.")) return;
				rows.unshift(event.name === "app.notice" ? `${event.name}: ${event.data.message}` : event.name);
				rows.length = Math.min(rows.length, 12);
				scheduleDraw();
			});
		}, { requires: ["render"] });
	}
	//#endregion
	//#region frontend/systems/main.ts
	/** Zen = fold the whole app shell (hide top), leaving only the canvas —
	*  the same fold concept (Principle 18) applied to the app target: "less detail
	*  on everything". Toggle with `\` (it's the only exit once panels are hidden). */
	var ZEN_FOLD_ID$1 = "shell.zen";
	function registerMain(system) {
		system("main", ({ on, emit, contexts, contribute, origin }) => {
			contexts.cancellation.register({
				origin,
				background: false,
				active: () => contexts.fold.folded(ZEN_FOLD_ID$1),
				cancel: () => contexts.fold.set(ZEN_FOLD_ID$1, true)
			});
			const shellEl = () => contexts.places.el(Places.Top)?.parentElement;
			const syncShellFold = () => {
				const shell = shellEl();
				if (!shell) return;
				shell.dataset.zen = contexts.fold.folded(ZEN_FOLD_ID$1) ? "true" : "false";
			};
			contexts.commands.register([{
				id: "view.zen",
				label: "Toggle zen mode",
				event: "fold.toggle",
				group: "view",
				shortcut: "\\",
				input: {
					on: "keydown",
					key: "\\",
					prevent: true
				},
				payload: () => ({ id: ZEN_FOLD_ID$1 })
			}]);
			contribute({
				surface: "top",
				command: "view.zen",
				kind: "button",
				text: "☾",
				label: "Toggle zen mode",
				order: 80
			});
			on("app.start", () => {
				emit("render.shell");
				syncShellFold();
			});
			on("fold.changed", ({ id }) => {
				if (id === ZEN_FOLD_ID$1) syncShellFold();
			});
		}, { requires: ["render"] });
	}
	//#endregion
	//#region frontend/systems/modal.ts
	function registerModal(system) {
		system("modal", ({ on, emit, contexts, origin }) => {
			let open = false;
			contexts.commands.register([{
				id: "modal.close",
				label: "Close modal",
				group: "modal"
			}]);
			contexts.cancellation.register({
				origin,
				active: () => open,
				cancel: () => emit("modal.close")
			});
			on("modal.close", () => {
				open = false;
				emit("render.view.clear", {
					place: Places.Modal,
					key: "modal"
				});
			});
			on("modal.open", ({ title = "Modal", body, visual = "panel" }) => {
				open = true;
				const bodyRenderable = body;
				emit("render.view.set", {
					place: Places.Modal,
					key: "modal",
					view: () => {
						const modal = contexts.templates.clone("modal");
						modal.dataset.visual = visual;
						contexts.templates.text(modal, "title", title);
						if (bodyRenderable) appendRenderable(contexts.templates.slot(modal, "body"), bodyRenderable);
						return modal;
					}
				});
				queueMicrotask(() => {
					const root = contexts.places.el(Places.Modal);
					(root?.querySelector("[autofocus]") ?? root?.querySelector("input:not([type=\"hidden\"]):not([disabled]), textarea, select"))?.focus();
				});
			});
		}, { requires: ["render"] });
	}
	//#endregion
	//#region frontend/systems/item-toolbar.ts
	/** Ephemeral toolbar pinned above the selected item — regardless of kind.
	*
	*  Pulls affordances from the same `affordances.entity(entityDef)` API the
	*  in-template wiring uses. Whichever entity is selected, its abilities'
	*  affordances appear here in floating chrome — no per-kind branching.
	*
	*  Adding a new entity kind that should get the toolbar = nothing here, as
	*  long as the entity declares abilities with `surface: 'entity'` affordances. */
	function registerItemToolbar(system) {
		system("item.toolbar", ({ on, emit, contexts, graphs, model, selection }) => {
			const clear = () => emit("render.view.clear", {
				place: Places.Stage,
				key: "item-toolbar"
			});
			const buildButton = (item, action, ui) => {
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.command = ui.command;
				button.textContent = uiValue(ui.text, item, action.label);
				const label = uiValue(ui.label, item, action.label);
				button.setAttribute("aria-label", label);
				button.title = label;
				if (ui.className) button.classList.add(...ui.className.split(/\s+/).filter(Boolean));
				Object.entries(ui.attrs ?? {}).forEach(([name, value]) => button.setAttribute(name, uiValue(value, item)));
				return button;
			};
			const buildHandler = (item, ui, text) => {
				const span = document.createElement("span");
				if (ui.className) span.classList.add(...ui.className.split(/\s+/).filter(Boolean));
				Object.entries(ui.attrs ?? {}).forEach(([name, value]) => span.setAttribute(name, uiValue(value, item)));
				span.textContent = text;
				return span;
			};
			const buildToolbar = (entityDef, item, ref) => {
				const wrapper = document.createElement("div");
				wrapper.className = "item-toolbar node-toolbar";
				wrapper.dataset.itemKind = ref.kind;
				wrapper.dataset.itemId = ref.id;
				const renderer = entityDef.render;
				const fallbackPos = item.Position ?? {
					x: 0,
					y: 0
				};
				const fallbackSize = item.Size ?? {
					w: 0,
					h: 0
				};
				const rect = renderer?.bounds?.(item) ?? {
					x: fallbackPos.x - fallbackSize.w / 2,
					y: fallbackPos.y - fallbackSize.h / 2,
					w: fallbackSize.w,
					h: fallbackSize.h
				};
				const topCenter = {
					x: rect.x + rect.w / 2,
					y: rect.y
				};
				const screen = contexts.view.spaceToScreen(topCenter);
				const leftPanel = contexts.places.el(Places.Left)?.getBoundingClientRect();
				const minX = leftPanel && leftPanel.width > 0 ? leftPanel.right + 44 : 0;
				wrapper.style.left = `${Math.max(screen.x, minX)}px`;
				wrapper.style.top = `${screen.y}px`;
				const append = (slot, kind, handlerText = "", baseClass = "") => {
					contexts.affordances.entity(entityDef, slot).forEach(({ action, ui }) => {
						if (ui.kind !== kind) return;
						const el = kind === "button" ? buildButton(item, action, ui) : buildHandler(item, ui, handlerText);
						if (baseClass) el.classList.add(baseClass);
						wrapper.append(el);
					});
				};
				append(Slots.Drag, "handler", "⋮⋮", "node-drag-handle");
				append(Slots.HeaderStart, "button");
				append(Slots.HeaderEnd, "button");
				if (ref.kind === "node") {
					const context = document.createElement("button");
					context.type = "button";
					context.className = "node-action node-context-actions";
					context.dataset.command = "item.context.open";
					context.setAttribute("aria-label", "Context actions");
					context.title = "More actions";
					context.textContent = "⋯";
					wrapper.append(context);
				}
				return wrapper;
			};
			const draw = () => {
				const ref = selection.selected();
				if (!ref) return clear();
				const entityDef = model.entity(ref.kind);
				const item = graphs.current.getItem(ref);
				if (!entityDef || !item) return clear();
				const bounds = entityDef.render?.bounds?.(item);
				if (bounds && !contexts.view.isVisible(Places.Stage, bounds, 80)) return clear();
				if (!contexts.affordances.entity(entityDef).length) return clear();
				emit("render.view.set", {
					place: Places.Stage,
					key: "item-toolbar",
					view: () => buildToolbar(entityDef, item, ref) ?? document.createDocumentFragment()
				});
			};
			on("render.stage.draw", draw);
			on("render.stage.camera", draw);
		}, { requires: ["render.stage", "graph"] });
	}
	//#endregion
	//#region frontend/systems/text-layout.ts
	var linesOf = (text) => text.split(/\r?\n/).flatMap((line) => {
		const trimmed = line.trim();
		return trimmed ? [trimmed] : [];
	});
	var estimateTextSize = (input) => {
		const titleLines = linesOf(input.title);
		const bodyLines = linesOf(input.description ?? "");
		const CHAR_W = 7.2, PAD_X = 32;
		const longest = [...titleLines, ...bodyLines].reduce((max, line) => Math.max(max, line.length), 1);
		const maxWidth = input.maxWidth ?? 320;
		const width = clamp$1(longest * CHAR_W + PAD_X, input.minWidth ?? 120, maxWidth);
		const capacity = Math.max(6, Math.floor((width - PAD_X) / CHAR_W));
		const wrappedRows = (lines) => lines.reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / capacity)), 0);
		const titleRows = Math.max(1, wrappedRows(titleLines));
		const bodyRows = wrappedRows(bodyLines);
		const height = clamp$1(titleRows * 22 + bodyRows * 16 + 24, input.minHeight ?? 56, input.maxHeight ?? 280);
		return {
			w: Math.round(width),
			h: Math.round(height)
		};
	};
	var fitText = (text, box) => {
		const words = text.trim().split(/\s+/).filter(Boolean);
		const chars = Math.max(1, words.join(" ").length);
		const lineCapacity = Math.max(8, Math.floor(box.w / 7));
		const lines = Math.max(1, Math.ceil(chars / lineCapacity));
		const lineHeight = 1.25;
		const fontSize = clamp$1(Math.floor(box.h / (lines * lineHeight)), 10, 14);
		return {
			fontSize,
			lineHeight,
			lines,
			overflow: lines * fontSize * lineHeight > box.h
		};
	};
	function registerTextLayout(system) {
		system("text.layout", (ctx) => {
			ctx.expose("textLayout", {
				estimate: estimateTextSize,
				fit: fitText
			});
		});
	}
	//#endregion
	//#region frontend/systems/node-autosize.ts
	/** Sizes a node's box to fit its title + description (and every newline within),
	*  so text never overflows and boxes look proportional to their content.
	*
	*  Auto-sizing yields to manual resize: we remember the last size we applied per
	*  node; if the current size differs from that, the user dragged the resize
	*  handle and we stop touching it. Text edits on an auto-sized node re-fit it. */
	function registerNodeAutosize(system) {
		system("node.autosize", ({ on, emit, graphs }) => {
			const autoSized = /* @__PURE__ */ new Map();
			const sameSize = (a, b) => !!a && !!b && a.w === b.w && a.h === b.h;
			const fit = (node) => estimateTextSize({
				title: node.Label?.text ?? "",
				description: node.Description
			});
			const apply = (id) => {
				const node = graphs.current.getNode(id);
				if (!node) return;
				const prev = autoSized.get(id);
				if (node.Size && prev && !sameSize(node.Size, prev)) return;
				const next = fit(node);
				autoSized.set(id, next);
				if (!sameSize(node.Size, next)) emit("item.update", {
					ref: {
						kind: "node",
						id
					},
					patch: { Size: next }
				});
			};
			on("graph.node.created", ({ id }) => apply(id));
			on("graph.node.updated", ({ id, patch }) => {
				if (patch && !("Label" in patch) && !("Description" in patch) && !("Size" in patch)) return;
				apply(id);
			});
			on("graph.imported", () => {
				autoSized.clear();
				graphs.current.nodes().forEach((node) => autoSized.set(node.id, node.Size));
			});
		}, { requires: ["graph"] });
	}
	//#endregion
	//#region frontend/systems/node-visuals.ts
	var PANEL_ID = "node-types";
	var PANEL_KEY = "tool-panel:node-types";
	var SHAPE_SIZE = {
		text: {
			w: 170,
			h: 76
		},
		square: {
			w: 112,
			h: 112
		},
		circle: {
			w: 112,
			h: 112
		}
	};
	var TEXT_SIZE = SHAPE_SIZE.text;
	var SQUARE_SIZE = SHAPE_SIZE.square;
	var isDefaultish = (size) => size.w === 150 && size.h === 64 || size.w === TEXT_SIZE.w && size.h === TEXT_SIZE.h || size.w === SQUARE_SIZE.w && size.h === SQUARE_SIZE.h;
	function registerNodeVisuals(system) {
		system("node.visuals", ({ on, emit, contexts, graphs, selection }) => {
			const selectedId = () => selection.selectedNode()?.id;
			const selectedType = () => selection.selectedNode()?.NodeType ?? "text";
			const visible = () => !!selectedId();
			let drawQueued = false;
			const setButton = (command, text, active) => {
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.command = command;
				button.className = "node-type-button";
				button.classList.toggle("active", active);
				button.textContent = text;
				button.setAttribute("aria-pressed", active ? "true" : "false");
				return button;
			};
			const drawPanel = () => {
				if (!visible()) {
					emit("render.view.clear", {
						place: Places.Stage,
						key: PANEL_KEY
					});
					return;
				}
				emit("render.view.set", {
					place: Places.Stage,
					key: PANEL_KEY,
					view: () => {
						const active = selectedType();
						const panel = document.createElement("section");
						panel.className = "tool-panel node-type-panel";
						panel.dataset.panelId = PANEL_ID;
						panel.dataset.nodeId = selectedId() ?? "";
						panel.style.left = "12px";
						panel.style.bottom = "12px";
						panel.append(setButton("node.type.text", "Text", active === "text"), setButton("node.type.square", "Box", active === "square"), setButton("node.type.circle", "Circle", active === "circle"));
						const props = document.createElement("button");
						props.type = "button";
						props.className = "node-type-button";
						props.dataset.command = "item.properties.open";
						props.textContent = "Desc";
						props.setAttribute("aria-label", "Edit node description");
						panel.append(props);
						return panel;
					}
				});
			};
			const scheduleDrawPanel = () => {
				if (drawQueued) return;
				drawQueued = true;
				queueMicrotask(() => {
					drawQueued = false;
					drawPanel();
				});
			};
			const setType = (nodeType) => ({
				id: selectedId(),
				nodeType
			});
			contexts.commands.register([
				{
					id: "node.type.text",
					label: "Set node shape: text",
					event: "node.type.set",
					group: "node",
					available: visible,
					payload: () => setType("text")
				},
				{
					id: "node.type.square",
					label: "Set node shape: square",
					event: "node.type.set",
					group: "node",
					available: visible,
					payload: () => setType("square")
				},
				{
					id: "node.type.circle",
					label: "Set node shape: circle",
					event: "node.type.set",
					group: "node",
					available: visible,
					payload: () => setType("circle")
				}
			]);
			on("node.type.set", ({ id, nodeType }) => {
				if (!id) return;
				const node = graphs.current.getNode(id);
				if (!node) return;
				const patch = { NodeType: nodeType };
				const size = SHAPE_SIZE[nodeType];
				if (size && node.NodeType !== nodeType && isDefaultish(node.Size)) patch.Size = size;
				emit("item.update", {
					ref: nodeRef(id),
					patch
				});
			});
			on("app.start", drawPanel);
			on("selection.changed", scheduleDrawPanel);
			on("graph.node.created", scheduleDrawPanel);
			on("graph.node.updated", scheduleDrawPanel);
			on("graph.node.deleted", scheduleDrawPanel);
			on("graph.switched", scheduleDrawPanel);
		}, { requires: [
			"graph",
			"render.stage",
			"ability.selectable"
		] });
	}
	//#endregion
	//#region frontend/systems/outline.ts
	/** outline — the left-pane navigator. It renders each collection as a *section*
	*  (preserving the collection/DX contract: every collection keeps its own
	*  search + create + delete), but lays the items out by HIERARCHY rather than
	*  flat: a kind that participates in the hierarchy shows its *roots*, with
	*  contained items nested + foldable beneath their parent. Loose nodes stay in
	*  the Nodes section; a node moved into a container leaves that flat list and
	*  appears nested under the container — nesting is visible in navigation, not
	*  just storage. Non-hierarchical kinds (graphs) render as flat leaves. */
	function registerOutline(system) {
		system("outline", (ctx) => {
			const { on, emit, contexts, model } = ctx;
			const hierarchy = contexts.hierarchy;
			const searches = /* @__PURE__ */ new Map();
			const el = (tag, className, text) => {
				const node = document.createElement(tag);
				if (className) node.className = className;
				if (text != null) node.textContent = text;
				return node;
			};
			/** kind → its declaring collection, so a nested child row (any kind) can
			*  wire the right select/delete commands. */
			const collectionsByKind = () => {
				const map = /* @__PURE__ */ new Map();
				model.collections().forEach((c) => map.set(collectionKind(c), c));
				return map;
			};
			/** Render one hierarchy node (+ its kept descendants). Returns null when a
			*  search query is active and neither this node nor any descendant matches. */
			const renderRow = (node, parentIds, byKind, depth, query) => {
				const kind = node.ref.kind;
				const selfMatch = !query || (node.label ?? "").toLowerCase().includes(query);
				const childRows = node.children.map((child) => renderRow(child, [...parentIds, node.ref.id], byKind, depth + 1, query)).filter((row) => !!row);
				if (query && !selfMatch && !childRows.length) return null;
				const coll = byKind.get(kind);
				const ref = parentIds.length ? {
					kind,
					id: node.ref.id,
					parent: parentIds
				} : {
					kind,
					id: node.ref.id
				};
				const wrap = el("div", "outline-item");
				const row = el("div", `outline-row depth-${depth}`);
				tagItem(row, ref);
				const foldId = `outline.item.${kind}:${node.ref.id}`;
				const open = query ? true : contexts.fold.isOpen(foldId, true);
				if (node.children.length) {
					const toggle = el("button", "icon-button outline-fold", open ? "▾" : "▸");
					toggle.dataset.foldId = foldId;
					toggle.setAttribute("aria-expanded", open ? "true" : "false");
					row.append(toggle);
				} else row.append(el("span", "outline-fold-spacer"));
				const main = el("button", "outline-main", node.label || node.ref.id);
				if (coll) main.dataset.command = collectionSelectCommand(coll);
				row.append(main);
				if (model.entity(kind)?.properties?.length) {
					const props = el("button", "icon-button", "⚙");
					props.dataset.command = "item.properties.open";
					row.append(props);
				}
				if (coll) {
					const remove = el("button", "icon-button", "x");
					remove.dataset.command = collectionDeleteCommand(coll);
					row.append(remove);
				}
				wrap.append(row);
				if (node.children.length && open) {
					const kids = el("div", "outline-children");
					childRows.forEach((child) => kids.append(child));
					wrap.append(kids);
				}
				return wrap;
			};
			const leafNode = (collectionDef, item) => ({
				ref: {
					kind: collectionKind(collectionDef),
					id: collectionDef.itemId(item)
				},
				label: collectionDef.itemLabel(item),
				children: []
			});
			const renderSection = (collectionDef, roots, total, byKind, rootTotal = roots.length) => {
				const section = el("section", "outline-section");
				section.dataset.collectionId = collectionDef.id;
				const foldId = `outline.collection.${collectionDef.id}`;
				const open = contexts.fold.isOpen(foldId, true);
				section.classList.toggle("folded", !open);
				const head = el("div", "outline-head");
				const foldTrigger = el("button", "icon-button outline-fold", open ? "▾" : "▸");
				foldTrigger.dataset.foldId = foldId;
				foldTrigger.setAttribute("aria-expanded", open ? "true" : "false");
				foldTrigger.setAttribute("aria-label", open ? `Collapse ${collectionDef.label}` : `Expand ${collectionDef.label}`);
				const query = searches.get(collectionDef.id) ?? "";
				const title = el("input", "panel-title outline-title-search");
				title.placeholder = collectionDef.label;
				title.value = query;
				title.dataset.collectionId = collectionDef.id;
				title.setAttribute("aria-label", `Search ${collectionDef.label.toLowerCase()}`);
				const createButton = el("button", "icon-button", "+");
				createButton.dataset.command = collectionCreateCommand(collectionDef);
				head.append(foldTrigger, title, createButton);
				section.append(head);
				if (!open) return section;
				const q = query.trim().toLowerCase();
				const list = el("div", "outline-list");
				const rows = roots.slice(0, MAX_SECTION_ROWS).map((root) => renderRow(root, [], byKind, 0, q)).filter((row) => !!row);
				rows.forEach((row) => list.append(row));
				section.append(list);
				if (!q && rootTotal > MAX_SECTION_ROWS) section.append(el("div", "outline-more", `${(rootTotal - MAX_SECTION_ROWS).toLocaleString()} more`));
				if (!rows.length) {
					const shortcut = commandShortcut(contexts.commands, collectionCreateCommand(collectionDef));
					const label = collectionDef.label.toLowerCase();
					const emptyTitle = q ? `No matches for "${query}"` : total > 0 ? `All ${label} are nested` : `No ${label} yet`;
					const hint = !q && !total && shortcut ? kbdHint("Press ", shortcut, " or click +") : void 0;
					const empty = emptyState(contexts.templates, emptyTitle, hint);
					if (empty) section.append(empty);
				}
				return section;
			};
			const FLAT_KINDS = new Set(["graph", "edge"]);
			const MAX_SECTION_ROWS = 50;
			const PANEL_FOLD_ID = "outline.panel";
			const renderOutline = () => {
				const wrapper = el("div", "tool-panel outline-panel");
				wrapper.dataset.outlineFolded = contexts.fold.folded(PANEL_FOLD_ID) ? "true" : "false";
				const head = el("div", "outline-panel-head");
				const foldBtn = el("button", "icon-button outline-fold", contexts.fold.folded(PANEL_FOLD_ID) ? "▸" : "▾");
				foldBtn.dataset.foldId = PANEL_FOLD_ID;
				foldBtn.setAttribute("aria-label", "Toggle outline");
				const title = el("span", "panel-title", "Outline");
				head.append(foldBtn, title);
				wrapper.append(head);
				const body = el("div", "outline-panel-body");
				const panel = el("section", "outline");
				const byKind = collectionsByKind();
				const queryActive = [...searches.values()].some((query) => query.trim());
				const nestedItemsExist = model.collections().some((def) => {
					const collectionDef = def;
					return collectionDef.section === false && !FLAT_KINDS.has(collectionKind(collectionDef)) && collectionDef.items(ctx).length > 0;
				});
				const needsTree = queryActive || nestedItemsExist;
				const forest = needsTree ? hierarchy.tree() : [];
				const itemKinds = needsTree ? new Set(hierarchy.items().map((item) => item.ref.kind)) : /* @__PURE__ */ new Set();
				const contentTotal = needsTree ? hierarchy.items().filter((item) => !FLAT_KINDS.has(item.ref.kind)).length : 0;
				let treeRendered = false;
				model.collections().forEach((def) => {
					const collectionDef = def;
					if (collectionDef.section === false) return;
					const kind = collectionKind(collectionDef);
					const items = collectionDef.items(ctx);
					if (FLAT_KINDS.has(kind)) {
						const roots = needsTree && itemKinds.has(kind) ? forest.filter((node) => node.ref.kind === kind) : items.slice(0, MAX_SECTION_ROWS).map((item) => leafNode(collectionDef, item));
						panel.append(renderSection(collectionDef, roots, items.length, byKind, needsTree ? roots.length : items.length));
					} else {
						if (treeRendered) return;
						treeRendered = true;
						const roots = needsTree ? forest.filter((node) => !FLAT_KINDS.has(node.ref.kind)) : items.slice(0, MAX_SECTION_ROWS).map((item) => leafNode(collectionDef, item));
						panel.append(renderSection(collectionDef, roots, needsTree ? contentTotal : items.length, byKind, needsTree ? roots.length : items.length));
					}
				});
				body.append(panel);
				wrapper.append(body);
				return wrapper;
			};
			const draw = () => emit("render.view.set", {
				place: Places.Left,
				key: "outline",
				view: renderOutline
			});
			contexts.commands.register([{
				id: "outline.search.change",
				label: "Change outline search",
				event: "outline.search.changed",
				group: "outline",
				hidden: true,
				input: {
					on: "input",
					selector: ".outline-title-search"
				},
				payload: ({ target }) => ({
					collectionId: target.dataset.collectionId,
					query: target.value
				})
			}]);
			on("app.start", draw);
			on("outline.draw", draw);
			on("fold.changed", ({ id }) => {
				if (id.startsWith("outline.")) draw();
			});
			on("outline.search.changed", ({ collectionId, query }) => {
				searches.set(collectionId, query);
				draw();
				queueMicrotask(() => {
					const next = contexts.places.el(Places.Left)?.querySelector(`.outline-title-search[data-collection-id="${collectionId}"]`);
					next?.focus();
					next?.setSelectionRange(next.value.length, next.value.length);
				});
			});
		}, { requires: ["render", "graph"] });
	}
	//#endregion
	//#region frontend/systems/perf-panel.ts
	var ms = (value) => value == null || !Number.isFinite(value) ? "-" : value < 1 ? value.toFixed(2) : value.toFixed(0);
	var selectorFor = (target) => {
		if (!(target instanceof Element)) return "";
		const parts = [];
		let el = target;
		while (el && parts.length < 4) {
			const id = el.id ? `#${el.id}` : "";
			const cls = [...el.classList].slice(0, 3).map((name) => `.${name}`).join("");
			const item = el instanceof HTMLElement && el.dataset.itemKind && el.dataset.itemId ? `[${el.dataset.itemKind}:${el.dataset.itemId}]` : "";
			parts.unshift(`${el.localName}${id}${cls}${item}`);
			el = el.parentElement;
		}
		return parts.join(" > ");
	};
	var topInput = (inputs) => [...inputs].sort((a, b) => b.inputDelay - a.inputDelay).slice(0, 40);
	var list = (values, sep = ", ") => values?.length ? values.join(sep) : "-";
	var sortKey = (text) => {
		const numeric = Number(text.replace(/,/g, "").match(/^-?\d+(?:\.\d+)?/)?.[0]);
		return Number.isFinite(numeric) ? numeric : text.toLowerCase();
	};
	var makeSortable = (t) => {
		const headers = Array.from(t.tHead?.rows[0]?.cells ?? []);
		headers.forEach((th, index) => {
			th.tabIndex = 0;
			th.title = "Sort";
			const sort = () => {
				const dir = th.dataset.dir === "desc" ? "asc" : "desc";
				headers.forEach((item) => {
					item.classList.remove("is-sorted");
					delete item.dataset.dir;
				});
				th.classList.add("is-sorted");
				th.dataset.dir = dir;
				const sign = dir === "asc" ? 1 : -1;
				const rows = Array.from(t.tBodies[0]?.rows ?? []);
				rows.sort((a, b) => {
					const av = sortKey(a.cells[index]?.textContent ?? "");
					const bv = sortKey(b.cells[index]?.textContent ?? "");
					if (typeof av === "number" && typeof bv === "number") return sign * (av - bv);
					return sign * String(av).localeCompare(String(bv));
				});
				t.tBodies[0]?.append(...rows);
			};
			th.onclick = sort;
			th.onkeydown = (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				sort();
			};
		});
	};
	var appendRow = (parent, cells) => {
		const row = document.createElement("tr");
		cells.forEach((cell) => {
			const td = document.createElement("td");
			if (typeof cell === "string") td.textContent = cell;
			else td.append(cell);
			row.append(td);
		});
		parent.append(row);
	};
	var table = (headers, rows) => {
		const wrap = document.createElement("div");
		wrap.className = "perf-table-wrap";
		const t = document.createElement("table");
		t.className = "perf-table";
		const head = document.createElement("thead");
		const hr = document.createElement("tr");
		headers.forEach((label) => {
			const th = document.createElement("th");
			th.textContent = label;
			hr.append(th);
		});
		head.append(hr);
		const body = document.createElement("tbody");
		rows.forEach((row) => appendRow(body, row));
		t.append(head, body);
		makeSortable(t);
		wrap.append(t);
		return wrap;
	};
	var bar = (value, max) => {
		const outer = document.createElement("span");
		outer.className = "perf-bar";
		const inner = document.createElement("span");
		inner.style.width = `${Math.max(2, Math.min(100, max > 0 ? value / max * 100 : 0))}%`;
		outer.append(inner);
		return outer;
	};
	var renderSummary = (snap) => {
		const inputs = snap.inputs;
		const maxInput = Math.max(0, ...inputs.map((row) => row.inputDelay));
		const maxDuration = Math.max(0, ...inputs.map((row) => row.duration));
		const maxSpan = Math.max(0, ...snap.timeline.map((row) => row.duration));
		const grid = document.createElement("div");
		grid.className = "perf-summary";
		[
			["Input delay", `${ms(maxInput)} ms`],
			["Event duration", `${ms(maxDuration)} ms`],
			["Timeline spans", snap.timeline.length.toLocaleString()],
			["Max span", `${ms(maxSpan)} ms`]
		].forEach(([label, value]) => {
			const item = document.createElement("div");
			item.className = "perf-summary-item";
			item.innerHTML = `<span></span><b></b>`;
			item.querySelector("span").textContent = label;
			item.querySelector("b").textContent = value;
			grid.append(item);
		});
		return grid;
	};
	var renderInputs = (snap) => table([
		"Event",
		"Target",
		"Delay",
		"Processing",
		"Presentation",
		"Duration",
		"Source",
		"Matched",
		"Candidates"
	], topInput(snap.inputs).map((row) => [
		row.name,
		row.target || "-",
		`${ms(row.inputDelay)} ms`,
		`${ms(row.processingDuration)} ms`,
		`${ms(row.presentationDelay)} ms`,
		`${ms(row.duration)} ms`,
		row.source,
		list(row.matched),
		list(row.candidates)
	]));
	var renderInputPaths = (snap) => table([
		"Event",
		"Delay",
		"Source",
		"Path"
	], topInput(snap.inputs).map((row) => {
		const domPath = row.path?.length ? row.path.join(" -> ") : row.target || "-";
		const commandPath = row.matched?.length ? ` -> ${row.matched.map((id) => `Command.run.${id}`).join(" -> ")}` : "";
		return [
			row.name,
			`${ms(row.inputDelay)} ms`,
			row.source,
			`${domPath}${commandPath}`
		];
	}));
	var renderLongTasks = (snap) => table([
		"Name",
		"When",
		"Duration"
	], [...snap.longTasks].sort((a, b) => b.duration - a.duration).slice(0, 80).map((row) => [
		row.name || "longtask",
		`${ms(row.start)} ms`,
		`${ms(row.duration)} ms`
	]));
	var renderTimeline = (snap) => {
		const rows = snap.timeline.slice(-250);
		const max = Math.max(1, ...rows.map((row) => row.duration));
		const labels = new Map(snap.timeline.map((row) => [row.id, row.label]));
		return table([
			"Span",
			"When",
			"Duration",
			"Parent",
			"Bar"
		], rows.map((row) => [
			row.label,
			`${ms(row.start)} ms`,
			`${ms(row.duration)} ms`,
			row.parentId ? labels.get(row.parentId) ?? String(row.parentId) : "",
			bar(row.duration, max)
		]));
	};
	var renderCallGraph = (snap) => table([
		"From",
		"To",
		"Calls",
		"Total",
		"Max"
	], snap.callGraph.slice(0, 80).map((edge) => [
		edge.from,
		edge.to,
		edge.calls.toLocaleString(),
		`${ms(edge.totalMs)} ms`,
		`${ms(edge.maxMs)} ms`
	]));
	var renderTimings = (snap) => table([
		"Label",
		"Calls",
		"Total",
		"Avg",
		"Max"
	], snap.timings.slice(0, 80).map((row) => [
		row.label,
		row.calls.toLocaleString(),
		`${ms(row.totalMs)} ms`,
		`${ms(row.avgMs)} ms`,
		`${ms(row.maxMs)} ms`
	]));
	var shortText = (snap) => {
		const topInputs = topInput(snap.inputs).slice(0, 8);
		const topLongTasks = [...snap.longTasks].sort((a, b) => b.duration - a.duration).slice(0, 8);
		const maxInput = Math.max(0, ...snap.inputs.map((row) => row.inputDelay));
		const maxDuration = Math.max(0, ...snap.inputs.map((row) => row.duration));
		const maxSpan = Math.max(0, ...snap.timeline.map((row) => row.duration));
		return [
			`PERF ${(/* @__PURE__ */ new Date()).toISOString()}`,
			`summary inputDelay=${ms(maxInput)}ms eventDuration=${ms(maxDuration)}ms spans=${snap.timeline.length} maxSpan=${ms(maxSpan)}ms longTasks=${snap.longTasks.length}`,
			"inputs:",
			...topInputs.map((row) => `- ${row.name} delay=${ms(row.inputDelay)}ms dur=${ms(row.duration)}ms proc=${ms(row.processingDuration)}ms pres=${ms(row.presentationDelay)}ms src=${row.source} target=${row.target || "-"} matched=${list(row.matched)} candidates=${list(row.candidates)}`),
			"paths:",
			...topInputs.map((row) => `- ${row.name}: ${row.path?.length ? row.path.join(" -> ") : row.target || "-"}${row.matched?.length ? ` -> ${row.matched.join(" -> ")}` : ""}`),
			"timings:",
			...snap.timings.slice(0, 10).map((row) => `- ${row.label} calls=${row.calls} total=${ms(row.totalMs)}ms max=${ms(row.maxMs)}ms avg=${ms(row.avgMs)}ms`),
			"callGraph:",
			...snap.callGraph.slice(0, 10).map((row) => `- ${row.from} -> ${row.to} calls=${row.calls} total=${ms(row.totalMs)}ms max=${ms(row.maxMs)}ms`),
			"longTasks:",
			...topLongTasks.length ? topLongTasks.map((row) => `- ${row.name || "longtask"} at=${ms(row.start)}ms dur=${ms(row.duration)}ms`) : ["- none"]
		].join("\n");
	};
	var renderExport = (snap) => {
		const wrap = document.createElement("div");
		wrap.className = "perf-export-wrap";
		const text = document.createElement("textarea");
		text.className = "perf-export";
		text.readOnly = true;
		text.value = shortText(snap);
		wrap.append(text);
		return wrap;
	};
	function registerPerfPanel(system) {
		system("perf.panel", (ctx) => {
			const { on, emit, contexts, contribute, perf } = ctx;
			let eventObserverStarted = false;
			let longTaskObserverStarted = false;
			const installEventTiming = () => {
				if (eventObserverStarted || !perf.enabled()) return;
				eventObserverStarted = true;
				if (typeof PerformanceObserver === "undefined") return;
				if (!(PerformanceObserver.supportedEntryTypes ?? []).includes("event")) return;
				try {
					new PerformanceObserver((list) => {
						list.getEntries().forEach((entry) => {
							const e = entry;
							const processingStart = e.processingStart ?? e.startTime;
							const processingEnd = e.processingEnd ?? processingStart;
							const inputDelay = Math.max(0, processingStart - e.startTime);
							const processingDuration = Math.max(0, processingEnd - processingStart);
							const presentationDelay = Math.max(0, e.duration - inputDelay - processingDuration);
							perf.recordInput({
								source: "event-timing",
								name: e.name,
								target: selectorFor(e.target),
								startTime: e.startTime,
								processingStart,
								processingEnd,
								duration: e.duration,
								inputDelay,
								processingDuration,
								presentationDelay,
								interactionId: e.interactionId
							});
						});
					}).observe({
						type: "event",
						buffered: true,
						durationThreshold: 0
					});
				} catch {}
			};
			const installLongTasks = () => {
				if (longTaskObserverStarted || !perf.enabled()) return;
				longTaskObserverStarted = true;
				if (typeof PerformanceObserver === "undefined") return;
				if (!(PerformanceObserver.supportedEntryTypes ?? []).includes("longtask")) return;
				try {
					new PerformanceObserver((list) => {
						list.getEntries().forEach((entry) => {
							perf.recordLongTask({
								name: entry.name,
								start: entry.startTime,
								duration: entry.duration
							});
						});
					}).observe({
						type: "longtask",
						buffered: true
					});
				} catch {}
			};
			const installObservers = () => {
				installEventTiming();
				installLongTasks();
			};
			const renderPanel = () => {
				installObservers();
				const snap = perf.snapshot();
				const root = document.createElement("section");
				root.className = "perf-panel";
				const actions = document.createElement("div");
				actions.className = "perf-actions";
				const refresh = document.createElement("button");
				refresh.dataset.command = "perf.show";
				refresh.textContent = "Refresh";
				const copy = document.createElement("button");
				copy.dataset.command = "perf.copy";
				copy.textContent = "Copy Short";
				const reset = document.createElement("button");
				reset.dataset.command = "perf.reset";
				reset.textContent = "Reset";
				actions.append(refresh, copy, reset);
				root.append(actions, renderSummary(snap));
				[
					["Input Events", renderInputs(snap)],
					["Input Paths", renderInputPaths(snap)],
					["Long Tasks", renderLongTasks(snap)],
					["Timeline", renderTimeline(snap)],
					["Call Graph", renderCallGraph(snap)],
					["Timing Totals", renderTimings(snap)],
					["Share Text", renderExport(snap)]
				].forEach(([title, body], i) => {
					const details = document.createElement("details");
					details.open = i < 4;
					const summary = document.createElement("summary");
					summary.textContent = title;
					details.append(summary, body);
					root.append(details);
				});
				return root;
			};
			contexts.commands.register([
				{
					id: "perf.show",
					label: "Show: Perf",
					group: "dx",
					available: () => perf.enabled()
				},
				{
					id: "perf.reset",
					label: "Reset perf recorder",
					group: "dx",
					hidden: true,
					available: () => perf.enabled()
				},
				{
					id: "perf.copy",
					label: "Copy perf summary",
					group: "dx",
					hidden: true,
					available: () => perf.enabled()
				}
			]);
			if (perf.enabled()) contribute({
				surface: "top",
				command: "perf.show",
				kind: "button",
				text: "Perf",
				label: "Show perf recorder",
				order: 120
			});
			on("app.start", installObservers);
			on("perf.show", () => emit("modal.open", {
				title: "Perf",
				visual: "perf",
				body: renderPanel
			}));
			on("perf.copy", () => {
				const text = shortText(perf.snapshot());
				navigator.clipboard?.writeText(text).catch(() => void 0);
				console.info(text);
			});
			on("perf.reset", () => {
				perf.reset();
				emit("perf.show");
			});
		}, { requires: ["modal"] });
	}
	//#endregion
	//#region frontend/systems/render.ts
	/** render owns the shell + slot flush + redraw scheduler — never the canvas paint.
	*  Stage drawing lives in `render.stage`, which listens for `render.stage.draw`.
	*  Outline drawing lives in `outline`, which listens for `outline.draw`. Splitting
	*  these out lets the canvas/webgl swap touch a single system. */
	function registerRender(system) {
		system("render", (ctx) => {
			const { on, emit, bus, contexts } = ctx;
			const root = mountRoot();
			const views = /* @__PURE__ */ new Map();
			const mounted = /* @__PURE__ */ new Map();
			const attr = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
			const itemSelector = (ref) => {
				const parent = itemParentAttr(ref.parent);
				return `[data-item-kind="${attr(ref.kind)}"][data-item-id="${attr(ref.id)}"]${parent ? `[data-item-parent="${attr(parent)}"]` : ":not([data-item-parent])"}`;
			};
			const activeElement = () => document.activeElement;
			const modalOpen = () => (contexts.places.el(Places.Modal)?.children.length ?? 0) > 0;
			const blurActiveItem = () => {
				const active = activeElement();
				if (active?.closest("[data-item-kind][data-item-id]") && typeof active.blur === "function") active.blur();
			};
			const nodeOf = (view) => typeof view === "function" ? view() : view;
			const mountedFor = (place) => mounted.get(place) ?? mounted.set(place, /* @__PURE__ */ new Map()).get(place);
			const mountView = (place, key, view) => {
				const slot = contexts.places.el(place);
				if (!slot) return;
				const live = mountedFor(place);
				const previous = live.get(key);
				const next = nodeOf(view);
				if (previous === next) {
					if (previous.parentNode !== slot) slot.append(previous);
					return;
				}
				if (previous?.parentNode) previous.parentNode.replaceChild(next, previous);
				else slot.append(next);
				live.set(key, next);
			};
			const remount = (place) => {
				const slot = contexts.places.el(place), parts = views.get(place);
				if (!slot || !parts) return;
				const live = mountedFor(place);
				parts.forEach((view, key) => {
					const node = live.get(key) ?? nodeOf(view);
					live.set(key, node);
					slot.append(node);
				});
			};
			on("render.shell", () => {
				root.replaceChildren(contexts.templates.clone("shell"));
				Object.values(Places).forEach((place) => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
				Object.values(Places).forEach(remount);
			});
			on("render.view.set", ({ place, key = "default", view }) => {
				(views.get(place) || views.set(place, /* @__PURE__ */ new Map()).get(place)).set(key, view);
				mountView(place, key, view);
			});
			on("render.view.clear", ({ place, key }) => {
				if (key) {
					const parts = views.get(place);
					if (!parts?.has(key)) return;
					parts.delete(key);
					const previous = mounted.get(place)?.get(key);
					previous?.parentNode?.removeChild(previous);
					mounted.get(place)?.delete(key);
				} else {
					if (!views.has(place)) return;
					views.delete(place);
					mounted.get(place)?.forEach((node) => node.parentNode?.removeChild(node));
					mounted.delete(place);
				}
			});
			const dirty = /* @__PURE__ */ new Set();
			const dirtyItems = /* @__PURE__ */ new Map();
			let fullNodes = false;
			/** Extract the single node/edge a fact is about, for targeted patching.
			*  Anything else (containers, graph switch, selection sets, layout) returns
			*  null → the frame falls back to a full rebuild. */
			const factItemRef = (name, data) => {
				const id = data?.id;
				if (!id) return null;
				if (name.startsWith("graph.node.")) return {
					kind: "node",
					id
				};
				if (name.startsWith("graph.edge.")) return {
					kind: "edge",
					id
				};
				return null;
			};
			let scheduled = false;
			let flushes = 0;
			let pendingFocusRef = null;
			let pendingBlur = false;
			const focusPendingItem = () => {
				if (pendingBlur) {
					pendingBlur = false;
					blurActiveItem();
				}
				if (!pendingFocusRef) return;
				if (modalOpen()) {
					pendingFocusRef = null;
					return;
				}
				const item = contexts.places.el(Places.Stage)?.querySelector(itemSelector(pendingFocusRef));
				pendingFocusRef = null;
				const focusable = item;
				if (typeof focusable?.focus === "function") focusable.focus({ preventScroll: true });
			};
			const flushDirty = () => {
				scheduled = false;
				flushes++;
				ctx.perf.count("Render.flush");
				ctx.perf.sample("Render.flush.dirtyScopes", dirty.size);
				if (dirty.has("nodes")) {
					ctx.perf.count("Render.flush.nodes");
					ctx.perf.sample("Render.flush.refs", dirtyItems.size);
					emit("render.stage.draw", {
						full: fullNodes,
						refs: [...dirtyItems.values()]
					});
				} else if (dirty.has("camera")) {
					ctx.perf.count("Render.flush.camera");
					emit("render.stage.camera");
				}
				if (dirty.has("outline")) {
					ctx.perf.count("Render.flush.outline");
					emit("outline.draw");
				}
				dirty.clear();
				dirtyItems.clear();
				fullNodes = false;
				queueMicrotask(focusPendingItem);
			};
			const mark = (...scopes) => {
				scopes.forEach((s) => dirty.add(s));
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(flushDirty);
			};
			const applyScope = (scope) => scope === "both" ? mark("nodes", "outline") : mark(scope);
			const scopeForEvent = (name, data) => {
				if (name === "graph.node.updated") {
					const patch = data?.patch;
					if (patch && !("Label" in patch)) return "nodes";
				}
				return factScope(name);
			};
			ctx.expose("render", { flushes: () => flushes });
			on("app.start", () => mark("nodes"));
			on("focus.item.focused", (ref) => {
				pendingFocusRef = ref;
				if (!ref) pendingBlur = true;
			});
			bus.onAny(({ name, data }) => {
				const scope = scopeForEvent(name, data);
				if (!scope) return;
				applyScope(scope);
				if (scope === "nodes" || scope === "both") {
					const ref = factItemRef(name, data);
					if (ref) dirtyItems.set(`${ref.kind}:${ref.id}`, ref);
					else fullNodes = true;
				}
			});
		}, { requires: ["input"] });
	}
	//#endregion
	//#region frontend/systems/render-stage.ts
	/** render.stage owns the stage paint: nodes, edges, overlays, empty state.
	*  Listens for `render.stage.draw` from the render scheduler — never schedules
	*  by itself — and pushes results back through `render.view.set`. This split
	*  lets the scheduler (in `render`) stay in charge of coalescing while the
	*  stage renderer is swappable (HTML today, canvas/webgl tomorrow). */
	function registerRenderStage(system) {
		system("render.stage", (ctx) => {
			const { on, emit, graphs, contexts, model } = ctx;
			const applyAffordance = (el, item, ui) => {
				if (ui.className) el.classList.add(...ui.className.split(/\s+/).filter(Boolean));
				Object.entries(ui.attrs ?? {}).forEach(([name, value]) => el.setAttribute(name, uiValue(value, item)));
			};
			const affordanceButton = (item, actionDef, ui) => {
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.command = ui.command;
				button.textContent = uiValue(ui.text, item, actionDef.label);
				button.setAttribute("aria-label", uiValue(ui.label, item, actionDef.label));
				applyAffordance(button, item, ui);
				return button;
			};
			const wireItemAffordances = (el, entityDef, item) => {
				const grouped = /* @__PURE__ */ new Map();
				contexts.affordances.entity(entityDef).forEach(({ action, ui }) => {
					const slotName = ui.slot ?? Slots.Header;
					(grouped.get(slotName) ?? grouped.set(slotName, []).get(slotName)).push({
						action,
						ui
					});
				});
				grouped.forEach((entries, slotName) => {
					const target = el.querySelector(`[data-slot="${slotName}"]`);
					if (!(target instanceof HTMLElement)) return;
					entries.forEach(({ action, ui }) => {
						if (ui.kind === "handler") applyAffordance(target, item, ui);
						if (ui.kind === "button") target.append(affordanceButton(item, action, ui));
					});
				});
			};
			const applyItemModes = (el, ref) => {
				const classes = [...new Set(contexts.decorations.modes.for(ref).map((mode) => mode.className ?? mode.mode).filter(Boolean))];
				if (!classes.length) return;
				el.classList.add(...classes);
				el.setAttribute("data-item-modes", classes.join(" "));
			};
			/** Compute the bounds rect for any ref by looking up its entity's renderer
			*  and calling its `bounds(item)` (the same hook used for culling). Returns
			*  null when no entity/item/bounds is available — edge renderers fall back
			*  to a small dot at the node's center. */
			const boundsOfRef = (ref) => {
				const entityDef = model.entity(ref.kind);
				const item = graphs.current.getItem(ref);
				if (!entityDef || !item) return null;
				return entityDef.render?.bounds?.(item) ?? null;
			};
			const renderCtxFor = (entityDef, item) => ({
				graph: graphs.current,
				refOf: (id) => {
					const base = {
						kind: entityDef.kind,
						id
					};
					const parent = contexts.hierarchy.parentIds(base);
					return parent ? {
						...base,
						parent
					} : base;
				},
				tagItem,
				applyItemModes,
				wireAffordances: (el) => wireItemAffordances(el, entityDef, item),
				cloneTemplate: (name) => contexts.templates.clone(name),
				templateSlot: (templateRoot, name) => contexts.templates.slot(templateRoot, name),
				templateText: (templateRoot, name, value) => {
					contexts.templates.text(templateRoot, name, value);
				},
				parentChain: (ref) => contexts.hierarchy.parentChain(ref),
				isFolded: (ref) => contexts.fold.folded(itemFoldId(ref, graphs.current.id)),
				boundsOf: boundsOfRef
			});
			/** True when any ancestor of `ref` is `Collapsed`. Collapsed containers
			*  hide their entire subtree — the children stay in the data store (so
			*  expand brings them back instantly), they're just skipped here. */
			const hiddenByCollapsedAncestor = (ref) => foldHidden(ref, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id);
			const syncStageView = () => {
				const stage = contexts.places.el(Places.Stage), view = contexts.view.get();
				if (!stage) return;
				stage.style.setProperty("--grid-size", `${32 * view.scale}px`);
				stage.style.setProperty("--grid-x", `${-view.x * view.scale}px`);
				stage.style.setProperty("--grid-y", `${-view.y * view.scale}px`);
				stage.dataset.zoom = `${Math.round(view.scale * 100)}%`;
			};
			const layerTransform = (view) => `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})`;
			let layer = null;
			let svgLayer = null;
			const els = /* @__PURE__ */ new Map();
			const sigCache = /* @__PURE__ */ new Map();
			const cacheSig = (k, def, item) => {
				const sig = def.render?.signature?.(item);
				if (sig === void 0) sigCache.delete(k);
				else sigCache.set(k, sig);
			};
			const keyOf = (ref) => `${ref.kind}:${ref.id}:${(ref.parent ?? []).join("/")}`;
			const refOf = (kind, item) => {
				const id = item.id;
				if (!id) return null;
				const ref = {
					kind,
					id
				};
				const parent = contexts.hierarchy.parentIds(ref);
				if (parent) ref.parent = parent;
				return ref;
			};
			const targetLayer = (renderer) => renderer.layer === "svg" ? svgLayer : layer;
			const stableZ = (ref, el) => {
				if (ref.kind !== "node") return;
				const seq = parseInt(ref.id.replace(/^\D+/, ""), 10);
				if (Number.isFinite(seq)) el.style.zIndex = String(seq);
			};
			const CULL_MARGIN = 200;
			const visibleNodeIds = () => {
				const rect = contexts.view.visibleRect(Places.Stage, CULL_MARGIN);
				if (!rect) return null;
				const ids = graphs.current.nodeIdsInRect(rect);
				ctx.perf.sample("Render.stage.visibleNodeCandidates", ids.length);
				return new Set(ids);
			};
			/** Everything that should currently be on the stage, keyed by element key. */
			const collectDesired = (visible) => {
				const desired = /* @__PURE__ */ new Map();
				const hidden = (r) => hiddenByCollapsedAncestor({
					kind: r.kind,
					id: r.id
				});
				model.entities().forEach((def) => {
					const renderer = def.render;
					if (!renderer) return;
					(renderer.collect ? renderer.collect(graphs.current, hidden, visible) : graphs.current.itemsOfKind(def.kind)).forEach((item) => {
						const ref = refOf(def.kind, item);
						if (!ref) return;
						if (def.kind !== "edge" && hiddenByCollapsedAncestor(ref)) return;
						desired.set(keyOf(ref), {
							ref,
							def,
							item
						});
					});
				});
				ctx.perf.sample("Render.stage.desiredItems", desired.size);
				return desired;
			};
			/** Reconcile the DOM to the desired set. `rebuild` makes a fresh layer (first
			*  paint / graph switch); otherwise it diffs against the live layer — pan/zoom
			*  only insert nodes entering the viewport and remove those leaving, never
			*  touching the elements that stay (so camera moves are O(delta)). */
			const reconcile = (rebuild) => {
				syncStageView();
				const fresh = rebuild || !layer;
				if (fresh) {
					layer = contexts.templates.clone("nodes");
					svgLayer = contexts.templates.slot(layer, "edges");
					els.clear();
					sigCache.clear();
				}
				layer.style.transform = layerTransform(contexts.view.get());
				const desired = collectDesired(visibleNodeIds());
				let removed = 0;
				let inserted = 0;
				[...els.keys()].forEach((k) => {
					if (!desired.has(k)) {
						els.get(k)?.remove();
						els.delete(k);
						sigCache.delete(k);
						removed++;
					}
				});
				desired.forEach(({ ref, def, item }, k) => {
					if (els.has(k)) return;
					const el = ctx.perf.measure(`Render.entity.${def.kind}.draw`, () => def.render.draw(item, renderCtxFor(def, item)));
					if (el) {
						stableZ(ref, el);
						targetLayer(def.render).append(el);
						els.set(k, el);
						cacheSig(k, def, item);
						inserted++;
					}
				});
				ctx.perf.count("Render.stage.itemsInserted", inserted);
				ctx.perf.count("Render.stage.itemsRemoved", removed);
				ctx.perf.sample("Render.stage.liveItems", els.size);
				if (fresh) emit("render.view.set", {
					place: Places.Stage,
					key: "nodes",
					view: layer
				});
			};
			const drawAll = () => reconcile(true);
			/** Patch one item in place: insert / replace / remove. `visible` gates node
			*  membership so a patched node that moved out of the viewport is dropped. */
			const patchOne = (ref, visible) => {
				const k = keyOf(ref);
				const existing = els.get(k);
				const entityDef = model.entity(ref.kind);
				const renderer = entityDef?.render;
				const item = renderer ? graphs.current.getItem(ref) : void 0;
				const culled = ref.kind === "node" && !!visible && !visible.has(ref.id);
				const edgeCulled = ref.kind === "edge" && !!visible && !!item && !visible.has(item.From ?? "") && !visible.has(item.To ?? "");
				const hidden = ref.kind !== "edge" && hiddenByCollapsedAncestor(ref) || culled || edgeCulled;
				if (!renderer || !item || hidden) {
					existing?.remove();
					els.delete(k);
					sigCache.delete(k);
					return;
				}
				if (existing && renderer.reposition && renderer.signature && renderer.signature(item) === sigCache.get(k)) {
					renderer.reposition(existing, item);
					return;
				}
				const fresh = ctx.perf.measure(`Render.entity.${ref.kind}.draw`, () => renderer.draw(item, renderCtxFor(entityDef, item)));
				if (!fresh) {
					existing?.remove();
					els.delete(k);
					sigCache.delete(k);
					return;
				}
				stableZ(ref, fresh);
				if (existing) existing.replaceWith(fresh);
				else targetLayer(renderer).append(fresh);
				els.set(k, fresh);
				cacheSig(k, entityDef, item);
			};
			/** Patch the changed refs (+ edges incident to any moved node, whose paths
			*  depend on endpoint positions). Falls back to a full rebuild if the layer
			*  isn't built yet. */
			const patchItems = (refs) => {
				if (!layer) {
					drawAll();
					return;
				}
				syncStageView();
				layer.style.transform = layerTransform(contexts.view.get());
				const norm = (ref) => {
					const parent = contexts.hierarchy.parentIds(ref);
					return parent ? {
						...ref,
						parent
					} : ref;
				};
				const todo = /* @__PURE__ */ new Map();
				refs.forEach((r0) => {
					const ref = norm(r0);
					todo.set(keyOf(ref), ref);
					if (ref.kind === "node") graphs.current.edgesOf(ref.id).forEach((e) => {
						const er = norm(edgeRef(e.id));
						todo.set(keyOf(er), er);
					});
				});
				const visible = visibleNodeIds();
				ctx.perf.sample("Render.stage.patchRefs", refs.length);
				ctx.perf.sample("Render.stage.patchItems", todo.size);
				todo.forEach((ref) => patchOne(ref, visible));
				ctx.perf.sample("Render.stage.liveItems", els.size);
			};
			let overlaysMounted = false;
			const drawStageOverlays = () => {
				const overlays = contexts.decorations.overlays.all();
				if (!overlays.length) {
					if (overlaysMounted) {
						overlaysMounted = false;
						emit("render.view.clear", {
							place: Places.Stage,
							key: "overlays"
						});
					}
					return;
				}
				overlaysMounted = true;
				emit("render.view.set", {
					place: Places.Stage,
					key: "overlays",
					view: () => {
						const layer = document.createElement("div");
						layer.className = "item-overlays";
						overlays.forEach((overlay) => {
							const anchor = contexts.hierarchy.anchor(overlay.ref);
							if (!anchor) return;
							const screen = contexts.view.spaceToScreen(anchor);
							const el = document.createElement("div");
							el.className = "item-overlay";
							if (overlay.className) el.classList.add(...overlay.className.split(/\s+/).filter(Boolean));
							tagItem(el, overlay.ref);
							if (overlay.id) el.dataset.overlayId = overlay.id;
							el.textContent = overlay.text;
							el.style.left = `${screen.x}px`;
							el.style.top = `${screen.y}px`;
							layer.append(el);
						});
						return layer;
					}
				});
			};
			let emptyMounted = false;
			const drawEmptyState = () => {
				if (model.entities().some((entityDef) => entityDef.render && graphs.current.itemsOfKind(entityDef.kind).length > 0)) {
					if (emptyMounted) {
						emptyMounted = false;
						emit("render.view.clear", {
							place: Places.Stage,
							key: "empty"
						});
					}
					return;
				}
				emptyMounted = true;
				emit("render.view.set", {
					place: Places.Stage,
					key: "empty",
					view: () => {
						const shortcut = commandShortcut(contexts.commands, "editing.node.create");
						const hint = shortcut ? kbdHint("Press ", shortcut, " to add a node") : void 0;
						return emptyState(contexts.templates, "No nodes in this graph yet", hint) ?? document.createDocumentFragment();
					}
				});
			};
			/** Camera-only redraw: pan/zoom moved the view but no entity changed. Move
			*  the persistent layer's transform + grid in place — O(1), no rebuild.
			*  Overlays are screen-positioned, so refresh those too (usually none). */
			const applyCamera = () => {
				if (layer) reconcile(false);
				else syncStageView();
				drawStageOverlays();
			};
			on("render.stage.draw", ({ full, refs }) => {
				ctx.perf.measure("Render.stage.draw", () => {
					if (full || !refs?.length || !layer) {
						ctx.perf.count("Render.stage.fullDraw");
						drawAll();
					} else {
						ctx.perf.count("Render.stage.patchDraw");
						patchItems(refs);
					}
					drawStageOverlays();
					drawEmptyState();
				});
			});
			on("render.stage.camera", () => {
				ctx.perf.count("Render.stage.cameraDraw");
				ctx.perf.measure("Render.stage.camera", applyCamera);
			});
			on("drag.item.start", () => contexts.places.el(Places.Stage)?.classList.add("dragging"));
			on("drag.item.end", () => contexts.places.el(Places.Stage)?.classList.remove("dragging"));
		}, { requires: ["render", "graph"] });
	}
	//#endregion
	//#region frontend/systems/scenario.ts
	/** Quote-aware tokenizer: `;`-separated, but quoted text may contain `;`/spaces. */
	function parseScenario(script) {
		const tokens = [];
		let i = 0;
		const s = script.trim();
		while (i < s.length) {
			const ch = s[i];
			if (ch === ";" || ch === " ") {
				i++;
				continue;
			}
			if (ch === "\"" || ch === "'") {
				let j = i + 1, text = "";
				while (j < s.length && s[j] !== ch) {
					text += s[j];
					j++;
				}
				tokens.push({
					kind: "type",
					value: text
				});
				i = j + 1;
			} else {
				let j = i, raw = "";
				while (j < s.length && s[j] !== ";") {
					raw += s[j];
					j++;
				}
				raw = raw.trim();
				if (raw) tokens.push(raw.toLowerCase() === "wait" ? { kind: "wait" } : {
					kind: "key",
					value: raw
				});
				i = j + 1;
			}
		}
		return tokens;
	}
	var KEY_ALIASES = {
		space: " ",
		enter: "Enter",
		tab: "Tab",
		escape: "Escape",
		esc: "Escape",
		backspace: "Backspace",
		delete: "Delete"
	};
	function registerScenario(system) {
		system("scenario", ({ on, emit, contexts, expose, origin }) => {
			let hud = null;
			let timer = null;
			const shell = () => contexts.places.el(Places.Top)?.parentElement ?? null;
			const ensureHud = () => {
				if (hud && hud.isConnected) return hud;
				const el = document.createElement("div");
				el.className = "scenario-hud";
				el.dataset.scenario = origin;
				shell()?.append(el);
				hud = el;
				return el;
			};
			const setHud = (text, done = false) => {
				const el = ensureHud();
				el.textContent = text;
				el.classList.toggle("done", done);
			};
			const clearHud = () => {
				hud?.remove();
				hud = null;
			};
			/** Synthesize one keydown on the focused element (falls back to document) so
			*  the keystroke flows through the real input router / active capture. */
			const pressKey = (token) => {
				const p = parseShortcut(token);
				const key = KEY_ALIASES[p.key.toLowerCase()] ?? p.key;
				const active = document.activeElement;
				(active instanceof Element && active.isConnected && active !== document.body ? active : document.body).dispatchEvent(new KeyboardEvent("keydown", {
					key,
					shiftKey: p.shift,
					ctrlKey: p.ctrl,
					altKey: p.alt,
					metaKey: p.meta,
					bubbles: true,
					cancelable: true
				}));
			};
			/** Type text into the focused inline editor (contenteditable or input). */
			const typeText = (text) => {
				const el = document.activeElement;
				if (!el || el === document.body) return;
				if (el.isContentEditable) {
					el.textContent = text;
					el.dispatchEvent(new InputEvent("input", { bubbles: true }));
				} else if ("value" in el) {
					el.value = text;
					el.dispatchEvent(new InputEvent("input", { bubbles: true }));
				}
			};
			const play = (script, speed = 650) => {
				const tokens = parseScenario(script);
				if (!tokens.length) return;
				let index = 0;
				const human = (t) => t.kind === "type" ? `"${t.value}"` : t.kind === "wait" ? "⏸" : t.value;
				const tick = () => {
					if (index >= tokens.length) {
						setHud(`✓ scenario complete · ${tokens.length} steps`, true);
						emit("scenario.done");
						timer = setTimeout(clearHud, 4e3);
						return;
					}
					const token = tokens[index];
					setHud(`▶ step ${index + 1}/${tokens.length} · ${human(token)}`);
					emit("scenario.step", {
						index,
						total: tokens.length,
						token: human(token)
					});
					if (token.kind === "key") pressKey(token.value);
					else if (token.kind === "type") typeText(token.value);
					index++;
					timer = setTimeout(tick, token.kind === "wait" ? speed * 2 : speed);
				};
				setHud(`▶ scenario · ${tokens.length} steps`);
				timer = setTimeout(tick, speed);
			};
			contexts.commands.register([{
				id: "scenario.play",
				label: "Play scenario",
				group: "scenario",
				hidden: true,
				payload: () => ({ script: "" })
			}]);
			on("scenario.play", ({ script, speed }) => {
				if (script) play(script, speed);
			});
			expose("scenario", { play: (script, opts) => play(script, opts?.speed) });
			on("app.start", () => {
				const param = new URLSearchParams(location.search).get("scenario");
				if (param) play(param);
			});
			return () => {
				if (timer) clearTimeout(timer);
				clearHud();
			};
		}, { requires: ["input", "render"] });
	}
	//#endregion
	//#region frontend/systems/share.ts
	var bytesToBase64Url = (bytes) => {
		let binary = "";
		bytes.forEach((byte) => {
			binary += String.fromCharCode(byte);
		});
		return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
	};
	var base64UrlToBytes = (value) => {
		const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
		const binary = atob(padded);
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	};
	var streamBytes = async (bytes, transform, mode) => {
		const stream = new (mode === "compress" ? CompressionStream : DecompressionStream)(transform);
		const writer = stream.writable.getWriter();
		writer.write(bytes);
		writer.close();
		const reader = stream.readable.getReader();
		const chunks = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.length;
		}
		const out = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out;
	};
	var deflate = (bytes) => streamBytes(bytes, "deflate-raw", "compress");
	var inflateRaw = (bytes) => streamBytes(bytes, "deflate-raw", "decompress");
	var inflateZlib = (bytes) => streamBytes(bytes, "deflate", "decompress");
	var toCompact = (snapshot) => ({
		v: 3,
		n: snapshot.nodes.map((node) => [
			node.id,
			node.Label?.text ?? node.id,
			node.NodeType ?? "text",
			Math.round(node.Position?.x ?? 0),
			Math.round(node.Position?.y ?? 0),
			Math.round(node.Size?.w ?? 200),
			Math.round(node.Size?.h ?? 120),
			node.Description || void 0
		]),
		e: snapshot.edges.map((edge) => [
			edge.id,
			edge.From,
			edge.To,
			edge.EdgeKind || void 0,
			edge.Label?.text || void 0
		])
	});
	var fromCompact = (compact) => ({
		nodes: compact.n.map(([id, title, NodeType, x, y, w, h, Description]) => ({
			id,
			Label: { text: title },
			NodeType,
			Position: {
				x,
				y
			},
			Size: {
				w,
				h
			},
			...Description ? { Description } : {}
		})),
		edges: compact.e.map(([id, From, To, EdgeKind, label]) => ({
			id,
			From,
			To,
			...EdgeKind ? { EdgeKind } : {},
			...label ? { Label: { text: label } } : {}
		}))
	});
	/** Compressed graph payload for `?g=`. Prefixed with `~` so the decoder can tell
	*  it apart from the legacy uncompressed base64-JSON form (backward compatible). */
	var encodeGraph = async (snapshot) => {
		return "~" + bytesToBase64Url(await deflate(new TextEncoder().encode(JSON.stringify(toCompact(snapshot)))));
	};
	var decodeGraph = async (encoded) => {
		try {
			if (encoded.startsWith("~")) {
				const bytes = await inflateRaw(base64UrlToBytes(encoded.slice(1)));
				return fromCompact(JSON.parse(new TextDecoder().decode(bytes)));
			}
			const raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
			if (!Array.isArray(raw.n) || !Array.isArray(raw.e)) return null;
			return fromCompact(raw);
		} catch {
			return null;
		}
	};
	var mermaidLivePayload = (link) => {
		const hash = link.includes("#") ? link.slice(link.indexOf("#") + 1) : link;
		const m = /(pako|base64):([A-Za-z0-9\-_+/=]+)/.exec(hash);
		return m ? {
			kind: m[1],
			data: m[2]
		} : null;
	};
	var decodeMermaidLive = async (link) => {
		const payload = mermaidLivePayload(link);
		if (!payload) return null;
		try {
			const bytes = base64UrlToBytes(payload.data);
			const json = payload.kind === "pako" ? new TextDecoder().decode(await inflateZlib(bytes)) : new TextDecoder().decode(bytes);
			const parsed = JSON.parse(json);
			return typeof parsed.code === "string" ? parsed.code : null;
		} catch {
			return null;
		}
	};
	var HTML_ENTITIES = {
		"&gt;": ">",
		"&lt;": "<",
		"&amp;": "&",
		"&quot;": "\"",
		"&#39;": "'",
		"&nbsp;": " ",
		"#quot;": "\""
	};
	var cleanLabel = (raw) => {
		let s = raw.trim().replace(/^`+|`+$/g, "").trim();
		s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(h[1-6]|p|li|ul|ol|div)>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<[^>]+>/g, "");
		s = s.replace(/&#\d+;|#quot;|&[a-z]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? HTML_ENTITIES[m] ?? m);
		return s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
	};
	var splitLabel = (raw) => {
		const lines = cleanLabel(raw).split("\n");
		return {
			title: lines[0] ?? "",
			description: lines.slice(1).join("\n") || void 0
		};
	};
	var SHAPE_CLOSE = {
		"[": "]",
		"(": ")",
		"{": "}",
		">": "]"
	};
	var IDENT = /[A-Za-z0-9_.-]/;
	var parseNode = (s, start) => {
		let i = start;
		while (i < s.length && /\s/.test(s[i])) i++;
		const idStart = i;
		while (i < s.length && IDENT.test(s[i])) i++;
		if (i === idStart) return null;
		const id = s.slice(idStart, i);
		const open = s[i];
		if (open && SHAPE_CLOSE[open]) {
			const close = SHAPE_CLOSE[open];
			let depth = 0, inQuote = false, j = i;
			for (; j < s.length; j++) {
				const ch = s[j];
				if (ch === "\"") inQuote = !inQuote;
				else if (!inQuote && (ch === open || open === "(" && ch === "(")) depth++;
				else if (!inQuote && ch === close) {
					depth--;
					if (depth === 0) {
						j++;
						break;
					}
				}
			}
			return {
				id,
				label: s.slice(i, j).replace(/^[[({>]+/, "").replace(/[\])}]+$/, "").replace(/^"|"$/g, ""),
				end: j
			};
		}
		return {
			id,
			end: i
		};
	};
	var LINK = /^\s*(?:--+\s*(?:"((?:[^"]|\n)*?)"|([^|>\n]*?))\s*)?(<--+>|--+>|--+|-\.-+>|-\.-+|==+>|==+|--[xo])\s*(?:\|\s*(?:"((?:[^"]|\n)*?)"|([^|]*))\s*\|)?/;
	var parseMermaid = (source) => {
		let src = source.replace(/^﻿/, "");
		src = src.replace(/^\s*---[\s\S]*?---\s*/, "");
		const statements = [];
		let depth = 0, inQuote = false, buf = "";
		for (const ch of src) {
			if (ch === "\"") {
				inQuote = !inQuote;
				buf += ch;
				continue;
			}
			if (!inQuote) {
				if (ch === "[" || ch === "(" || ch === "{") depth++;
				else if (ch === "]" || ch === ")" || ch === "}") depth = Math.max(0, depth - 1);
				if ((ch === "\n" || ch === ";") && depth === 0) {
					statements.push(buf);
					buf = "";
					continue;
				}
			}
			buf += ch;
		}
		statements.push(buf);
		const SKIP = /^\s*(flowchart|graph|sequenceDiagram|subgraph|end\b|classDef|class\s|style\s|linkStyle|click\s|direction\s|%%|title:|accTitle|accDescr)/;
		const nodes = /* @__PURE__ */ new Map();
		const edges = [];
		const note = (id, label) => {
			const existing = nodes.get(id);
			if (!existing) nodes.set(id, {
				id,
				label
			});
			else if (label && !existing.label) existing.label = label;
		};
		for (const stmt of statements) {
			const line = stmt.trim();
			if (!line || SKIP.test(line)) continue;
			let cur = parseNode(stmt, 0);
			if (!cur) continue;
			note(cur.id, cur.label);
			let cursor = cur.end;
			while (cursor < stmt.length) {
				const rest = stmt.slice(cursor);
				const link = LINK.exec(rest);
				if (!link) break;
				const next = parseNode(stmt, cursor + link[0].length);
				if (!next) break;
				note(next.id, next.label);
				const label = link[1] ?? link[2] ?? link[4] ?? link[5];
				edges.push({
					from: cur.id,
					to: next.id,
					label: label?.trim() || void 0
				});
				cur = next;
				cursor = next.end;
			}
		}
		return {
			nodes: [...nodes.values()],
			edges
		};
	};
	/** mermaid text (or link) -> snapshot with a simple grid layout so it lands
	*  laid-out; caller fits + tidies. Returns null when nothing parseable. */
	var mermaidToSnapshot = async (input) => {
		const source = mermaidLivePayload(input) ? await decodeMermaidLive(input) : input;
		if (!source) return null;
		const { nodes, edges } = parseMermaid(source);
		if (!nodes.length) return null;
		const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
		const CW = 300, CH = 200;
		return {
			nodes: nodes.map((node, i) => {
				const { title, description } = splitLabel(node.label ?? node.id);
				return {
					id: node.id,
					Label: { text: title || node.id },
					NodeType: "text",
					Position: {
						x: i % cols * CW,
						y: Math.floor(i / cols) * CH
					},
					Size: {
						w: 220,
						h: 120
					},
					...description ? { Description: description } : {}
				};
			}),
			edges: edges.map((edge, i) => ({
				id: `m-e-${i}`,
				From: edge.from,
				To: edge.to,
				EdgeKind: "sync",
				...edge.label ? { Label: { text: cleanLabel(edge.label) } } : {}
			}))
		};
	};
	var looksLikeMermaid = (text) => /(^|\n)\s*(flowchart|graph\s+(TD|TB|BT|LR|RL))/i.test(text) || !!mermaidLivePayload(text) || /-->|---|-\.->|==>/.test(text) && /[A-Za-z0-9_]/.test(text);
	function registerShare(system) {
		system("share", ({ on, emit, contexts, graphs }) => {
			contexts.commands.register([
				{
					id: "graph.share.copy",
					label: "Copy share link",
					group: "graph"
				},
				{
					id: "graph.import.paste",
					label: "Import graph from clipboard",
					group: "graph"
				},
				{
					id: "graph.import.mermaid.paste-event",
					label: "Import pasted mermaid graph",
					event: "graph.import.mermaid",
					group: "graph",
					hidden: true,
					input: {
						on: "paste",
						global: true,
						prevent: true,
						when: (event) => {
							const target = event.target;
							if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) return false;
							const text = event.clipboardData?.getData("text") ?? "";
							return !!text && looksLikeMermaid(text);
						}
					},
					payload: ({ event }) => ({ source: event.clipboardData?.getData("text") ?? "" })
				}
			]);
			const importSnapshot = (snapshot, tidy = false) => {
				emit("graph.import.snapshot", snapshot);
				if (tidy) emit("layout.apply.tidy");
				emit("view.fit.all");
			};
			on("graph.share.copy", () => {
				(async () => {
					const encoded = await encodeGraph(graphs.current.snapshot());
					const url = new URL(location.href);
					url.hash = "";
					url.searchParams.delete("in");
					url.searchParams.set("g", encoded);
					await navigator.clipboard?.writeText?.(url.toString()).catch(() => {});
					emit("graph.shared", { url: url.toString() });
					emit("app.notice", { message: "Share link copied." });
				})();
			});
			on("graph.import.mermaid", ({ source }) => {
				(async () => {
					const snapshot = await mermaidToSnapshot(source);
					if (!snapshot) {
						emit("app.notice", {
							message: "Could not read a mermaid graph from that.",
							level: "warn"
						});
						return;
					}
					importSnapshot(snapshot, true);
					emit("app.notice", { message: `Imported ${snapshot.nodes.length} nodes from mermaid.` });
				})();
			});
			on("graph.import.paste", () => {
				(async () => {
					const text = await navigator.clipboard?.readText?.().catch(() => "");
					if (text) emit("graph.import.mermaid", { source: text });
				})();
			});
			const bootFromUrl = () => {
				const params = new URLSearchParams(location.search);
				const g = params.get("g");
				const incoming = params.get("in");
				if (g) {
					decodeGraph(g).then((snapshot) => {
						if (snapshot) importSnapshot(snapshot);
						else emit("app.notice", {
							message: "Share link graph could not be decoded.",
							level: "warn"
						});
					});
					return;
				}
				if (incoming) emit("graph.import.mermaid", { source: incoming });
			};
			on("app.start", bootFromUrl);
		}, { requires: ["graph"] });
	}
	//#endregion
	//#region frontend/systems/tool-panel.ts
	var TOP_PANEL_ID = "top";
	var ZEN_FOLD_ID = "shell.zen";
	function registerToolPanel(system) {
		system("tool.panel", ({ on, emit, contexts, declarePanel }) => {
			const positions = /* @__PURE__ */ new Map();
			const mounted = /* @__PURE__ */ new Set();
			let drag = null;
			const keyOf = (id) => `tool-panel:${id}`;
			const stageRect = () => contexts.places.el(Places.Stage)?.getBoundingClientRect();
			const clampPosition = (pos) => {
				const rect = stageRect();
				if (!rect) return pos;
				return {
					x: Math.max(0, Math.min(pos.x, Math.max(0, rect.width - 48))),
					y: Math.max(0, Math.min(pos.y, Math.max(0, rect.height - 32)))
				};
			};
			const panels = () => contexts.affordances.panels();
			const panelById = (id) => panels().find((p) => p.id === id);
			const anchorPosition = (panel) => {
				const rect = stageRect();
				const margin = 12;
				return {
					x: panel.anchor.endsWith("right") && rect ? Math.max(margin, rect.width - 180 - margin) : margin,
					y: panel.anchor === "middle-right" && rect ? Math.max(margin, rect.height / 2 - 120) : panel.anchor.startsWith("bottom") && rect ? Math.max(margin, rect.height - 44 - margin) : margin
				};
			};
			const panelPosition = (panel) => positions.get(panel.id) ?? anchorPosition(panel);
			const isCollapsed = (panel) => panel.foldId ? contexts.fold.folded(panel.foldId) : false;
			const buttonsFor = (panelId) => contexts.affordances.system("top").filter((aff) => (aff.panel ?? TOP_PANEL_ID) === panelId);
			declarePanel({
				id: TOP_PANEL_ID,
				anchor: "top-center",
				movable: false,
				layout: "toolbar",
				order: 0
			});
			contexts.commands.register([
				{
					id: "tool.panel.drag.start",
					label: "Start moving tool panel",
					group: "tool-panel",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: "[data-tool-panel-drag]",
						prevent: true,
						stop: true
					},
					payload: ({ event, target }) => ({
						id: target.dataset.toolPanelDrag ?? "",
						x: event.clientX,
						y: event.clientY
					})
				},
				{
					id: "tool.panel.drag.move",
					label: "Move tool panel",
					group: "tool-panel",
					hidden: true,
					input: {
						on: "pointermove",
						when: () => !!drag,
						prevent: true,
						stop: true
					},
					payload: ({ event }) => ({
						x: event.clientX,
						y: event.clientY
					})
				},
				{
					id: "tool.panel.drag.end",
					label: "Stop moving tool panel",
					group: "tool-panel",
					hidden: true,
					input: {
						on: "pointerup",
						when: () => !!drag,
						stop: true
					}
				}
			]);
			const buttonFor = (commandId, text, label) => {
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.command = commandId;
				button.textContent = text;
				if (label) button.setAttribute("aria-label", label);
				return button;
			};
			const dragHandle = (id) => {
				const handle = document.createElement("button");
				handle.type = "button";
				handle.className = "tool-panel-drag";
				handle.dataset.toolPanelDrag = id;
				handle.setAttribute("aria-label", "Move tool panel");
				handle.textContent = "⋮⋮";
				return handle;
			};
			const collapseToggle = (panel, collapsed) => {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "tool-panel-collapse";
				btn.dataset.foldId = panel.foldId ?? "";
				btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
				btn.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
				btn.textContent = collapsed ? "▾" : "▴";
				return btn;
			};
			const addButton = (parent, aff) => {
				const cmd = contexts.commands.get(aff.command);
				if (cmd?.available && !cmd.available()) return;
				const button = buttonFor(aff.command, aff.text ?? aff.command, aff.label);
				const shortcut = commandShortcut(contexts.commands, aff.command);
				if (shortcut) button.title = shortcut;
				if (aff.className) button.classList.add(...aff.className.split(/\s+/).filter(Boolean));
				parent.append(button);
			};
			const groupTarget = (start, groups, group) => {
				if (!group) return start;
				let el = groups.get(group);
				if (!el) {
					el = document.createElement("div");
					el.className = "tool-group";
					el.dataset.group = group;
					start.append(el);
					groups.set(group, el);
				}
				return el;
			};
			const fillToolbar = (panel, section) => {
				const toolbar = contexts.templates.clone("toolbar");
				const start = contexts.templates.slot(toolbar, "start");
				const end = contexts.templates.slot(toolbar, "end");
				const groups = /* @__PURE__ */ new Map();
				buttonsFor(panel.id).forEach((aff) => {
					if (aff.slot === Slots.End) addButton(end, aff);
					else addButton(groupTarget(start, groups, aff.group), aff);
				});
				section.append(toolbar);
			};
			const fillStack = (panel, section) => {
				const body = document.createElement("div");
				body.className = "tool-panel-body";
				buttonsFor(panel.id).forEach((aff) => addButton(body, aff));
				section.append(body);
			};
			const drawPanel = (panel) => {
				const key = keyOf(panel.id);
				if (panel.mountWhen && !panel.mountWhen()) {
					if (mounted.delete(key)) emit("render.view.clear", {
						place: Places.Stage,
						key
					});
					return;
				}
				mounted.add(key);
				emit("render.view.set", {
					place: Places.Stage,
					key,
					view: () => {
						const collapsed = isCollapsed(panel);
						const section = document.createElement("section");
						section.className = `tool-panel${panel.layout === "toolbar" ? " top-tool-panel" : " tool-panel-stack"}`;
						section.dataset.panelId = panel.id;
						section.dataset.collapsed = collapsed ? "true" : "false";
						const dragged = positions.get(panel.id);
						if (dragged) {
							section.style.left = `${dragged.x}px`;
							section.style.top = `${dragged.y}px`;
						} else section.dataset.anchor = panel.anchor;
						const head = document.createElement("div");
						head.className = "tool-panel-head";
						if (panel.movable) head.append(dragHandle(panel.id));
						if (panel.foldId) head.append(collapseToggle(panel, collapsed));
						if (head.childElementCount) section.append(head);
						if (collapsed) return section;
						if (panel.layout === "toolbar") fillToolbar(panel, section);
						else fillStack(panel, section);
						return section;
					}
				});
			};
			const drawPanels = () => {
				const live = new Set(panels().map((p) => keyOf(p.id)));
				for (const key of [...mounted]) if (!live.has(key)) {
					emit("render.view.clear", {
						place: Places.Stage,
						key
					});
					mounted.delete(key);
				}
				panels().forEach(drawPanel);
			};
			on("tool.panel.drag.start", ({ id, x, y }) => {
				const panel = panelById(id);
				if (!panel) return;
				drag = {
					id,
					pointer: {
						x,
						y
					},
					start: panelPosition(panel)
				};
			});
			on("tool.panel.drag.move", ({ x, y }) => {
				if (!drag) return;
				const position = clampPosition({
					x: drag.start.x + x - drag.pointer.x,
					y: drag.start.y + y - drag.pointer.y
				});
				positions.set(drag.id, position);
				emit("tool.panel.moved", {
					id: drag.id,
					position
				});
				drawPanels();
			});
			on("tool.panel.drag.end", () => {
				drag = null;
			});
			on("app.start", drawPanels);
			on("affordance.contributed", ({ surface }) => {
				if (surface === "top") drawPanels();
			});
			on("fold.changed", ({ id }) => {
				if (id === ZEN_FOLD_ID || panels().some((p) => p.foldId === id)) drawPanels();
			});
			on("debug.enabled.changed", drawPanels);
			on("debug.recording.changed", drawPanels);
			on("selection.changed", () => {
				if (panels().some((p) => p.mountWhen)) drawPanels();
			});
		}, { requires: ["render.stage"] });
	}
	//#endregion
	//#region frontend/systems/varflow.ts
	function nodeTypeFor(n) {
		const fx = n.effects ?? [];
		if (fx.includes("db")) return "database";
		switch (n.kind) {
			case "entrypoint": return "gateway";
			case "router": return "service";
			case "file":
				if (fx.includes("network")) return "service";
				if (fx.includes("io-read") || fx.includes("io-write")) return "index";
				return "square";
			default: return "text";
		}
	}
	function edgeKindFor(e) {
		if (e.kind === "api-call") return "async";
		if (e.cross) return "async";
		return "sync";
	}
	var KIND_ORDER = {
		router: 0,
		entrypoint: 1,
		file: 2
	};
	var CELL_W = 192, CELL_H = 106, CLUSTER_GAP = 54, MIN_ROW_TARGET = 520, MAX_ROW_TARGET = 1180;
	var DEFAULT_OVERVIEW_MAX = 18;
	var DEFAULT_FOCUS_MAX = 24;
	var clamp = (n, min, max) => Math.max(min, Math.min(max, n));
	var idSet = (nodes) => new Set(nodes.map((n) => n.id));
	var edgeScore = (e) => {
		if (e.kind === "api-call") return 120;
		if (e.cross) return 110;
		if (e.kind === "registers") return 80;
		if (e.kind === "writes-to" || e.kind === "reads-from") return 70;
		return 20;
	};
	var nodeScore = (n, incident) => {
		let score = 0;
		if (n.kind === "router") score += 120;
		if (n.kind === "entrypoint") score += 110;
		if (incident.some((e) => e.kind === "api-call" || e.cross)) score += 90;
		if (n.effects?.includes("db")) score += 55;
		if (n.effects?.includes("network")) score += 45;
		if (n.effects?.includes("io-write") || n.effects?.includes("io-read")) score += 35;
		if (n.effects?.includes("process")) score += 15;
		if (n.service === "openapi" || n.file?.includes("/e2e/") || n.file?.includes("/gen/")) score -= 70;
		return score;
	};
	function incidentEdges(g) {
		const out = /* @__PURE__ */ new Map();
		(g.edges ?? []).forEach((e) => {
			(out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e);
			(out.get(e.to) ?? out.set(e.to, []).get(e.to)).push(e);
		});
		return out;
	}
	function bestPathIds(g, through) {
		const edges = g.edges ?? [];
		const byId = new Map((g.nodes ?? []).map((n) => [n.id, n]));
		const byFrom = /* @__PURE__ */ new Map();
		const byTo = /* @__PURE__ */ new Map();
		edges.forEach((e) => {
			(byFrom.get(e.from) ?? byFrom.set(e.from, []).get(e.from)).push(e);
			(byTo.get(e.to) ?? byTo.set(e.to, []).get(e.to)).push(e);
		});
		const rank = (e) => edgeScore(e) - (byId.get(e.from)?.service === "openapi" ? 55 : 0) - (byId.get(e.to)?.service === "openapi" ? 55 : 0);
		const pick = (list) => [...list ?? []].sort((a, b) => rank(b) - rank(a))[0];
		const seed = through ? void 0 : [...edges].sort((a, b) => rank(b) - rank(a))[0];
		const ids = /* @__PURE__ */ new Set();
		let current = through ?? seed?.to;
		if (seed) {
			ids.add(seed.from);
			ids.add(seed.to);
		}
		if (current) ids.add(current);
		for (let i = 0; i < 3 && current; i++) {
			const e = pick(byTo.get(current));
			if (!e || ids.has(e.from)) break;
			ids.add(e.from);
			current = e.from;
		}
		current = through ?? seed?.from;
		for (let i = 0; i < 3 && current; i++) {
			const e = pick(byFrom.get(current));
			if (!e || ids.has(e.to)) break;
			ids.add(e.to);
			current = e.to;
		}
		return ids;
	}
	function filteredGraph(g, keep, maxEdges) {
		const nodes = (g.nodes ?? []).filter((n) => keep.has(n.id));
		const present = idSet(nodes);
		const edges = (g.edges ?? []).filter((e) => present.has(e.from) && present.has(e.to) && e.from !== e.to).sort((a, b) => edgeScore(b) - edgeScore(a)).slice(0, maxEdges);
		const services = (g.services ?? []).filter((s) => {
			const name = typeof s === "object" && s && "name" in s ? String(s.name) : "";
			return nodes.some((n) => n.service === name);
		});
		return {
			services: services.length ? services : g.services,
			nodes,
			edges
		};
	}
	function readableGraph(g, opts = {}) {
		const rawNodes = g.nodes ?? [];
		const rawEdges = g.edges ?? [];
		const byId = new Map(rawNodes.map((n) => [n.id, n]));
		const totalNodes = rawNodes.length;
		const totalEdges = rawEdges.length;
		if (opts.layout === "flow" || opts.readMode === "all" || totalNodes <= (opts.maxOverviewNodes ?? DEFAULT_OVERVIEW_MAX)) return {
			graph: g,
			totalNodes,
			totalEdges,
			visibleNodes: totalNodes,
			visibleEdges: totalEdges,
			mode: "all"
		};
		const incident = incidentEdges(g);
		const maxNodes = opts.focusNodeId ? opts.maxFocusNodes ?? DEFAULT_FOCUS_MAX : opts.maxOverviewNodes ?? DEFAULT_OVERVIEW_MAX;
		const keep = opts.focusNodeId ? bestPathIds(g, opts.focusNodeId) : bestPathIds(g);
		if (opts.focusNodeId) {
			const queue = [{
				id: opts.focusNodeId,
				depth: 0
			}];
			keep.add(opts.focusNodeId);
			const seen = new Set(keep);
			while (queue.length && keep.size < maxNodes) {
				const { id, depth } = queue.shift();
				if (depth >= (opts.expandDepth ?? 1)) continue;
				const next = [...incident.get(id) ?? []].flatMap((e) => [e.from, e.to]).filter((id) => !seen.has(id)).sort((a, b) => nodeScore(byId.get(b) ?? { id: b }, incident.get(b) ?? []) - nodeScore(byId.get(a) ?? { id: a }, incident.get(a) ?? []));
				for (const nid of next) {
					if (keep.size >= maxNodes) break;
					seen.add(nid);
					keep.add(nid);
					queue.push({
						id: nid,
						depth: depth + 1
					});
				}
			}
		} else rawNodes.slice().sort((a, b) => nodeScore(b, incident.get(b.id) ?? []) - nodeScore(a, incident.get(a.id) ?? [])).forEach((n) => {
			if (keep.size < maxNodes && nodeScore(n, incident.get(n.id) ?? []) > 45) keep.add(n.id);
		});
		if (!keep.size) rawNodes.slice(0, maxNodes).forEach((n) => keep.add(n.id));
		const graph = filteredGraph(g, keep, Math.max(80, maxNodes * 3));
		return {
			graph,
			totalNodes,
			totalEdges,
			visibleNodes: graph.nodes?.length ?? 0,
			visibleEdges: graph.edges?.length ?? 0,
			mode: opts.focusNodeId ? "focus" : "overview"
		};
	}
	/**
	* Bounded, service-clustered layout computed up front.
	*
	* The generic `tidy` layout lays every in-degree-zero root on a single row, so a
	* 45-service graph spreads ~50k px wide and cross-service edges fling outliers —
	* `fit` then frames the outliers and the dense middle renders off-screen. Instead
	* we cluster by `service` (the natural repo/bounded-context grouping), grid each
	* cluster, and shelf-pack the clusters. Coordinates stay compact → the camera
	* frames the whole map and viewport culling has real bounds to work with.
	*/
	function assignPositions(sn, meta) {
		const groups = /* @__PURE__ */ new Map();
		for (const n of sn) {
			const svc = meta.get(n.id)?.service ?? "·";
			(groups.get(svc) ?? groups.set(svc, []).get(svc)).push(n.id);
		}
		const pos = /* @__PURE__ */ new Map();
		const clusters = [...groups.entries()].map(([svc, ids]) => {
			ids.sort((a, b) => (KIND_ORDER[meta.get(a)?.kind ?? ""] ?? 3) - (KIND_ORDER[meta.get(b)?.kind ?? ""] ?? 3));
			const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
			const rows = Math.ceil(ids.length / cols);
			return {
				svc,
				ids,
				cols,
				rows,
				w: cols * CELL_W,
				h: rows * CELL_H
			};
		}).sort((a, b) => b.h - a.h);
		const area = clusters.reduce((sum, c) => sum + c.w * c.h, 0);
		const rowTarget = clamp(Math.round(Math.sqrt(Math.max(area, CELL_W * CELL_H) * 1.7)), MIN_ROW_TARGET, MAX_ROW_TARGET);
		let shelfX = 0, shelfY = 0, shelfH = 0;
		for (const c of clusters) {
			if (shelfX > 0 && shelfX + c.w > rowTarget) {
				shelfX = 0;
				shelfY += shelfH + CLUSTER_GAP;
				shelfH = 0;
			}
			c.ids.forEach((id, i) => {
				const col = i % c.cols, row = Math.floor(i / c.cols);
				pos.set(id, {
					x: shelfX + col * CELL_W,
					y: shelfY + row * CELL_H
				});
			});
			shelfX += c.w + CLUSTER_GAP;
			shelfH = Math.max(shelfH, c.h);
		}
		return pos;
	}
	function assignFocusPositions(sn) {
		const pos = /* @__PURE__ */ new Map();
		const cols = sn.length <= 5 ? 1 : 2;
		sn.forEach((n, i) => {
			const col = i % cols, row = Math.floor(i / cols);
			pos.set(n.id, {
				x: col * CELL_W,
				y: row * 142
			});
		});
		return pos;
	}
	function nodeSizeFor(n) {
		const label = n.label || n.method || n.id;
		return {
			w: Math.max(160, Math.min(230, 116 + label.length * 2.5)),
			h: n.kind === "entrypoint" || n.kind === "router" || (n.effects?.length ?? 0) > 0 ? 74 : 64
		};
	}
	function sgGraphToSnapshot(g, opts = {}) {
		const raw = g.nodes ?? [];
		const meta = new Map(raw.map((n) => [n.id, n]));
		const ids = new Set(raw.map((n) => n.id));
		const base = raw.map((n) => ({
			id: n.id,
			NodeType: nodeTypeFor(n)
		}));
		const pos = opts.layout === "flow" ? /* @__PURE__ */ new Map() : opts.focusNodeId ? assignFocusPositions(base) : assignPositions(base, meta);
		return {
			nodes: raw.map((n) => {
				const loc = n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : "";
				const desc = [
					n.service && `svc: ${n.service}`,
					loc,
					n.effects?.length && `fx: ${n.effects.join(", ")}`
				].filter(Boolean).join("  ·  ");
				return {
					id: n.id,
					Label: { text: n.label || n.method || n.id },
					NodeType: nodeTypeFor(n),
					Description: desc || void 0,
					Size: nodeSizeFor(n),
					Position: pos.get(n.id)
				};
			}),
			edges: (g.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e, i) => ({
				id: `r${i + 1}`,
				From: e.from,
				To: e.to,
				Label: e.label ? { text: e.label } : void 0,
				EdgeKind: edgeKindFor(e)
			}))
		};
	}
	var SAMPLES = { entrypoints: {
		nodes: [
			{
				id: "web::routes.ts",
				label: "routes.ts",
				service: "web",
				lang: "ts",
				kind: "router",
				file: "web/routes.ts",
				line: 12
			},
			{
				id: "web::GET /orders",
				label: "GET /orders",
				service: "web",
				lang: "ts",
				kind: "entrypoint",
				op: "listOrders",
				method: "listOrders",
				file: "web/orders.ts",
				line: 40
			},
			{
				id: "web::POST /orders",
				label: "POST /orders",
				service: "web",
				lang: "ts",
				kind: "entrypoint",
				op: "createOrder",
				method: "createOrder",
				file: "web/orders.ts",
				line: 55
			},
			{
				id: "api::orders.go",
				label: "orders.go",
				service: "api",
				lang: "go",
				kind: "file",
				file: "api/orders.go",
				line: 1,
				effects: ["db", "io-write"]
			},
			{
				id: "api::store.go",
				label: "store.go",
				service: "api",
				lang: "go",
				kind: "file",
				file: "api/store.go",
				line: 1,
				effects: ["db"]
			}
		],
		edges: [
			{
				from: "web::routes.ts",
				to: "web::GET /orders",
				kind: "registers",
				label: "GET"
			},
			{
				from: "web::routes.ts",
				to: "web::POST /orders",
				kind: "registers",
				label: "POST"
			},
			{
				from: "web::GET /orders",
				to: "api::orders.go",
				kind: "api-call",
				label: "GET /orders",
				cross: true
			},
			{
				from: "web::POST /orders",
				to: "api::orders.go",
				kind: "api-call",
				label: "POST /orders",
				cross: true
			},
			{
				from: "api::orders.go",
				to: "api::store.go",
				kind: "import"
			}
		]
	} };
	async function loadGraph(source, lens) {
		if (source.startsWith("sample:")) {
			const key = source.slice(7);
			const g = SAMPLES[key];
			if (!g) throw new Error(`unknown sample "${key}"`);
			return g;
		}
		const url = new URL(source, location.origin);
		if (lens) url.searchParams.set("lens", lens);
		const res = await fetch(url.toString());
		if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
		const body = await res.json();
		return body?.graph ?? body;
	}
	function registerVarflow(system) {
		system("varflow", ({ on, emit }) => {
			const run = async (source, lens) => {
				try {
					const snapshot = sgGraphToSnapshot(await loadGraph(source, lens));
					emit("graph.import.snapshot", snapshot);
					mountRoot().classList.add("varflow");
					setTimeout(() => emit("view.fit.all"), 60);
					setTimeout(() => emit("view.fit.all"), 400);
					emit("varflow.loaded", {
						nodes: snapshot.nodes.length,
						edges: snapshot.edges.length
					});
				} catch (err) {
					emit("varflow.error", { message: err instanceof Error ? err.message : String(err) });
				}
			};
			on("varflow.load", ({ source, lens }) => {
				run(source, lens);
			});
			on("app.start", () => {
				const params = new URLSearchParams(location.search);
				const source = params.get("varflow");
				if (source) run(source, params.get("lens") ?? void 0);
			});
		}, { requires: [
			"graph",
			"layout",
			"render"
		] });
	}
	//#endregion
	//#region frontend/systems/view-pan.ts
	function registerViewPan(system) {
		system("view.pan", ({ on, emit, contexts }) => {
			let pan = null;
			let pending = null;
			let scheduled = false;
			const stageSelector = `[data-place="${Places.Stage}"]`;
			const commit = () => emit("view.changed", contexts.view.get());
			const setViewFor = (pointer) => {
				if (!pan) return;
				contexts.view.set({
					x: pan.view.x - (pointer.x - pan.pointer.x) / pan.view.scale,
					y: pan.view.y - (pointer.y - pan.pointer.y) / pan.view.scale
				});
			};
			const applyPending = () => {
				scheduled = false;
				if (!pan || !pending) return;
				const pointer = pending;
				pending = null;
				setViewFor(pointer);
				commit();
			};
			const scheduleMove = (pointer) => {
				pending = pointer;
				setViewFor(pointer);
				if (scheduled) return;
				scheduled = true;
				requestAnimationFrame(applyPending);
			};
			contexts.commands.register([
				{
					id: "view.pan.start",
					label: "Start canvas pan",
					event: "view.pan.start",
					group: "view",
					hidden: true,
					input: {
						on: "pointerdown",
						selector: stageSelector,
						when: isStageSurface,
						prevent: true
					},
					payload: ({ event }) => clientPoint(event)
				},
				{
					id: "view.pan.move",
					label: "Pan canvas",
					event: "view.pan.move",
					group: "view",
					hidden: true,
					input: {
						on: "pointermove",
						when: () => !!pan,
						prevent: true
					},
					payload: ({ event }) => clientPoint(event)
				},
				{
					id: "view.pan.end",
					label: "End canvas pan",
					event: "view.pan.end",
					group: "view",
					hidden: true,
					input: {
						on: "pointerup",
						when: () => !!pan
					}
				}
			]);
			on("view.pan.start", (pointer) => {
				pan = {
					pointer,
					view: contexts.view.get()
				};
				contexts.places.el(Places.Stage)?.classList.add("panning");
			});
			on("view.pan.move", (pointer) => {
				if (pan) scheduleMove(pointer);
			});
			on("view.pan.end", () => {
				if (pending) applyPending();
				pan = null;
				pending = null;
				contexts.places.el(Places.Stage)?.classList.remove("panning");
			});
		}, { requires: ["render"] });
	}
	//#endregion
	//#region frontend/systems/view-zoom.ts
	function registerViewZoom(system) {
		system("view.zoom", ({ on, emit, contexts, graphs, selection, contribute, model, declarePanel }) => {
			declarePanel({
				id: "zoom",
				anchor: "bottom-right",
				movable: false,
				layout: "toolbar",
				order: 20
			});
			contribute({
				panel: "zoom",
				surface: "top",
				command: "view.zoom.out",
				kind: "button",
				text: "−",
				slot: Slots.End,
				order: 10
			});
			contribute({
				panel: "zoom",
				surface: "top",
				command: "view.zoom.reset",
				kind: "button",
				text: "100%",
				slot: Slots.End,
				order: 20
			});
			contribute({
				panel: "zoom",
				surface: "top",
				command: "view.zoom.in",
				kind: "button",
				text: "+",
				slot: Slots.End,
				order: 30
			});
			contribute({
				panel: "zoom",
				surface: "top",
				command: "view.fit.all",
				kind: "button",
				text: "Fit",
				slot: Slots.End,
				order: 5
			});
			const stageSelector = `[data-place="${Places.Stage}"]`;
			const commit = () => emit("view.changed", contexts.view.get());
			const centerZoom = (factor) => {
				cancelCamera();
				contexts.view.zoomAtScreen(contexts.view.screenCenter(Places.Stage), factor);
				commit();
			};
			let cameraFrame = 0;
			const cancelCamera = () => {
				if (cameraFrame) cancelAnimationFrame(cameraFrame);
				cameraFrame = 0;
			};
			const animateViewTo = (next, duration = 180) => {
				cancelCamera();
				const start = contexts.view.get();
				const dx = next.x - start.x, dy = next.y - start.y, ds = next.scale - start.scale;
				if (Math.abs(dx) + Math.abs(dy) + Math.abs(ds) < .001) return;
				const startAt = performance.now();
				const ease = (t) => 1 - Math.pow(1 - t, 3);
				const step = () => {
					const t = Math.min(1, Math.max(0, (performance.now() - startAt) / duration));
					const k = ease(t);
					contexts.view.set({
						x: start.x + dx * k,
						y: start.y + dy * k,
						scale: start.scale + ds * k
					});
					commit();
					if (t < 1) cameraFrame = requestAnimationFrame(step);
					else cameraFrame = 0;
				};
				cameraFrame = requestAnimationFrame(step);
			};
			contexts.commands.register([
				{
					id: "view.zoom.wheel",
					label: "Wheel zoom",
					event: "view.zoom.by",
					group: "view",
					hidden: true,
					input: {
						on: "wheel",
						selector: stageSelector,
						prevent: true
					},
					payload: ({ event }) => {
						const wheel = event;
						const coefficient = wheel.ctrlKey ? .01 : .0025;
						return {
							screen: contexts.view.clientToScreen(Places.Stage, {
								x: wheel.clientX,
								y: wheel.clientY
							}),
							factor: Math.exp(-wheel.deltaY * coefficient)
						};
					}
				},
				{
					id: "view.zoom.in",
					label: "Zoom in",
					group: "view",
					shortcut: "+",
					input: {
						on: "keydown",
						key: "+",
						prevent: true
					}
				},
				{
					id: "view.zoom.out",
					label: "Zoom out",
					group: "view",
					shortcut: "-",
					input: {
						on: "keydown",
						key: "-",
						prevent: true
					}
				},
				{
					id: "view.zoom.reset",
					label: "Reset view",
					group: "view",
					shortcut: "0",
					input: {
						on: "keydown",
						key: "0",
						prevent: true
					}
				},
				{
					id: "view.fit.all",
					label: "Fit all to view",
					group: "view",
					shortcut: "Z",
					input: {
						on: "keydown",
						key: "z",
						prevent: true
					}
				},
				{
					id: "view.fit.selected",
					label: "Fit selected to view",
					group: "view",
					shortcut: "Shift+Z",
					input: {
						on: "keydown",
						key: "Z",
						shift: true,
						prevent: true
					},
					available: () => !!selection.selected()
				},
				{
					id: "view.fit.item",
					label: "Fit item to view",
					group: "view",
					hidden: true,
					available: (source) => !!itemRefFrom(source?.target) || !!selection.selected(),
					payload: (source) => itemRefFrom(source.target) ?? selection.selected() ?? void 0
				}
			]);
			on("view.zoom.by", ({ screen, factor }) => {
				cancelCamera();
				contexts.view.zoomAtScreen(screen, factor);
				commit();
			});
			on("view.zoom.in", () => centerZoom(1.2));
			on("view.zoom.out", () => centerZoom(1 / 1.2));
			on("view.zoom.reset", () => {
				cancelCamera();
				contexts.view.set({
					x: 0,
					y: 0,
					scale: 1
				});
				commit();
			});
			const nodesBounds = (ns) => {
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				ns.forEach((n) => {
					if (!n.Position) return;
					const w = n.Size.w / 2, h = n.Size.h / 2;
					minX = Math.min(minX, n.Position.x - w);
					minY = Math.min(minY, n.Position.y - h);
					maxX = Math.max(maxX, n.Position.x + w);
					maxY = Math.max(maxY, n.Position.y + h);
				});
				return isFinite(minX) ? {
					minX,
					minY,
					maxX,
					maxY
				} : null;
			};
			const fitToBounds = (b, pixelPadding = 40) => {
				cancelCamera();
				const stage = contexts.places.el(Places.Stage);
				if (!stage) return;
				const rect = stage.getBoundingClientRect();
				const leftRect = contexts.places.el(Places.Left)?.getBoundingClientRect();
				const leftInset = leftRect && leftRect.width > 0 ? Math.max(0, Math.min(rect.width - 1, leftRect.right - rect.left)) : 0;
				const fittableW = Math.max(1, rect.width - leftInset - 2 * pixelPadding);
				const fittableH = Math.max(1, rect.height - 2 * pixelPadding);
				const bw = Math.max(1, b.maxX - b.minX);
				const bh = Math.max(1, b.maxY - b.minY);
				const scale = Math.min(2, Math.min(fittableW / bw, fittableH / bh));
				const cx = (b.minX + b.maxX) / 2;
				const cy = (b.minY + b.maxY) / 2;
				contexts.view.set({
					x: cx - (leftInset + pixelPadding + fittableW / 2) / scale,
					y: cy - rect.height / (2 * scale),
					scale
				});
				commit();
			};
			const gentleScaleFor = (b, stage) => {
				const view = contexts.view.get();
				const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
				const safeW = Math.max(1, stage.width - 144), safeH = Math.max(1, stage.height - 144);
				const comfortW = Math.max(1, stage.width * .46), comfortH = Math.max(1, stage.height * .46);
				const screenW = bw * view.scale, screenH = bh * view.scale;
				if (screenW > safeW || screenH > safeH) return Math.min(view.scale, safeW / bw, safeH / bh);
				if (screenW > comfortW || screenH > comfortH) {
					const comfortScale = Math.min(comfortW / bw, comfortH / bh);
					return Math.min(view.scale, Math.max(view.scale * .92, comfortScale));
				}
				return view.scale;
			};
			const gentleOriginForAxis = (min, max, stageSize, scale, currentOrigin) => {
				const center = (min + max) / 2;
				const halfScreen = Math.max(.5, (max - min) * scale / 2);
				const currentCenterScreen = (center - currentOrigin) * scale;
				const innerMin = stageSize * .38, innerMax = stageSize * .62;
				const safeMin = 72, safeMax = stageSize - 72;
				let desiredCenter = clamp$1(currentCenterScreen, innerMin, innerMax);
				if (halfScreen * 2 <= safeMax - safeMin) desiredCenter = clamp$1(desiredCenter, safeMin + halfScreen, safeMax - halfScreen);
				else desiredCenter = stageSize / 2;
				return center - desiredCenter / scale;
			};
			const gentlyFitToBounds = (b) => {
				const stage = contexts.places.el(Places.Stage);
				if (!stage) return;
				const rect = stage.getBoundingClientRect();
				const view = contexts.view.get();
				const scale = gentleScaleFor(b, rect);
				animateViewTo({
					x: gentleOriginForAxis(b.minX, b.maxX, rect.width, scale, view.x),
					y: gentleOriginForAxis(b.minY, b.maxY, rect.height, scale, view.y),
					scale
				});
			};
			const rectToBounds = (r) => ({
				minX: r.x,
				minY: r.y,
				maxX: r.x + r.w,
				maxY: r.y + r.h
			});
			/** Resolve any ItemRef to graph-space bounds. Prefers the entity renderer's
			*  own `bounds()` — so it frames nodes AND containers (whose bounds are their
			*  visual rect, collapsed or expanded). Edges fit both endpoints; anything
			*  else falls back to its hierarchy anchor. */
			const itemBounds = (ref) => {
				const item = graphs.current.getItem(ref);
				const renderer = model.entity(ref.kind)?.render;
				const rect = item && renderer?.bounds ? renderer.bounds(item) : null;
				if (rect) return rectToBounds(rect);
				if (ref.kind === "edge") {
					const edge = graphs.current.getEdge(ref.id);
					const from = edge && graphs.current.getNode(edge.From);
					const to = edge && graphs.current.getNode(edge.To);
					if (from && to) {
						const nodes = [from, to].filter((n) => n.Position);
						if (nodes.length) return nodesBounds(nodes);
					}
				}
				const anchor = contexts.hierarchy.anchor(ref);
				if (!anchor) return null;
				return {
					minX: anchor.x - 80,
					minY: anchor.y - 32,
					maxX: anchor.x + 80,
					maxY: anchor.y + 32
				};
			};
			const unionBounds = (a, b) => ({
				minX: Math.min(a.minX, b.minX),
				minY: Math.min(a.minY, b.minY),
				maxX: Math.max(a.maxX, b.maxX),
				maxY: Math.max(a.maxY, b.maxY)
			});
			/** Bounds of everything currently *visible* — each entity's renderer bounds
			*  (so a collapsed container counts as its small badge, not its expanded
			*  rect), skipping items hidden inside a folded ancestor. Fit frames what the
			*  user sees, not stale expanded extents. */
			const visibleBounds = () => {
				let acc = null;
				model.entities().forEach((entityDef) => {
					const bounds = entityDef.render?.bounds;
					if (!bounds) return;
					graphs.current.itemsOfKind(entityDef.kind).forEach((item) => {
						const id = item.id;
						if (!id) return;
						if (foldHidden({
							kind: entityDef.kind,
							id
						}, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id)) return;
						const r = bounds(item);
						if (!r) return;
						const bb = {
							minX: r.x,
							minY: r.y,
							maxX: r.x + r.w,
							maxY: r.y + r.h
						};
						acc = acc ? unionBounds(acc, bb) : bb;
					});
				});
				return acc;
			};
			on("view.fit.all", () => {
				const b = visibleBounds();
				if (b) fitToBounds(b);
			});
			on("view.fit.selected", () => {
				const boxes = selection.selectedAll().map(itemBounds).filter((b) => !!b);
				if (!boxes.length) return;
				fitToBounds(boxes.reduce((acc, box) => ({
					minX: Math.min(acc.minX, box.minX),
					minY: Math.min(acc.minY, box.minY),
					maxX: Math.max(acc.maxX, box.maxX),
					maxY: Math.max(acc.maxY, box.maxY)
				})), 180);
			});
			on("view.fit.item", (ref) => {
				const b = itemBounds(ref);
				if (b) gentlyFitToBounds(b);
			});
			return cancelCamera;
		}, { requires: ["render"] });
	}
	//#endregion
	//#region frontend/systems/index.ts
	function registerSystems(system) {
		registerRender(system);
		registerDarkTheme(system);
		registerRenderStage(system);
		registerTextLayout(system);
		registerInput(system);
		registerIo(system);
		registerFoldable(system);
		registerCancellation(system);
		registerMain(system);
		registerToolPanel(system);
		registerLog(system);
		registerModal(system);
		registerCommandForm(system);
		registerCommandPicker(system);
		registerCommandModal(system);
		registerPerfPanel(system);
		registerJump(system);
		registerCollections(system);
		registerGraph(system);
		registerViewZoom(system);
		registerViewPan(system);
		registerFocus(system);
		registerLayout(system);
		registerContextActions(system);
		registerItemToolbar(system);
		registerNodeVisuals(system);
		registerNodeAutosize(system);
		registerContainers(system);
		registerOutline(system);
		registerChoose(system);
		registerDetail(system);
		registerDemo(system);
		registerDebug(system);
		registerScenario(system);
		registerShare(system);
		registerVarflow(system);
		registerDx(system);
	}
	//#endregion
	//#region frontend/lib.ts
	/**
	* Embeddable library entry.
	*
	* The dev app (`app.ts`) boots itself into `#app`. This entry instead exposes
	* `createGraphViewer(target, hooks)` so a host page (e.g. file-projections' UI)
	* can mount a read-only, interactive program-graph viewer into any element and
	* get node/edge click callbacks to wire into its own code navigation.
	*
	* Self-contained: the bundle injects its own CSS (`styles.css`) and the DOM
	* `<template>`s it needs (extracted from `index.html`), so the host only has to
	* drop in one script and call one function.
	*
	* Single-instance: the renderer resolves one global mount root (see
	* `core/mount.ts`), so one viewer per page for now.
	*/
	/** The class every mount root carries; also the scope all viewer CSS is
	*  rewritten under so it can't leak into the host page. */
	var SCOPE = ".graph-viewer-host";
	/** Rewrite a stylesheet so every rule only applies inside the mount root.
	*  - page-level `html`/`body` rules are dropped (the host sizes the element)
	*  - `:root` (design tokens) is remapped to the scope so vars cascade in
	*  - everything else is prefixed with the scope selector
	*  Keyframes stay global; @media/@supports are recursed into. */
	function scopeCss(css) {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(css);
		const scopeSelector = (sel) => sel.split(",").map((part) => {
			const s = part.trim();
			if (!s) return s;
			if (s === "html" || s === "body") return SCOPE;
			if (s.startsWith("html ") || s.startsWith("body ")) return `${SCOPE} ${s.slice(s.indexOf(" ") + 1)}`;
			if (s.includes(":root") || s.includes(".varflow")) return s.replace(/:root/g, SCOPE).replace(/\.varflow/g, SCOPE);
			return `${SCOPE} ${s}`;
		}).join(", ");
		const render = (rules) => {
			let out = "";
			for (const rule of Array.from(rules)) if (rule instanceof CSSStyleRule) {
				const raw = rule.selectorText.trim();
				if (raw === "html" || raw === "body") continue;
				out += `${scopeSelector(rule.selectorText)}{${rule.style.cssText}}\n`;
			} else if (rule instanceof CSSMediaRule) out += `@media ${rule.conditionText}{${render(rule.cssRules)}}\n`;
			else if (rule instanceof CSSSupportsRule) out += `@supports ${rule.conditionText}{${render(rule.cssRules)}}\n`;
			else out += `${rule.cssText}\n`;
			return out;
		};
		return render(sheet.cssRules);
	}
	var stylesInjected = false;
	function ensureStyles() {
		if (stylesInjected || document.getElementById("graph-viewer-styles")) return;
		const style = document.createElement("style");
		style.id = "graph-viewer-styles";
		style.textContent = scopeCss(styles_default);
		document.head.appendChild(style);
		stylesInjected = true;
	}
	function ensureTemplates() {
		new DOMParser().parseFromString(frontend_default, "text/html").querySelectorAll("template[id]").forEach((tpl) => {
			if (!document.getElementById(tpl.id)) document.body.appendChild(tpl.cloneNode(true));
		});
	}
	var nodeInfo = (n) => ({
		id: n.id,
		label: n.label || n.method || n.id,
		service: n.service,
		kind: n.kind,
		file: n.file,
		line: n.line,
		effects: n.effects,
		raw: n
	});
	function serviceContainersFor(graph) {
		const groups = /* @__PURE__ */ new Map();
		(graph.nodes ?? []).forEach((n) => {
			const service = n.service || "other";
			(groups.get(service) ?? groups.set(service, []).get(service)).push(n.id);
		});
		return [...groups.entries()].filter(([, children]) => children.length > 1).map(([service, children], i) => ({
			id: `vf-svc-${i + 1}-${service.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
			label: service,
			children
		}));
	}
	function createGraphViewer(opts) {
		const target = typeof opts.target === "string" ? document.querySelector(opts.target) : opts.target;
		if (!target) throw new Error(`createGraphViewer: target not found: ${String(opts.target)}`);
		ensureStyles();
		ensureTemplates();
		setMountRoot(target);
		target.classList.add("varflow", "graph-viewer-host");
		const plugins = registry();
		registerSystems(withKind(plugins, "system"));
		registerAbilitySystems(withKind(plugins, "ability"));
		registerFeatures(withKind(plugins, "feature"));
		const ctx = createAppContext(graphStore(), appModel, {}, memoryIo());
		installRuntimeFeatureManager(ctx, plugins);
		plugins.start(ctx);
		ctx.bus.emit("app.start");
		let rawGraph = null;
		let currentOpts = {};
		let nodeMeta = /* @__PURE__ */ new Map();
		let edgeMeta = /* @__PURE__ */ new Map();
		let suppressSelection = false;
		const readableDefaults = (viewOpts) => {
			if (viewOpts.layout === "flow" || viewOpts.readMode === "all") return viewOpts;
			const width = target.getBoundingClientRect().width || window.innerWidth;
			return {
				...width <= 460 ? {
					maxOverviewNodes: 4,
					maxFocusNodes: 6,
					expandDepth: 0
				} : width <= 760 ? {
					maxOverviewNodes: 12,
					maxFocusNodes: 16,
					expandDepth: 1
				} : {
					maxOverviewNodes: 18,
					maxFocusNodes: 24,
					expandDepth: 1
				},
				...viewOpts
			};
		};
		const resolveSelection = (kind, id) => {
			if (kind === "node") {
				const n = nodeMeta.get(id);
				return n ? nodeInfo(n) : null;
			}
			if (kind === "edge") return edgeMeta.get(id) ?? null;
			return null;
		};
		const off = ctx.bus.on("selection.changed", (data) => {
			const refs = data.refs ?? [];
			const primary = refs[refs.length - 1];
			if (!primary) {
				opts.onSelect?.(null);
				return;
			}
			const info = resolveSelection(primary.kind, primary.id);
			if (!info) return;
			if (suppressSelection) return;
			if (primary.kind === "node") opts.onNodeClick?.(info);
			if (primary.kind === "edge") opts.onEdgeClick?.(info);
			opts.onSelect?.(info);
			if (primary.kind === "node" && rawGraph && currentOpts.layout !== "flow" && currentOpts.readMode !== "all") window.setTimeout(() => focus(primary.id), 0);
		});
		const fit = () => ctx.bus.emit("view.fit.all");
		let hasGraph = false;
		let resizeTimer = 0;
		const redrawAndFit = () => {
			ctx.bus.emit("render.stage.draw", {
				full: true,
				refs: []
			});
			fit();
		};
		const ro = new ResizeObserver(() => {
			if (!hasGraph) return;
			clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(redrawAndFit, 80);
		});
		ro.observe(target);
		const renderLoaded = (graph, viewOpts = {}) => {
			viewOpts = readableDefaults(viewOpts);
			hasGraph = true;
			const raw = rawGraph?.nodes ?? graph.nodes ?? [];
			nodeMeta = new Map(raw.map((n) => [n.id, n]));
			const slice = readableGraph(graph, viewOpts);
			const visible = slice.graph.nodes ?? [];
			const ids = new Set(visible.map((n) => n.id));
			edgeMeta = /* @__PURE__ */ new Map();
			(slice.graph.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).forEach((e, i) => {
				edgeMeta.set(`r${i + 1}`, {
					id: `r${i + 1}`,
					from: e.from,
					to: e.to,
					kind: e.kind,
					label: e.label,
					cross: e.cross,
					source: nodeMeta.get(e.from) && nodeInfo(nodeMeta.get(e.from)),
					target: nodeMeta.get(e.to) && nodeInfo(nodeMeta.get(e.to))
				});
			});
			const snapshot = sgGraphToSnapshot(slice.graph, viewOpts);
			ctx.bus.emit("graph.import.snapshot", snapshot);
			ctx.bus.emit("container.import.snapshot", { containers: viewOpts.layout === "flow" ? [] : serviceContainersFor(slice.graph) });
			target.classList.add("varflow");
			requestAnimationFrame(() => {
				ctx.bus.emit("render.stage.draw", {
					full: true,
					refs: []
				});
				if (viewOpts.layout === "flow") ctx.bus.emit("layout.apply.tidy");
				fit();
				setTimeout(fit, 300);
			});
			const result = {
				nodes: snapshot.nodes.length,
				edges: snapshot.edges.length,
				totalNodes: slice.totalNodes,
				totalEdges: slice.totalEdges,
				mode: slice.mode
			};
			opts.onViewChange?.(result);
			return result;
		};
		const load = (graph, opts = {}) => {
			rawGraph = graph;
			currentOpts = opts;
			return renderLoaded(graph, opts);
		};
		const focus = (nodeId) => {
			if (!rawGraph) return null;
			suppressSelection = true;
			currentOpts = {
				...currentOpts,
				focusNodeId: nodeId
			};
			const result = renderLoaded(rawGraph, currentOpts);
			requestAnimationFrame(() => {
				ctx.bus.emit("selection.node.select", { id: nodeId });
				window.setTimeout(() => {
					suppressSelection = false;
				}, 0);
			});
			return result;
		};
		const showAll = () => {
			if (!rawGraph) return null;
			currentOpts = {
				...currentOpts,
				readMode: "all",
				focusNodeId: void 0
			};
			return renderLoaded(rawGraph, currentOpts);
		};
		const select = (nodeId) => ctx.bus.emit("selection.node.select", { id: nodeId });
		const clear = () => {
			rawGraph = null;
			ctx.bus.emit("graph.import.snapshot", {
				nodes: [],
				edges: []
			});
			ctx.bus.emit("container.import.snapshot", { containers: [] });
		};
		const destroy = () => {
			off();
			ro.disconnect();
			target.replaceChildren();
			target.classList.remove("varflow", "graph-viewer-host");
		};
		return {
			load,
			showAll,
			focus,
			fit,
			select,
			clear,
			destroy,
			ctx
		};
	}
	//#endregion
	exports.createGraphViewer = createGraphViewer;
	return exports;
})({});
