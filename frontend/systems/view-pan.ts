import { clamp, clientPoint, isStageSurface, type Registry } from '../core';
import { Places } from '../types';
import type { Position, ViewState } from '../types';

declare module '../types' {
  interface CustomEvents {
    'view.pan.start': Position & { pointerId: number };
    'view.pan.move': Position & { pointerId: number };
    'view.pan.end': { pointerId: number };
    /** Trackpad two-finger scroll → pan (pinch, i.e. ctrl+wheel, stays zoom). */
    'view.wheel.pan': { dx: number; dy: number };
  }
}

/** Shared gesture state so pan (move-intent) and marquee (select-intent) split
 *  the same pointerdown cleanly: pan owns two-finger / middle / space / alt,
 *  marquee owns a bare single primary pointer. Tracked here (pan is the
 *  render-adjacent camera owner) and read by `marquee.ts`. */
const gesture = { pointers: new Set<number>(), points: new Map<number, Position>(), space: false };

/** Pure two-touch transform: keep graph point beneath starting centroid under
 * current centroid while distance ratio controls scale. This makes pinch and
 * two-finger translation one stable gesture instead of competing handlers. */
export const touchGestureView = (
  start: ViewState,
  startCenter: Position,
  currentCenter: Position,
  startDistance: number,
  currentDistance: number,
): ViewState => {
  const scale = clamp(start.scale * (currentDistance / Math.max(1, startDistance)), 0.05, 5);
  const anchor = {
    x: start.x + startCenter.x / start.scale,
    y: start.y + startCenter.y / start.scale,
  };
  return {
    x: anchor.x - currentCenter.x / scale,
    y: anchor.y - currentCenter.y / scale,
    scale,
  };
};

/** A pointerdown is "move intent" (→ pan) when it's a SECOND touch (two fingers
 *  down), the middle button, or space/alt is held. Everything else on the empty
 *  stage is select intent (→ marquee). The window-capture tracker adds the
 *  CURRENT pointer before this runs, so `size` already counts this finger — a
 *  lone finger is `size === 1` (select); the second makes it `>= 2` (pan). */
export const isMoveIntent = (event: PointerEvent) =>
  event.button === 1 || event.altKey || gesture.space ||
  (event.pointerType === 'touch' && gesture.pointers.size >= 2);

