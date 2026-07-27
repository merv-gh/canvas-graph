import type { Registry } from '../core';
import { Places } from '../types';
import type { Id, Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'ghost.node.create': void;
  }
}

/** Matches `layout.creation`'s assumed new-node size — the ghost is a
 *  true-size preview of the node a click would land. */
const GHOST_SIZE = { w: 150, h: 64 };
const VIEW_KEY = 'ghost-node';

/** Ghost node: a dashed, node-sized placeholder floating at the exact spot
 *  where the active layout mode would place the selected node's next item.
 *  Clicking it creates a real node there, always connected from the selected
 *  one. Selection then moves to the new node, so the ghost re-anchors and
 *  repeated clicks chain a flow. Pure presentation: no data is touched until
 *  the click emits `graph.node.create`. */
export function registerGhostNode(system: Registry) {
  system('ghost.node', ({ on, emit, contexts, graphs, selection, layout }) => {

    /** The single selected node + the graph-space center its next connected
     *  node would land at. Null whenever the ghost should be hidden:
     *  multi/empty selection, non-node selection, unpositioned node, or the
     *  layout system being flag-disabled. */
    const anchor = (): { id: Id; at: Position; label: string } | null => {
      if (selection.selectedAll().length !== 1) return null;
      const ref = selection.selected();
      if (!ref || ref.kind !== 'node') return null;
      const node = graphs.current.getNode(ref.id);
      if (!node?.Position) return null;
      const at = layout?.creation(node.id, false)?.Position;
      if (!at) return null;
      const dx = at.x - node.Position.x;
      const dy = at.y - node.Position.y;
      const direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'above' : 'below');
      return { id: node.id, at, label: `Add connected ${direction}` };
    };

    const clear = () => emit('render.view.clear', { place: Places.Stage, key: VIEW_KEY });

    const draw = () => {
      const target = anchor();
      if (!target) return clear();
      const scale = contexts.view.get().scale;
      const screen = contexts.view.spaceToScreen(target.at);
      emit('render.view.set', {
        place: Places.Stage,
        key: VIEW_KEY,
        view: () => {
          const ghost = document.createElement('button');
          ghost.type = 'button';
          ghost.className = 'ghost-node';
          ghost.dataset.command = 'ghost.node.create';
          ghost.dataset.ghostNode = '';
          ghost.dataset.ghostX = String(target.at.x);
          ghost.dataset.ghostY = String(target.at.y);
          ghost.setAttribute('aria-label', target.label);
          ghost.title = `${target.label} · exact placement preview`;
          ghost.style.left = `${screen.x - (GHOST_SIZE.w * scale) / 2}px`;
          ghost.style.top = `${screen.y - (GHOST_SIZE.h * scale) / 2}px`;
          ghost.style.width = `${GHOST_SIZE.w * scale}px`;
          ghost.style.height = `${GHOST_SIZE.h * scale}px`;
          const plus = document.createElement('b');
          plus.textContent = '+';
          const label = document.createElement('span');
          label.textContent = target.label.replace('connected ', '');
          ghost.append(plus, label);
          return ghost;
        },
      });
    };

    contexts.commands.register([{
      id: 'ghost.node.create',
      label: 'Add connected node',
      group: 'editing',
      hidden: true,
      input: { on: 'click', selector: '[data-ghost-node]', prevent: true, stop: true },
    }]);

    on('ghost.node.create', () => {
      // Recompute at click time — the anchor may have moved since the draw.
      const target = anchor();
      if (!target) return;
      emit('graph.node.create', {
        Label: { text: `Node ${graphs.current.nodes().length + 1}` },
        Position: target.at,
        // Always connect, whatever the mode's `A`-key semantics: that is the
        // ghost's contract. Exact preview coordinates + keepView make pointer
        // placement deterministic. No keepFocus — selection follows the node.
        relativeTo: target.id,
        connectFrom: target.id,
        keepView: true,
      });
    });

    // Redraw with the stage flush cycle only — the item-toolbar pattern.
    // Selection/mode/graph facts all schedule a redraw via their fact
    // suffixes, so subscribing to them separately would repaint the ghost
    // once per *event* instead of once per *flush* (redraw budget, PRINCIPLE 8).
    on('render.stage.draw', draw);
    on('render.stage.camera', draw);
    return clear;
  }, { requires: ['render.stage', 'graph'] });
}
