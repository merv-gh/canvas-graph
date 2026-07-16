import { nodeRef, tagItem, type Registry } from '../core';
import { Places } from '../types';
import type { GraphEdge, GraphNode } from '../model';
import type { EntityRenderCtx, ItemRef, Rect } from '../types';

declare module '../types' {
  interface CustomEvents {
    'present.toggle': void;
    'present.focus': { id: string };
    'present.mode.toggle': void;
    'present.move': { dir: Dir };
    'present.jump': void;
  }
}

type Dir = 'up' | 'down' | 'left' | 'right';
type Mode = 'nodes' | 'edges';
const MAX_PER_SIDE = 3;
const RING = 260;   // graph-space distance from focus to each side's slot line
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

type Neighbour = { node: GraphNode; edge: GraphEdge; outgoing: boolean; dir: Dir };
const rectOf = (n: GraphNode): Rect => {
  const p = n.Position ?? { x: 0, y: 0 };
  const s = n.Size ?? { w: 160, h: 72 };
  return { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h };
};

/** Framed presentation mode — a distraction-free lens for walking someone through
 *  a graph on any screen. It renders a REAL sub-graph (the model's own node/edge
 *  renderers, on a gridded background, no panels) into the modal: the focus node
 *  centered with up to three neighbours per side (a 3×3 compass), regardless of
 *  where they sit on the big canvas. Navigation is a fluent hop between focus
 *  nodes; it never moves the main canvas — only the explicit "Open in canvas"
 *  button selects + fits the current node out there, so Escape leaves the real
 *  view exactly as it was. Toggle node text ⟷ edge labels (labels off by default).
 *  Observable via `shell[data-present*]`. */