export function registerViewPan(system: Registry) {
  system('view.pan', ({ on, emit, contexts, frameLoop }) => {
    let pan: { pointer: { x: number; y: number }; view: ViewState } | null = null;
    let panPointerId = -1;
    let touch: { ids: [number, number]; view: ViewState; center: Position; distance: number } | null = null;
    let wheelAccum = { dx: 0, dy: 0 };
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());

    // --- Pointer/space bookkeeping (feeds isMoveIntent) ---
    const onDown = (e: PointerEvent) => {
      gesture.pointers.add(e.pointerId);
      if (e.pointerType === 'touch') gesture.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onMove = (e: PointerEvent) => {
      if (gesture.points.has(e.pointerId)) gesture.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => {
      gesture.pointers.delete(e.pointerId);
      gesture.points.delete(e.pointerId);
    };
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') gesture.space = e.type === 'keydown'; };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);

    const setViewFor = (pointer: Position) => {
      if (!pan) return;
      contexts.view.set({
        x: pan.view.x - (pointer.x - pan.pointer.x) / pan.view.scale,
        y: pan.view.y - (pointer.y - pan.pointer.y) / pan.view.scale,
      });
    };
    const beginTouch = () => {
      const entries = [...gesture.points.entries()].slice(0, 2);
      if (entries.length < 2) return null;
      const [[aId, a], [bId, b]] = entries;
      const center = contexts.view.clientToScreen(Places.Stage, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      return {
        ids: [aId, bId] as [number, number],
        view: contexts.view.get(),
        center,
        distance: Math.hypot(b.x - a.x, b.y - a.y),
      };
    };
    const applyTouch = () => {
      if (!touch) return false;
      const a = gesture.points.get(touch.ids[0]);
      const b = gesture.points.get(touch.ids[1]);
      if (!a || !b) return false;
      const center = contexts.view.clientToScreen(Places.Stage, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      contexts.view.set(touchGestureView(
        touch.view,
        touch.center,
        center,
        touch.distance,
        Math.hypot(b.x - a.x, b.y - a.y),
      ));
      return true;
    };

    contexts.commands.register([
      {
        id: 'view.pan.start',
        label: 'Start canvas pan',
        event: 'view.pan.start',
        group: 'view',
        hidden: true,
        input: {
          on: 'pointerdown', selector: stageSelector,
          // Only move-intent gestures pan; a bare pointer is left for marquee.
          when: (event, stage) => isStageSurface(event, stage) && isMoveIntent(event as PointerEvent),
          prevent: true,
        },
        payload: ({ event }) => ({ ...clientPoint(event!), pointerId: (event as PointerEvent).pointerId }),
      },
      {
        id: 'view.pan.move',
        label: 'Pan canvas',
        event: 'view.pan.move',
        group: 'view',
        hidden: true,
        input: { on: 'pointermove', when: () => !!pan, prevent: true },
        payload: ({ event }) => ({ ...clientPoint(event!), pointerId: (event as PointerEvent).pointerId }),
      },
      {
        id: 'view.pan.end', label: 'End canvas pan', event: 'view.pan.end', group: 'view', hidden: true,
        input: { on: 'pointerup', when: () => !!pan },
        payload: ({ event }) => ({ pointerId: (event as PointerEvent).pointerId }),
      },
      {
        // Plain wheel (trackpad two-finger scroll / mouse wheel) pans; pinch
        // (ctrl+wheel) is left to view.zoom.wheel. This is the map/Figma model and
        // makes "two fingers = move" work on a trackpad, where the gesture arrives
        // as wheel deltas, not pointer events.
        id: 'view.wheel.pan', label: 'Wheel pan', event: 'view.wheel.pan', group: 'view', hidden: true,
        input: { on: 'wheel', selector: stageSelector, when: event => !(event as WheelEvent).ctrlKey, prevent: true },
        payload: ({ event }) => ({ dx: (event as WheelEvent).deltaX, dy: (event as WheelEvent).deltaY }),
      },
    ]);

    on('view.wheel.pan', ({ dx, dy }) => {
      wheelAccum.dx += dx;
      wheelAccum.dy += dy;
      frameLoop.schedule('view.pan.wheel', () => {
        if (!wheelAccum.dx && !wheelAccum.dy) return;
        const v = contexts.view.get();
        contexts.view.set({ x: v.x + wheelAccum.dx / v.scale, y: v.y + wheelAccum.dy / v.scale });
        wheelAccum = { dx: 0, dy: 0 };
        commit();
      }, 10);
    });

    on('view.pan.start', ({ x, y, pointerId = 0 }) => {
      // A second finger landing mid-marquee escalates to pan — tell marquee to bail.
      emit('select.box.cancel');
      pan = { pointer: { x, y }, view: contexts.view.get() };
      panPointerId = pointerId;
      touch = gesture.points.size >= 2 ? beginTouch() : null;
      contexts.places.el(Places.Stage)?.classList.add('panning');
    });
    on('view.pan.move', p => {
      if (touch && applyTouch()) {
        frameLoop.schedule('view.pan.commit', commit, 10);
        return;
      }
      const pointerId = p?.pointerId ?? panPointerId;
      if (pan && pointerId === panPointerId) {
        setViewFor({ x: p!.x, y: p!.y });
        frameLoop.schedule('view.pan.commit', commit, 10);
      }
    });
    on('view.pan.end', p => {
      const pointerId = p?.pointerId ?? panPointerId;
      // Either finger ending completes a two-touch transform. Single-pointer
      // panning remains pinned to its owner.
      if (!touch && pan && pointerId !== panPointerId) return;
      commit();
      frameLoop.cancel('view.pan.commit');
      pan = null;
      touch = null;
      panPointerId = -1;
      contexts.places.el(Places.Stage)?.classList.remove('panning');
    });

    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      gesture.pointers.clear();
      gesture.points.clear();
    };
  }, { requires: ['render'] });
}
