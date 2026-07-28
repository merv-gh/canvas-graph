import { itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { ItemRef, Position } from '../types';
import { ability, action } from './shared';
import type { Positioned } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'drag.item.start': { ref: ItemRef; x: number; y: number };
    'drag.item.move': { x: number; y: number };
    'drag.item.end': void;
    'drag.item.moved': { ref: ItemRef };
  }
}

/** Chrome that owns its own pointer gestures — never a drag start. */
const DRAG_BLOCKERS = '.stage.ink-erasing, .tool-panel, .item-toolbar, .modal-layer, [data-command], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .editing, [contenteditable="true"], [contenteditable="plaintext-only"], input, textarea, select, button, label';

/** Draggable — any item with a `Position` can be moved from the surface its
 * renderer marks `[data-drag-surface]` (whole node, container title bar).
 * No separate grip: the surface itself is the affordance. */
export const draggable = <T extends Positioned>() => ability<T>('draggable', [action<T>({
  id: 'item.drag',
  label: 'Drag item directly',
  ui: [{
    surface: 'entity',
    command: 'drag.item.surface.start',
    kind: 'handler',
    slot: Slots.Drag,
    attrs: { 'data-drag-surface': '' },
  }],
})]);

export function registerDraggable(system: Registry) {
  system('ability.draggable', ({ on, emit, contexts, graphs, perf }) => {
    let drag:
      | { ref: ItemRef; pointer: Position; start: Position; client: Position; moved: boolean; el: Element | null; pointerId: number }
      | null = null;
    // Only the last pointer position matters per frame (commands.ts COALESCE
    // batching ensures drag.item.move fires at most once per rAF).
    let pending: Position | null = null;
    let captured: { el: Element; id: number } | null = null;
    /** Screen pixels of travel before a press counts as a drag. Below it the
     *  gesture is still a click — which is what keeps double-click-to-rename
     *  and button presses working on a surface that is also draggable. */
    const DRAG_THRESHOLD = 4;

    const applyMove = () => {
      const d = drag;
      const p = pending;
      if (!d || !p) return;
      pending = null;
      const t0 = perf.enabled() ? performance.now() : 0;
      if (!d.moved && Math.hypot(p.x - d.client.x, p.y - d.client.y) < DRAG_THRESHOLD) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, p);
      const Position = { x: d.start.x + pointer.x - d.pointer.x, y: d.start.y + pointer.y - d.pointer.y };
      if (!d.moved) {
        d.moved = true;
        // Capture here, not on pointerdown: capturing early retargets the
        // browser's own click/dblclick at the captured element, which silently
        // broke double-click-to-edit on anything inside a drag surface.
        if (d.el && typeof (d.el as HTMLElement).setPointerCapture === 'function') {
          try {
            (d.el as HTMLElement).setPointerCapture(d.pointerId);
            captured = { el: d.el, id: d.pointerId };
          } catch { /* pointer already released */ }
        }
      }
      if (d.ref.kind === 'node') {
        // Hot node path stays direct: no generic storage dispatch per frame.
        graphs.current.updateNode(d.ref.id, { Position });
        emit('graph.node.updated', { graphId: graphs.current.id, id: d.ref.id, patch: { Position }, visual: true });
      } else {
        // Plugin entities (containers today) own their storage. Generic update
        // makes their advertised draggable ability real and preserves cascades.
        emit('item.update', { ref: d.ref, patch: { Position } });
      }
      if (perf.enabled()) {
        perf.count('Drag.move');
        perf.sample('Drag.move.ms', performance.now() - t0);
      }
    };

    /** Arms a drag. Pointer capture is deferred to the first real move (see
     *  `applyMove`) so a press that turns out to be a click keeps its normal
     *  event targets. */
    const startPayload = ({ event, target }: { event?: Event; target?: Element | null }) => {
      const e = event as PointerEvent;
      pendingCapture = { el: target instanceof Element ? target : null, id: e.pointerId };
      const ref = itemRefFrom(target);
      return ref ? { ref, x: e.clientX, y: e.clientY } : undefined;
    };
    let pendingCapture: { el: Element | null; id: number } = { el: null, id: 0 };

    contexts.commands.register([
      {
        // Drag the item by its own body. Arms before selection (priority) but
        // does not `stop`, so the same press both picks the item and starts the
        // drag; no `prevent`, so double-click-to-rename still reaches the title.
        id: 'drag.item.surface.start',
        label: 'Start drag from item body',
        event: 'drag.item.start',
        group: 'drag',
        hidden: true,
        input: {
          on: 'pointerdown',
          selector: '[data-drag-surface]',
          priority: -10,
          when: event => !(event.target as Element).closest(DRAG_BLOCKERS),
        },
        payload: startPayload,
      },
      {
        id: 'drag.item.move',
        label: 'Move dragged item',
        group: 'drag',
        hidden: true,
        input: { on: 'pointermove', when: () => !!drag, prevent: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      { id: 'drag.item.end', label: 'End drag', group: 'drag', hidden: true, input: { on: 'pointerup', when: () => !!drag } },
    ]);

    on('drag.item.start', ({ ref, x, y }) => {
      const item = graphs.current.getItem(ref) as Positioned | undefined;
      if (item?.Position) drag = {
        ref,
        pointer: contexts.view.clientToSpace(Places.Stage, { x, y }),
        start: { ...item.Position },
        client: { x, y },
        moved: false,
        el: pendingCapture.el,
        pointerId: pendingCapture.id,
      };
    });
    on('drag.item.move', ({ x, y }) => {
      if (!drag) return;
      pending = { x, y };
      applyMove();
    });
    on('drag.item.end', () => {
      const d = drag;
      if (pending && d) applyMove();
      // Release pointer capture.
      if (captured) {
        try { (captured.el as HTMLElement).releasePointerCapture?.(captured.id); } catch { /* already released */ }
        captured = null;
      }
      // Single item.update on drop — fires facts, syncs storage / outline / hierarchy.
      // A click that never moved is not a drop: skip it so plain selection
      // doesn't write a no-op patch (and a spurious undo step).
      if (d?.moved) {
        const item = graphs.current.getItem(d.ref) as Positioned | undefined;
        if (item?.Position && d.ref.kind === 'node') emit('item.update', { ref: d.ref, patch: { Position: item.Position } });
        if (item?.Position) emit('drag.item.moved', { ref: d.ref });
      }
      drag = null;
      pending = null;
    });
  });
}
