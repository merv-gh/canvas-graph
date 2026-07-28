import type {
  AbilityDef,
  Id,
  ItemRef,
  PropertyDef,
  Rect,
  Size,
} from './types';

// ---------------------------------------------------------------------------
// Entity rendering
// ---------------------------------------------------------------------------

/** Structural slice of the live graph that an entity renderer needs.
 *  Kind-agnostic: callers go through `getItem(ref)` / `itemsOfKind(kind)`.
 *  An edge renderer that needs its endpoints calls `getItem({kind:'node', id})`. */
/** A straight run between two points — an edge's centre-to-centre line. */
export type Segment = { ax: number; ay: number; bx: number; by: number };

export type EntityRenderGraph = {
  getItem(ref: ItemRef): unknown | undefined;
  refById(id: Id): ItemRef | undefined;
  itemsOfKind<T = unknown>(kind: string): T[];
};

/** Reusable visual primitive. Node types choose one; adding a domain-specific
 * type normally adds catalog data, not renderer code. Add a primitive only when
 * the DOM treatment itself is genuinely new. */
export type NodeVisual = 'card' | 'circle' | 'rounded' | 'pill' | 'diamond' | 'parallelogram'
  | 'operator' | 'caption' | 'list' | 'section' | 'table' | 'switch' | 'timeline'
  | 'artifact' | 'agent' | 'approval';

export type NodeTypeDef = {
  id: string;
  label: string;
  category: string;
  keywords?: string[];
  visual: NodeVisual;
  defaultSize?: Size;
  /** Visual defaults used when an item has no explicit style override. */
  defaultFill?: 'none' | 'soft' | 'solid';
  defaultBorder?: 'none' | 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';
  /** False when the visual owns its geometry (tables, controls, run-report
   * primitives). Text edits then preserve the catalog-declared dimensions. */
  autoSize?: boolean;
};

/** Per-item render scope. The render system constructs this once per item and
 *  passes it to `entity.render.draw`. Renderers stay declarative — they do not
 *  reach for the DOM, item-modes, or affordances directly. */
export type EntityRenderCtx = {
  graph: EntityRenderGraph;
  /** Resolve node vocabulary through the model boundary. Renderers never import
   * palette/preset systems to understand a type. */
  nodeType(id: string): NodeTypeDef | undefined;
  /** Build a full ItemRef for *this entity's kind* with the parent chain
   *  populated from the hierarchy context. Use this instead of constructing
   *  ItemRef literals — containers/groups attach parent automatically, so
   *  selection / focus / item-modes round-trip correctly through the DOM. */
  refOf(id: Id): ItemRef;
  tagItem(el: Element, ref: ItemRef): void;
  applyItemModes(el: Element, ref: ItemRef): void;
  /** Wire ability affordances (handlers + buttons) for this item's entity into
   *  any [data-slot=...] holes on the cloned element. */
  wireAffordances(el: HTMLElement): void;
  cloneTemplate<T extends Element = HTMLElement>(name: string): T;
  templateSlot(root: Element, name: string): Element;
  templateText(root: Element, name: string, value: unknown): void;
  /** Outermost-first chain of ancestors registered with the hierarchy context.
   *  Empty when the ref is a root item. */
  parentChain(ref: ItemRef): ItemRef[];
  /** Whether a ref is folded (collapsed) — reads the fold store, not item data.
   *  Renderers use it for the 'collapsed' class and collapsed-ancestor hiding. */
  isFolded(ref: ItemRef): boolean;
  /** Resolve any ref's renderer bounds (its on-stage rect). Used by edge
   *  renderers to substitute a hidden node's collapsed ancestor as the
   *  visible endpoint. Returns null when the ref has no entity, no item, or
   *  the entity renderer doesn't declare bounds. */
  boundsOf(ref: ItemRef): Rect | null;
  /** Centre-to-centre lines of every item of `kind` except `exceptId`. The
   *  companion to `boundsInRect` for renderers that must avoid other people's
   *  connections, not just their cards. Cached per draw pass by the stage. */
  linesOfKind(kind: string, exceptId?: Id): Segment[];
  /** Resolve only the rendered bounds intersecting a graph-space area. This is
   * the spatial-query seam for renderers whose geometry must avoid nearby
   * entities without scanning the entire document for every painted item. */
  boundsInRect(kind: string, rect: Rect): Rect[];
};

export type EntityRenderer<T = unknown> = {
  /** Which paint layer the result belongs in. HTML → the transformed node layer;
   *  SVG → the edges <svg> child of that layer. */
  layer: 'html' | 'svg';
  /** Return null to skip this item this frame (e.g. an edge with missing endpoints). */
  draw(item: T, ctx: EntityRenderCtx): Element | null;
  /** Optional culling bounds in graph-space. When provided, render skips items
   *  whose bounds don't intersect the visible rect. */
  bounds?(item: T): Rect | null;
  /** Fast in-place position update. When the only thing that changed is where the
   *  item sits (drag / arrow-nudge — the common interactive case), the renderer
   *  moves the EXISTING element instead of being torn down and rebuilt. Keeping
   *  the same DOM node is what lets CSS transitions ease the move (and it's far
   *  cheaper). The stage only takes this path when `signature` is unchanged.
   *  `ctx` gives repositioners that depend on OTHER items' geometry (edges
   *  following their endpoints, collapsed-ancestor substitution) the same
   *  resolution powers as `draw`. */
  reposition?(el: Element, item: T, ctx: EntityRenderCtx): void;
  /** Cheap hash of everything that affects the rendered output *except* position.
   *  When it's unchanged between two updates of the same item, the stage uses
   *  `reposition` instead of a full redraw. Omit (or omit `reposition`) to always
   *  full-redraw — the safe default for kinds that don't move in place. */
  signature?(item: T): string;
  /** Override how items are collected for render. The default iterates
   *  `graph.itemsOfKind(entityDef.kind)`. Customise when an entity kind has
   *  a spatial index (nodes), an adjacency index (edges), or another
   *  performance structure the generic path can't use.
   *  `visibleNodeIds` is non-null when a viewport-culled set is available
   *  (node ids from the spatial grid); null means render everything. */
  collect?(graph: EntityRenderGraph, hiddenByFold: (r: { kind: string; id: string }) => boolean, visibleNodeIds: Set<string> | null): T[];
};

export type EntityDef<T, Patch = unknown> = {
  kind: string;
  label: string;
  labelOf: (item: T) => string;
  abilities: AbilityDef<T>[];
  properties?: PropertyDef<T, Patch>[];
  /** Optional renderer. When set, render iterates this entity's items through it
   *  blindly — adding a new entity kind (group, container, …) needs zero render
   *  edits. When unset, the entity is data-only (no stage representation). */
  render?: EntityRenderer<T>;
  /** Z-order during iteration. Lower paints first (= behind). Default 0.
   *  Containers want a negative value so they paint behind their children. */
  order?: number;
};

