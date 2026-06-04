# 3D Graph ECS — Architecture Documentation

A single-file, event-driven frontend for building interactive 3D diagrams (mindmaps, explainers, architecture visualizations) using a hybrid Canvas/HTML renderer and an Entity-Component-System core.

---

## Core Idea

**Render only when state changes.** The browser is treated as a reactive display: raw input is captured, interpreted into semantic domain events, and the view is redrawn exactly once per change. No `requestAnimationFrame` loop burns CPU while idle.

---

## Concepts

### 1. Hybrid Renderer
- **Canvas** handles the infinite grid, edges, arrowheads, and the "ghost" connection line.
- **HTML nodes** are absolutely-positioned `<div>` elements CSS-transformed into the same camera space. This gives native text editing, scrollbars, and accessibility without rebuilding a UI toolkit.

### 2. EventBus (Central Nervous System)
All communication flows through a single pub/sub bus. Systems never call each other directly.
```javascript
bus.emit('cmd-add-node', { parent: 7 });
bus.on('cmd-add-node', ({ parent }) => { ... });
```

### 3. Lightweight ECS
- **Entity** = integer ID
- **Component** = plain data bag (`Transform`, `Node`, `Edge`)
- **No traditional Systems** — domain handlers react to bus events instead

```javascript
const eid = world.create();
world.add(eid, 'Transform', { x, y, z });
world.add(eid, 'Node', { title, domEl, children: [] });
```

### 4. Raw → Domain Event Routing
Input is processed in three layers:

| Layer | Responsibility |
|-------|---------------|
| **InputController** | Captures raw `keydown`, `wheel`, `mousedown`, `mousemove`. Distinguishes clicks from drags. |
| **DomainEventRouter** | Walks a declarative `SHORTCUTS` map to convert raw events into semantic ones (`zoom-in`, `cmd-add-node`, `pan-left`). Checks `Context.mode` and modifiers. |
| **Domain Handlers** | Execute side effects (mutate ECS, camera, DOM, open palette). |

**Declarative shortcuts example:**
```javascript
{ id: 'add', key: 'a', mode: 'normal', emit: 'cmd-add-node' }
{ id: 'zoom-in', event: 'wheel', deltaY: '<0', emit: 'zoom-in' }
```

### 5. Context
A global state bag holding transient UI state:
```javascript
{
  selectedId,      // currently selected entity
  mode: 'normal',  // normal | connecting | palette
  camera: { x, y, zoom, layerZ },
  history: [],     // previously selected nodes (for Alt+Z back-nav)
  drag: { active, id, sx, sy },
  mouse: { x, y }
}
```

### 6. Render-on-Demand
A guarded dirty-flag scheduler. Any state change calls `scheduleRender()`, which requests at most one RAF per frame.
```javascript
function scheduleRender() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => { rafId = null; render(); });
}
```
High-frequency streams (`camera-pan`, `node-drag`) are coalesced: the toast inspector logs `(start)` on the first event and `(end)` on mouseup, skipping the middle.

### 7. 3D Layers
Nodes have a `z` depth. A perspective projection scales them smaller as they recede. Keyboard shortcuts (`1`, `2`, `3`) set the current drawing layer (`layerZ`), allowing multi-plane diagrams.

### 8. Command Palette
`P` opens a searchable list of all actions populated from `PALETTE_COMMANDS`. Each entry shows its shortcut and executes the same domain event the keyboard would, keeping the system unified.

### 9. Toast Inspector
Every domain event is logged to a top-right toast as serialized text, making the event flow observable and debuggable in real time.

---

## Event Flow Diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Raw Input  │────▶│  InputController │────▶│ DomainEventRouter│
│ (key/wheel) │     │ (drag detection) │     │ (SHORTCUTS map) │
└─────────────┘     └──────────────────┘     └─────────────────┘
                                                    │
                           ┌────────────────────────┘
                           ▼
                    ┌─────────────┐
                    │   EventBus   │
                    │  (semantic)  │
                    └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌─────────┐  ┌──────────┐
        │  ECS    │  │ Camera  │  │   DOM    │
        │ mutations│  │ mutations│  │ mutations │
        └─────────┘  └─────────┘  └──────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ scheduleRender() │
                    │  (dirty-flag RAF) │
                    └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   render()   │
                    │ Canvas+HTML  │
                    └─────────────┘
```

---

## Key Files / Structure

Everything lives in a single `index.html`:

| Section | Role |
|---------|------|
| `EventBus` | Pub/sub core with auto-render trigger |
| `Context` | Global transient state |
| `world` (ECS) | Entity storage, component maps, queries |
| `InputController` | Raw event capture, drag detection, stream tracking |
| `DomainEventRouter` | Shortcut resolution, mode gating |
| `Domain Handlers` | `bus.on('cmd-*', ...)` — all side effects |
| `createNode / createEdge` | Factories |
| `render()` | One-shot draw: grid → edges → ghost line → DOM sync |
| `buildJMM()` | Demo data (Java Memory Model) |

---

## Screenshot Tests

The Playwright suite runs the app through Vite in screenshot mode:

```bash
npm install
npm test
```

Screenshot mode is enabled with `?screenshot=1`. It hides the HUD, dock, canvas, modals, and toast UI, then paints nodes as fixed-size 50% black rectangles over a white background. Two intersecting nodes produce a distinct overlap color near `rgb(64, 64, 64)`.

The starter baselines are URL fixtures:

| URL | Purpose |
|-----|---------|
| `/?screenshot=1` | The default seeded Java Memory Model graph |
| `/?screenshot=1&fixture=separated` | Two hardcoded nodes that should not overlap |
| `/?screenshot=1&fixture=overlapping` | Two hardcoded nodes that prove the detector and red-square annotation work |

Scripted screenshot states use `?screenshot=1&script=demoMemory&checkpoint=...`. The first script mirrors the demo flow without timers so tests can jump straight to:

`root-added`, `top-level-expanded`, `heap-children-just-added`, `stack-children-just-added`, `deep-object-just-added`, `deep-ref-just-added`, `heap-collapsed`, and `heap-expanded-again`.

When a no-overlap expectation finds overlap-color pixels, the test writes an annotated PNG with red square markers into Playwright's test output.

---

## Keyboard Map

| Key | Action |
|-----|--------|
| `A` | Add child node |
| `Del` | Delete selected subtree |
| `E` | Edit node title |
| `C` | Start connection mode |
| `Space` | Collapse/expand |
| `L` | Auto-layout tree |
| `1-3` | Switch Z-layer |
| `+/-` | Zoom |
| `Arrows` | Pan camera |
| `P` | Command palette |
| `Alt+Z` | History back |
| `Esc` | Cancel / deselect |

---

## Design Principles

1. **Events are the API.** Every action is an event. The palette, keyboard, and future voice/AI controls all emit the same events.
2. **No direct mutation.** Handlers react to events; nothing touches state outside the bus.
3. **HTML is a component.** Nodes are DOM elements, not canvas glyphs, so text editing is free.
4. **CPU is idle by default.** The screen only updates when something happens.