export function registerPresent(system: Registry) {
  system('present', ({ on, emit, contexts, graphs, selection, model, contribute, frameLoop }) => {
    let active = false;
    let focusId: string | null = null;
    let mode: Mode = 'nodes';

    // Modal chrome is built once per open; navigation only swaps the sub-graph
    // layer inside `substageEl`, so the modal frame never re-mounts → no flicker.
    let bodyEl: HTMLElement | null = null;
    let substageEl: HTMLElement | null = null;
    let modeBtn: HTMLButtonElement | null = null;
    const navBtns: Partial<Record<Dir, HTMLButtonElement>> = {};

    const shellEl = () => contexts.places.el(Places.Top)?.parentElement as HTMLElement | null;
    const graph = () => graphs.current;
    const node = (id: string | null) => (id ? (graph().getNode(id) as GraphNode | undefined) : undefined);
    const firstNodeId = () => graph().nodes()[0]?.id ?? null;

    const dirOf = (from: GraphNode, to: GraphNode): Dir => {
      if (!from.Position || !to.Position) return 'right';
      const dx = to.Position.x - from.Position.x, dy = to.Position.y - from.Position.y;
      if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
      return dy >= 0 ? 'down' : 'up';
    };
    const neighbours = (id: string): Neighbour[] => {
      const focus = node(id);
      if (!focus) return [];
      const out: Neighbour[] = [];
      graph().edgesOf(id).forEach(edge => {
        const otherId = edge.From === id ? edge.To : edge.From;
        const other = node(otherId);
        if (!other || otherId === id) return;
        out.push({ node: other, edge, outgoing: edge.From === id, dir: dirOf(focus, other) });
      });
      return out;
    };
    const bySide = (list: Neighbour[]): Record<Dir, Neighbour[]> => {
      const sides: Record<Dir, Neighbour[]> = { up: [], down: [], left: [], right: [] };
      list.forEach(n => sides[n.dir].push(n));
      return sides;
    };

    /** Where a neighbour sits inside the lens: fixed compass slots, spread along
     *  the side by the widest/tallest member so cards never touch. */
    const slotPos = (dir: Dir, i: number, count: number, span: number) => {
      const spread = (i - (count - 1) / 2) * span;
      if (dir === 'up') return { x: spread, y: -RING };
      if (dir === 'down') return { x: spread, y: RING };
      if (dir === 'left') return { x: -RING, y: spread };
      return { x: RING, y: spread };
    };

    // --- Render context reusing the real entity renderers over a positioned set ---
    const buildCtx = (items: Map<string, GraphNode>, kind: ItemRef['kind']): EntityRenderCtx => ({
      graph: { getItem: ref => items.get((ref as ItemRef).id), itemsOfKind: () => [] },
      refOf: id => ({ kind, id }),
      tagItem,
      applyItemModes: () => {},
      wireAffordances: () => {},
      cloneTemplate: name => contexts.templates.clone(name) as never,
      templateSlot: (root, name) => contexts.templates.slot(root, name),
      templateText: (root, name, value) => { contexts.templates.text(root, name, value); },
      parentChain: () => [],
      isFolded: () => false,
      boundsOf: ref => { const n = items.get(ref.id); return n ? rectOf(n) : null; },
      boundsInRect: (_kind, area) => [...items.values()].map(rectOf).filter(rect =>
        rect.x < area.x + area.w && rect.x + rect.w > area.x
        && rect.y < area.y + area.h && rect.y + rect.h > area.y),
    });

    const compass = (focus: string) => {
      const fnode = node(focus)!;
      const list = neighbours(focus);
      const sides = bySide(list);
      const items = new Map<string, GraphNode>();
      items.set(focus, { ...fnode, Position: { x: 0, y: 0 } } as GraphNode);
      const edges: GraphEdge[] = [];
      let overflow = false;
      DIRS.forEach(dir => {
        const arr = sides[dir].slice(0, MAX_PER_SIDE);
        if (sides[dir].length > MAX_PER_SIDE) overflow = true;
        const span = Math.max(120, ...arr.map(n => (dir === 'up' || dir === 'down' ? (n.node.Size?.w ?? 160) : (n.node.Size?.h ?? 72)) + 44));
        arr.forEach((nb, i) => {
          items.set(nb.node.id, { ...nb.node, Position: slotPos(dir, i, arr.length, span) } as GraphNode);
          // 'nodes' mode hides edge labels (default); 'edges' mode shows them.
          edges.push((mode === 'nodes' ? { ...nb.edge, Label: undefined } : { ...nb.edge }) as GraphEdge);
        });
      });
      return { items, edges, sides, overflow };
    };

    const unionRect = (rects: Rect[]): Rect => {
      const minX = Math.min(...rects.map(r => r.x)), minY = Math.min(...rects.map(r => r.y));
      const maxX = Math.max(...rects.map(r => r.x + r.w)), maxY = Math.max(...rects.map(r => r.y + r.h));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    };

    const renderSubstage = () => {
      const shell = shellEl();
      if (shell) {
        shell.dataset.present = active ? 'true' : 'false';
        shell.dataset.presentMode = mode;
        shell.dataset.presentFocus = focusId ?? '';
      }
      if (!active || !substageEl || !focusId || !node(focusId)) return;
      const { items, edges, sides, overflow } = compass(focusId);

      const layer = contexts.templates.clone('nodes') as HTMLElement;
      const svgLayer = contexts.templates.slot(layer, 'edges') as HTMLElement;
      const nodeCtx = buildCtx(items, 'node'), edgeCtx = buildCtx(items, 'edge');
      const edgeRender = model.entity('edge')!.render!, nodeRender = model.entity('node')!.render!;
      edges.forEach(e => { const el = edgeRender.draw(e, edgeCtx); if (el) svgLayer.append(el); });
      items.forEach(n => {
        const el = nodeRender.draw(n, nodeCtx) as HTMLElement | null;
        if (!el) return;
        // Inside the lens a node click NAVIGATES; strip the inline-edit hook so a
        // double-click can't mutate the real graph, and mark it as a focus target.
        el.querySelector('[data-editable-title]')?.removeAttribute('data-editable-title');
        if (n.id !== focusId) el.dataset.presentFocus = n.id;
        else el.classList.add('present-focus-node');
        layer.append(el);
      });
      // Overflow chips ("+N") beyond the third slot on any crowded side.
      DIRS.forEach(dir => {
        const extra = sides[dir].length - MAX_PER_SIDE;
        if (extra <= 0) return;
        const p = slotPos(dir, MAX_PER_SIDE, MAX_PER_SIDE + 1, 160);
        const chip = document.createElement('div');
        chip.className = 'present-ellipsis';
        chip.textContent = `+${extra}`;
        chip.style.left = `${p.x}px`;
        chip.style.top = `${p.y}px`;
        layer.append(chip);
      });

      // Fit the lens into the substage box; align the grid to the same transform.
      const host = substageEl;
      const hw = host.clientWidth || 640, hh = host.clientHeight || 420;
      const b = unionRect([...items.values()].map(rectOf));
      const pad = 70;
      const s = Math.min(hw / (b.w + 2 * pad), hh / (b.h + 2 * pad), 1.15);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const tx = hw / 2 - s * cx, ty = hh / 2 - s * cy;
      layer.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      host.style.setProperty('--grid-size', `${32 * s}px`);
      host.style.setProperty('--grid-x', `${tx}px`);
      host.style.setProperty('--grid-y', `${ty}px`);
      host.dataset.mode = mode;
      host.replaceChildren(layer);

      DIRS.forEach(dir => { if (navBtns[dir]) navBtns[dir]!.disabled = sides[dir].length === 0; });
      if (modeBtn) modeBtn.textContent = mode === 'nodes' ? 'Show edge labels' : 'Show node text';
      if (shell) {
        shell.dataset.presentNeighbours = String(items.size - 1);
        shell.dataset.presentOverflow = overflow ? 'true' : 'false';
      }
    };

    const setFocus = (id: string | null) => { focusId = id; renderSubstage(); }; // never touches the main canvas

    const button = (cls: string, data: [string, string], text: string, label = text): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.dataset[data[0]] = data[1];
      b.textContent = text;
      b.setAttribute('aria-label', label);
      return b;
    };

    const buildBody = () => {
      bodyEl = document.createElement('div');
      bodyEl.className = 'present-body';
      substageEl = document.createElement('div');
      substageEl.className = 'present-substage';
      bodyEl.append(substageEl);

      const controls = document.createElement('div');
      controls.className = 'present-controls';
      modeBtn = button('present-mode-toggle', ['presentMode', 'toggle'], 'Show edge labels');
      const jump = button('present-jump', ['presentJump', 'true'], 'Open in canvas', 'Select and focus this node on the main canvas');

      const pad = document.createElement('div');
      pad.className = 'present-pad';
      (['up', 'left', 'right', 'down'] as Dir[]).forEach(dir => {
        const glyph = { up: '▲', down: '▼', left: '◀', right: '▶' }[dir];
        const b = button(`present-nav present-nav-${dir}`, ['presentMove', dir], glyph, `Move ${dir}`);
        navBtns[dir] = b;
        pad.append(b);
      });
      controls.append(modeBtn, pad, jump);
      bodyEl.append(controls);
    };

    const clearRefs = () => { bodyEl = substageEl = modeBtn = null; (Object.keys(navBtns) as Dir[]).forEach(d => delete navBtns[d]); };

    const enter = () => {
      active = true;
      mode = 'nodes';
      focusId = selection.selectedNode()?.id ?? firstNodeId();
      buildBody();
      emit('modal.open', { title: 'Presentation', body: bodyEl!, visual: 'present' });
      renderSubstage();
      // Re-fit once the modal has real dimensions (first paint measured 0).
      frameLoop.schedule('present.refit', renderSubstage, 30);
    };

    contexts.commands.register([
      {
        id: 'present.toggle', label: 'Presentation mode', group: 'view',
        shortcut: 'Shift+P', input: { on: 'keydown', key: 'P', shift: true, prevent: true },
        available: () => graph().nodes().length > 0 || active,
      },
      {
        id: 'present.frame.focus', label: 'Focus node', event: 'present.focus', group: 'view', hidden: true,
        input: { on: 'click', selector: '.present-substage [data-present-focus]' },
        payload: source => ({ id: (source.target as HTMLElement).closest('[data-present-focus]')!.getAttribute('data-present-focus')! }),
      },
      {
        id: 'present.frame.move', label: 'Move focus', event: 'present.move', group: 'view', hidden: true,
        input: { on: 'click', selector: '[data-present-move]' },
        payload: source => ({ dir: (source.target as HTMLElement).closest('[data-present-move]')!.getAttribute('data-present-move')! as Dir }),
      },
      { id: 'present.frame.mode', label: 'Toggle presentation content', event: 'present.mode.toggle', group: 'view', hidden: true, input: { on: 'click', selector: '[data-present-mode]' } },
      { id: 'present.frame.jump', label: 'Open node in canvas', event: 'present.jump', group: 'view', hidden: true, input: { on: 'click', selector: '[data-present-jump]' } },
    ]);

    on('present.toggle', () => { if (active) emit('modal.close'); else enter(); });
    on('present.focus', ({ id }) => { if (active) setFocus(id); });
    on('present.mode.toggle', () => { mode = mode === 'nodes' ? 'edges' : 'nodes'; renderSubstage(); });
    on('present.move', ({ dir }) => {
      if (!active || !focusId) return;
      const next = neighbours(focusId).filter(n => n.dir === dir)[0];
      if (next) setFocus(next.node.id);
    });
    on('present.jump', () => {
      const id = focusId;
      emit('modal.close'); // exits present via the modal.close handler below
      if (!id) return;
      emit('selection.item.select', nodeRef(id));
      emit('view.fit.item', nodeRef(id));
    });
    // Modal Close button / backdrop / Escape all route through modal.close; when
    // ours closes, tear down present state. The main canvas was never moved.
    on('modal.close', () => {
      if (!active) return;
      active = false;
      const shell = shellEl();
      if (shell) shell.dataset.present = 'false';
      clearRefs();
    });
    // Keep the lens live if the focus node or its edges change while presenting.
    on('graph.node.updated', () => { if (active) renderSubstage(); });
    on('graph.edge.updated', () => { if (active) renderSubstage(); });
    on('graph.edge.created', () => { if (active) renderSubstage(); });
    on('graph.edge.deleted', () => { if (active) renderSubstage(); });

    contribute({ surface: 'top', command: 'present.toggle', kind: 'button', text: '▣', label: 'Presentation mode', order: 81 });
  }, { requires: ['render', 'graph'] });
}
