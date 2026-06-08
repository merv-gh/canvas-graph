import type { Place, Position, Rect, Size, ViewState } from '../types';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** Generic centered-rect of a positioned, sized item. Structural to avoid
 *  pulling kind-specific types into core/view. */
export const nodeRect = (node: { Position?: Position; Size: Size }): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};
export const clientPoint = (event: Event): Position => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY });
export const isStageSurface = (event: Event, stage: Element) =>
  event.target === stage || (event.target instanceof Element && event.target.classList.contains('nodes'));

/** Bridges graph-space (where nodes live) with screen-space (where the stage element
 *  paints). Exposed as a context so render, drag, pan, and zoom share one camera. */
export function viewContext(places: Map<Place, HTMLElement>) {
  let state: ViewState = { x: 0, y: 0, scale: 1 };
  const localRect = (place: Place) => places.get(place)?.getBoundingClientRect();
  const get = () => ({ ...state });
  const set = (next: Partial<ViewState>) => {
    state = {
      x: next.x ?? state.x,
      y: next.y ?? state.y,
      // Wide clamp so fit-view can shrink for big graphs and zoom-in deep on a single node.
      scale: clamp(next.scale ?? state.scale, 0.05, 5),
    };
    return get();
  };
  const zoomAtScreen = (screen: Position, factor: number) => {
    const before = screenToSpace(screen);
    const scale = clamp(state.scale * factor, 0.05, 5);
    return set({ scale, x: before.x - screen.x / scale, y: before.y - screen.y / scale });
  };
  const clientToScreen = (place: Place, point: Position) => {
    const rect = localRect(place);
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : point;
  };
  const screenToSpace = (point: Position) => ({ x: state.x + point.x / state.scale, y: state.y + point.y / state.scale });
  const spaceToScreen = (point: Position) => ({ x: (point.x - state.x) * state.scale, y: (point.y - state.y) * state.scale });
  const clientToSpace = (place: Place, point: Position) => screenToSpace(clientToScreen(place, point));
  const screenCenter = (place: Place) => {
    const rect = localRect(place);
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  };
  const spaceCenter = (place: Place) => screenToSpace(screenCenter(place));
  const visibleRect = (place: Place, margin = 0): Rect | null => {
    const rect = localRect(place);
    if (!rect) return null;
    return {
      x: state.x - margin,
      y: state.y - margin,
      w: rect.width / state.scale + margin * 2,
      h: rect.height / state.scale + margin * 2,
    };
  };
  const isVisible = (place: Place, rect: Rect, margin = 0) => {
    const visible = visibleRect(place, margin);
    return !visible || rectsIntersect(visible, rect);
  };
  return { get, set, clientToScreen, screenToSpace, spaceToScreen, clientToSpace, screenCenter, spaceCenter, visibleRect, isVisible, zoomAtScreen };
}
