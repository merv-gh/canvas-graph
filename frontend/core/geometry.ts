import type { Position, Rect, Size } from '../types';

/** Centered bounding rect of a positioned, sized item. Returns null when the
 *  item has no Position to anchor at. */
export const boundsOf = (
  item: { Position?: Position; Size?: Size },
  defaultSize: Size = { w: 0, h: 0 },
): Rect | null => {
  if (!item.Position) return null;
  const s = item.Size ?? defaultSize;
  return { x: item.Position.x - s.w / 2, y: item.Position.y - s.h / 2, w: s.w, h: s.h };
};

/** Smallest rect containing both inputs. */
export const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
};

/** Symmetric padding on all sides plus optional extra on top (for label bands). */
export const expandRect = (r: Rect, pad: number, topExtra = 0): Rect =>
  ({ x: r.x - pad, y: r.y - pad - topExtra, w: r.w + pad * 2, h: r.h + pad * 2 + topExtra });

/** Center of a rect. */
export const rectCenter = (r: Rect): Position => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Shrink a segment endpoint to the target rect's border, so an arrowhead
 *  lands outside the card rather than under it. Treats the target as an
 *  axis-aligned rect centered on `rectCenter` with half-dims `half`.
 *  Shared by the SVG edge renderer and the GPU scene builder. */
export const intersectRectBoundary = (
  outside: Position,
  rectCenter: Position,
  half: { w: number; h: number },
): Position => {
  const { x: cx, y: cy } = rectCenter;
  const dx = outside.x - cx, dy = outside.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : Math.abs(half.w / dx);
  const ty = dy === 0 ? Infinity : Math.abs(half.h / dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
};
