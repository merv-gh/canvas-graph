import type { Position } from '../types';

/** Shared low-level pointer facts. Camera and selection policies both consume
 * them; neither system owns the other. */
const state = { pointers: new Set<number>(), points: new Map<number, Position>(), space: false };

export const pointerGesture = {
  state,
  down(event: PointerEvent) {
    state.pointers.add(event.pointerId);
    if (event.pointerType === 'touch') state.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
  },
  move(event: PointerEvent) {
    if (state.points.has(event.pointerId)) state.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
  },
  up(event: PointerEvent) {
    state.pointers.delete(event.pointerId);
    state.points.delete(event.pointerId);
  },
  key(event: KeyboardEvent) { if (event.code === 'Space') state.space = event.type === 'keydown'; },
  isMoveIntent(event: PointerEvent) {
    return event.button === 1 || event.altKey || state.space
      || (event.pointerType === 'touch' && state.pointers.size >= 2);
  },
  clear() { state.pointers.clear(); state.points.clear(); state.space = false; },
};

