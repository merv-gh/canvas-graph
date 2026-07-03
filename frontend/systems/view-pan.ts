import { clientPoint, isStageSurface, type Registry } from '../core';
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
const gesture = { pointers: new Set<number>(), space: false };

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
    // `panPointerId` pins the pan to the finger/button that started it. With two
    // fingers down, BOTH emit pointermove — responding to both makes the view
    // jump between their positions (the "two fingers same direction" jitter). We
    // track only the owner and drop the rest.
    let pan: { pointer: { x: number; y: number }; view: ViewState } | null = null;
    let panPointerId = -1;
    let wheelAccum = { dx: 0, dy: 0 };
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());

    // --- Pointer/space bookkeeping (feeds isMoveIntent) ---
    const onDown = (e: PointerEvent) => gesture.pointers.add(e.pointerId);
    const onUp = (e: PointerEvent) => gesture.pointers.delete(e.pointerId);
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') gesture.space = e.type === 'keydown'; };
    window.addEventListener('pointerdown', onDown, true);
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
      contexts.places.el(Places.Stage)?.classList.add('panning');
    });
    on('view.pan.move', p => {
      const pointerId = p?.pointerId ?? panPointerId;
      if (pan && pointerId === panPointerId) {
        setViewFor({ x: p!.x, y: p!.y });
        frameLoop.schedule('view.pan.commit', commit, 10);
      }
    });
    on('view.pan.end', p => {
      const pointerId = p?.pointerId ?? panPointerId;
      if (pan && pointerId !== panPointerId) return; // a non-owner finger lifting doesn't end the pan
      commit();
      frameLoop.cancel('view.pan.commit');
      pan = null;
      panPointerId = -1;
      contexts.places.el(Places.Stage)?.classList.remove('panning');
    });

    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, { requires: ['render'] });
}
