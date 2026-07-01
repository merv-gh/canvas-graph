/** Runtime constants — split from types.ts so type definitions stay focused on the MODEL MAP.
 *  Re-exported from types.ts for backward compatibility. */

export const Places = { Top: 'top', Left: 'left', Stage: 'stage', Modal: 'modal' } as const;
export type Place = typeof Places[keyof typeof Places];

/** Named slots inside an entity's rendered card. Abilities point their
 *  `AffordanceDef.slot` at one of these; the renderer (`render-stage`,
 *  `item-toolbar`) reads the same names when wiring affordances to template
 *  `[data-slot=...]` elements. Centralized so a typo at either end becomes a
 *  TypeScript error AND a DX rule. */
export const Slots = {
  /** Drag handle (handler affordance, draggable). Entity surface. */
  Drag: 'drag',
  /** Resize handle (handler affordance, resizeable). Entity surface. */
  Resize: 'resize',
  /** Default catch-all slot for button affordances with no explicit slot. Entity surface. */
  Header: 'header',
  /** Left-of-title button row (collapsible). Entity surface. */
  HeaderStart: 'header:start',
  /** Right-of-title button row (configurable). Entity surface. */
  HeaderEnd: 'header:end',
  /** Editable title element (matches template `[data-editable-title]`). Entity surface. */
  Title: 'title',
  /** Leading toolbar group. Top surface (system affordance). */
  Start: 'start',
  /** Trailing toolbar group. Top surface (system affordance). */
  End: 'end',
} as const;
export type SlotName = typeof Slots[keyof typeof Slots];

/** Slots that live on the per-entity surface — DX checks `AffordanceDef.slot`
 *  against this narrower set. Toolbar Start/End live on the top surface. */
export const EntitySlots: ReadonlySet<SlotName> = new Set([
  Slots.Drag, Slots.Resize, Slots.Header, Slots.HeaderStart, Slots.HeaderEnd, Slots.Title,
]);

/** Past-tense suffixes that mark an event as a fact (something already happened).
 *  Convention rule: imperative names (`graph.node.create`) are requests; fact names
 *  (`graph.node.created`) are emitted by the owning system after the change lands.
 *  Other systems subscribe to facts, never to requests. The render scheduler reads
 *  facts as redraw triggers via `factScope`. */
export const FACT_SUFFIXES = ['.created', '.updated', '.deleted', '.switched', '.selected', '.focused', '.changed'] as const;
export type FactSuffix = typeof FACT_SUFFIXES[number];
