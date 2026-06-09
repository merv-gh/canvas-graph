import type { Id, Position, Size } from '../types';

/**
 * Structural shapes that abilities require.
 *
 * Abilities constrain their generic `T` to one of these, so the type checker
 * admits any entity with the matching fields — not just node/edge/container.
 * Adding a new entity kind (region, layer, group, …) just means: implement the
 * shapes the abilities you want it to have.
 *
 * Cheat sheet:
 *   selectable   → Identified  (every entity)
 *   configurable → Identified
 *   editable     → Labeled     (has a writable text label)
 *   draggable    → Positioned  (can be moved with pointer)
 *   nudgeable    → Positioned  (can be moved by arrow keys)
 *   collapsible  → Collapsable (has a toggle field)
 *   resizeable   → Sized       (has Size)
 */

export type Identified = { id: Id; kind: string };
export type Positioned = Identified & { Position?: Position };
export type Sized = Identified & { Size: Size };
export type Labeled = Identified & { Label: { text: string } };
export type Collapsable = Identified & { Collapsed?: boolean };
