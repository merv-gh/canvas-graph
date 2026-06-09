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
