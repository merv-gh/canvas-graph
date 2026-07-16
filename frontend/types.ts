/**
 * ============================================================================
 *  MODEL MAP — read top-down; stop when you have enough.
 * ============================================================================
 *  frontend is a handful of nouns. Grasp these and you have the whole model; the full
 *  type for each is defined further down, in this same order (high → low), so
 *  you can skim the ladder and only descend into the detail you need.
 *
 *    L1 · Renderable    — anything the UI can show: `Node | () => Node`.
 *    L2 · ItemRef       — addresses one thing in the model (kind + id + parent).
 *    L3 · AppEvents     — the typed bus: imperative requests + past-tense facts.
 *    L4 · CommandSpec   — a reachable intent (key / form / picker → event).
 *    L5 · AbilityDef    — a capability an entity opts into (actions + affordances).
 *    L6 · EntityDef     — what a *kind* is (label, abilities, properties, render).
 *    L7 · CollectionDef / ModelDef — the lists, then the assembled model.
 *
 *  Everything else (Places, Slots, AffordanceDef, PropertyDef, geometry…) is a
 *  detail of one of those layers. The section banners below follow the ladder.
 *  Rule (Principle "types read high → low"): this map stays in sync with the
 *  real definitions, and they appear in this order — both are tested.
 * ============================================================================
 */

/**
 * Core types. Framework contracts only — domain types and events live with
 * their owning module.
 *
 * ## How to add a new ___ and where
 *
 *  ENTITY (a new kind of thing, e.g. `container`)
 *    - Declare its kind:
 *        declare module '../types' {
 *          interface CustomItemKinds { container: unknown }
 *        }
 *    - Build an `EntityDef<T>` { kind, label, labelOf, abilities, properties, render }.
 *    - Register it in `model/app.ts` (or via a system at boot).
 *
 *  SYSTEM (background infrastructure, e.g. `log`, `jump`)
 *    - File: `systems/<name>.ts`.
 *    - Declare new events near the system:
 *        declare module '../types' {
 *          interface CustomEvents { 'name.event': payload }
 *        }
 *    - Export `register<Name>(system: Registry)` that calls `system('name', ctx => { ... })`.
 *    - Wire it into `systems/index.ts`.
 *    - Origin-scoped state must implement `unregisterOrigin(origin)` and be
 *      added to `createContexts`'s teardown list.
 *
 *  ABILITY (a per-entity capability, e.g. `draggable`, `editable`)
 *    - File: `abilities/<id>.ts`.
 *    - Declare events the same way.
 *    - Export `<id>()` ability builder + `register<Id>(system: Registry)`.
 *    - Wire it into `abilities/index.ts` and add to an entity's `abilities: [...]`.
 *
 *  FEATURE (cross-system flow, e.g. `nodeLifecycle`)
 *    - File: `features.ts`.
 *    - Subscribe to facts, emit requests; never own data.
 *
 *  COMMAND with input
 *    - `CommandSpec.input` for direct DOM input (keys, clicks, pointer).
 *    - `CommandSpec.form` for free-text/number entry (modal form).
 *    - `CommandSpec.picker` for letter-overlay pick over `ItemRef` targets.
 *
 *  PROPERTIES (configurable fields on an entity)
 *    - Declare `PropertyDef<T, Patch>[]` on `EntityDef.properties`.
 *    - The `configurable` ability + the properties modal render them.
 *
 *  DEVTOOL / TEST surface on `window.app`
 *    - Augment `CustomExposable` near the system; call `ctx.expose('key', value)`.
 *
 *  ----------------------------------------------------------------------------
 *  Conventions worth knowing:
 *    - Imperative event names (`graph.node.create`) = requests.
 *    - Past-tense (`graph.node.created`) = facts. Systems own their fact emits.
 *    - Past-tense suffixes (see FACT_SUFFIXES) drive the render scheduler.
 *    - Renderable is `Node | () => Node` — no HTML strings; build DOM nodes.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Id = string;
export type Renderable = globalThis.Node | (() => globalThis.Node);
export type Position = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = Position & Size;
export type ViewState = Position & { scale: number };
export type Label = { text: string };
export type NonEmptyArray<T> = [T, ...T[]];

// ---------------------------------------------------------------------------
// Places & raw input
// ---------------------------------------------------------------------------

import { FACT_SUFFIXES, type FactSuffix, Places, type Place, Slots, type SlotName, EntitySlots } from './constants';
export { FACT_SUFFIXES, Places, Slots, EntitySlots };
export type { FactSuffix, Place, SlotName };
export type RawInput = 'click' | 'dblclick' | 'contextmenu' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup' | 'wheel' | 'input' | 'change' | 'focusout' | 'paste';

// ---------------------------------------------------------------------------
// Items & extension hooks
// ---------------------------------------------------------------------------

/** Extension hook for new item kinds. A system or model file adds:
 *
 *    declare module '../types' { interface CustomItemKinds { container: unknown } }
 *
 *  ItemKind then includes 'container' everywhere — selection, focus, render.
 */
export interface CustomItemKinds {}
export type BuiltinItemKind = 'graph' | 'node' | 'edge';
export type ItemKind = BuiltinItemKind | Extract<keyof CustomItemKinds, string>;

/** Addresses an item in the model. `parent` is the optional ancestor chain for
 *  nested addressing — outermost first. A flat node lives at
 *  `{ kind: 'node', id: 'e1' }`; a node inside a container lives at
 *  `{ kind: 'node', id: 'e1', parent: ['c1'] }`. Selection/focus stores treat
 *  refs by deep equality so nested vs flat ids don't collide. */
export type ItemRef = { kind: ItemKind; id: Id; parent?: Id[] };

// ---------------------------------------------------------------------------
// Event bus framework
// ---------------------------------------------------------------------------

/** Extension hook for third-party events. Each owner declares its events near
 *  itself:
 *
 *    declare module '../types' {
 *      interface CustomEvents {
 *        'my.thing': { foo: string };
 *        'my.thing.changed': { id: Id };
 *      }
 *    }
 *
 *  AppEvents is the merge of BuiltinEvents and every CustomEvents augmentation.
 *  `bus.emit('my.thing', { foo: 'x' })` becomes typed automatically. */
export interface CustomEvents {}

/** Extension hook for typed devtool/test surfaces published via `ctx.expose(key, value)`.
 *  Augment to add a key without editing `AppCtx`. */
export interface CustomExposable {}

export type ModalVisual = 'panel' | 'command' | 'properties' | 'perf' | 'present' | 'onboarding';

/** Framework events guaranteed by the frontend runtime. Domain events live next to
 *  their owners via `CustomEvents` augmentation. */
interface BuiltinEvents {
  /** Fired once after every system / ability / feature has started. */
  'app.start': void;
  /** Toast-style transient notice. Picked up by the event log and devtools. */
  'app.notice': { message: string; level?: 'info' | 'warn' | 'error' };
  /** Fired by the cancellation system on Escape or stage background click.
   *  The cancellation context routes it to the topmost active `Cancellable`. */
  'app.cancel': { source?: 'escape' | 'background' };
  /** Fired by the affordances context when something contributes/withdraws a
   *  contribution on the given surface. The toolbar listens to redraw. */
  'affordance.contributed': { surface: AffordanceSurface };
  /** Render adapter contract — shell + slot flush. */
  'render.shell': void;
  'render.view.set': { place: Place; key?: string; view: Renderable };
  'render.view.clear': { place: Place; key?: string };
  /** Stage redraw trigger. The render scheduler emits this once per RAF when
   *  the nodes scope is dirty. Stage renderers (HTML, canvas, …) subscribe. */
  /** Stage redraw. `full` forces a rebuild; otherwise `refs` are the changed
   *  node/edge items to patch in place. Empty/absent refs ⇒ full rebuild. */
  'render.stage.draw': { full?: boolean; refs?: ItemRef[] };
  /** Camera-only redraw: pan/zoom changed the view but no entity did. Stage
   *  renderers update the layer transform / grid in place — no DOM rebuild. */
  'render.stage.camera': void;
  /** Modal layer contract. Multiple systems open modals (commandForm,
   *  commandModal, configurable); they all go through these two events. */
  'modal.open': { title?: string; titleView?: Renderable; body?: Renderable; visual?: ModalVisual };
  'modal.close': void;
  'modal.closed': void;
  /** decorations facet-change notification (item modes / overlays). Render
   *  listens to redraw stage chrome (selection rings, jump letters, etc.). */
  'decoration.changed': { facet?: 'modes' | 'overlays'; source?: string; refs?: ItemRef[] };
  /** Fold (collapse/expand) request + fact for any panel/section. Owned by the
   *  foldable system; consumers (outline, main, …) listen on `.changed` and
   *  re-render. */
  'fold.toggle': { id: string };
  'fold.changed': { id: string; open: boolean };
  /** Generic patch request. The single seam every storage system dispatches on:
   *  graph.ts handles `kind === 'node' | 'edge'`, the containers system handles
   *  `kind === 'container'`, and so on. Abilities (draggable, editable,
   *  configurable, nudgeable) emit this with the ref of the item being mutated;
   *  no ability ever needs to know which store owns the item. The fact event
   *  (`graph.node.updated`, `container.updated`, …) is the storage system's
   *  responsibility after applying. */
  'item.update': { ref: ItemRef; patch: unknown };
  'item.update.batch': { updates: { ref: ItemRef; patch: unknown }[] };
}

export type AppEvents = BuiltinEvents & CustomEvents;
export type EventName = keyof AppEvents;
export type EventOf<K extends EventName = EventName> = { name: K; data: AppEvents[K]; at: number };
export type AnyEvent = { [K in EventName]: EventOf<K> }[EventName];

export type Bus = {
  on<K extends EventName>(name: K, fn: (data: AppEvents[K], event: EventOf<K>) => void): () => void;
  onAny(fn: (event: AnyEvent) => void): () => void;
  emit<K extends EventName>(name: K, ...data: AppEvents[K] extends void ? [] : [AppEvents[K]]): void;
  /** Escape hatch for code that holds a (name, data) pair where the connection
   *  between them is dynamic (form submission, command dispatch, plugin bridges).
   *  Loses payload typing — prefer `emit` whenever the name is statically known. */
  forward(name: EventName, data?: unknown): void;
};

export type DxIssue = { level: 'error' | 'warn'; rule: string; message: string };

// ---------------------------------------------------------------------------
// Redraw convention
// ---------------------------------------------------------------------------

export type RedrawScope = 'nodes' | 'outline' | 'both' | 'camera' | 'nodes.visual';

// ---------------------------------------------------------------------------
// Command framework
// ---------------------------------------------------------------------------

/** Where a command run originated. `keyboard` / `pointer` come from the input
 *  router; `palette` from command modal rows; `feature` when one system runs
 *  another; `programmatic` is the default for direct `commands.run(id)` calls
 *  (devtools, tests, boot wiring). */
export type CommandOrigin = 'keyboard' | 'pointer' | 'palette' | 'feature' | 'programmatic';
export type CommandSource = { event?: Event; target?: Element | null; origin?: CommandOrigin };

export type CommandFormOption = { value: string; label: string };
export type CommandFormField = {
  id: string;
  label: string;
  input?: 'text';
  placeholder?: string;
  required?: boolean;
  autofocus?: boolean;
  options?: () => CommandFormOption[];
};
export type CommandFormSpec = {
  title?: string;
  submitLabel?: string;
  fields: CommandFormField[];
  seed?: (payload: unknown, source: CommandSource) => Record<string, string>;
  shouldOpen?: (payload: unknown, source: CommandSource) => boolean;
  payload: (values: Record<string, string>, source: CommandSource) => unknown;
  validate?: (values: Record<string, string>, source: CommandSource) => string | undefined;
};

/** One step in a multi-step keyboard picker. The commandPicker system walks
 *  these in order: try `seed` first (auto-fills from selection or context, so
 *  fast paths stay 1-keystroke); otherwise render letter overlays for items
 *  passing `filter` and capture the next letter as the chosen ref. */
export type PickerStep = {
  id: string;
  prompt?: string;
  filter?: (values: Record<string, ItemRef>, source: CommandSource) => (ref: ItemRef) => boolean;
  seed?: (values: Record<string, ItemRef>, source: CommandSource) => ItemRef | null | undefined;
};

/** A keyboard-driven multi-step picker — same shape as CommandFormSpec but for
 *  ItemRefs instead of strings. Lives next to the command so the same
 *  `commands.run(id)` path dispatches it. */
export type PickerSpec = {
  title?: string;
  steps: PickerStep[];
  payload: (values: Record<string, ItemRef>, source: CommandSource) => unknown;
  validate?: (values: Record<string, ItemRef>, source: CommandSource) => string | undefined;
};

export type CommandInput = {
  on: RawInput;
  key?: string;
  /** Modifier requirements. Omitted = not required AND must not be held. */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  selector?: string;
  global?: boolean;
  prevent?: boolean;
  stop?: boolean;
  when?: (event: Event, target: Element) => boolean;
};

export type CommandSpec<K extends EventName = EventName> = {
  id: string;
  label: string;
  event: K;
  input?: CommandInput;
  group?: string;
  hidden?: boolean;
  shortcut?: string;
  enabled?: boolean;
  origin?: string;
  available?: (source?: CommandSource) => boolean;
  payload?: (source: CommandSource) => AppEvents[K] | undefined;
  /** Open a modal form before dispatching. Use for free-form text/number entry. */
  form?: CommandFormSpec;
  /** Drive a keyboard letter-pick flow before dispatching. Use when the command
   *  needs to reference items in the graph (source/target, parent, jump target). */
  picker?: PickerSpec;
};

/** Authoring shape — `event` is optional. The command registry normalizes
 *  `event ??= id` at registration, so most call sites can omit it when the
 *  command id and event name match (the common case). After normalization the
 *  registry stores `CommandSpec` with `event` guaranteed. */
export type CommandSpecInput<K extends EventName = EventName> = Omit<CommandSpec<K>, 'event'> & { event?: K };

// ---------------------------------------------------------------------------
// Flags / UI value helper
// ---------------------------------------------------------------------------

export type FeatureFlags = Record<string, boolean>;
/** Either a literal string or a function of the item rendered. */
export type UiValue<T = unknown> = string | ((item: T) => string);

// ---------------------------------------------------------------------------
// Properties (configurable entity fields)
// ---------------------------------------------------------------------------

/** PropertyInput is open: any registered renderer name. `text` | `number` | `checkbox` ship as defaults. */
export type PropertyInput = string;
export type PropertyValue = string | number | boolean;
export type PropertyDef<T = unknown, Patch = unknown> = {
  id: string;
  label: string;
  input: PropertyInput;
  value: (item: T) => PropertyValue;
  patch: (item: T, value: PropertyValue) => Patch | undefined;
  min?: number;
  step?: number;
  rows?: number;
  options?: { value: string; label: string }[];
  /** Section the property is rendered under in the modal. Default 'default'. */
  group?: string;
};
export type PropertyRenderer<T = unknown> = (prop: PropertyDef<T>, item: T) => HTMLElement;

// ---------------------------------------------------------------------------
// Affordances, actions, abilities
// ---------------------------------------------------------------------------

export type AffordanceSurface = 'palette' | 'list' | 'entity' | 'top';

/** AffordanceKind enumerates how a user touches the affordance.
 *  - `button`  → renders as a clickable button
 *  - `handler` → wired to an existing template node via attrs (no new element)
 *  Keyboard shortcuts are NOT affordances here — they live on CommandSpec.input.
 *  DX treats an input-bound command as the keyboard affordance for its action. */
export type AffordanceKind = 'button' | 'handler';

export type AffordanceDef<T = unknown> = {
  surface: AffordanceSurface;
  command: string;
  kind: AffordanceKind;
  /** Item-dependent disclosure. The action remains one canonical command, but
   *  irrelevant controls are absent from this particular entity instance. */
  when?: (item: T) => boolean;
  slot?: SlotName;
  text?: UiValue<T>;
  label?: UiValue<T>;
  className?: string;
  attrs?: Record<string, UiValue<T>>;
  /** Sort hint for surfaces that have a sequence (top bar, list). Lower = earlier. */
  order?: number;
};

/** System-scoped affordance contribution (no per-item context). `panel` routes a
 *  `top`-surface button to a declared tool panel by id; omit it for the default
 *  top toolbar. Routing here (not a bespoke render) is what lets the `command-ui`
 *  projection move a button between panels as a one-field views edit. */
export type SystemAffordance = Omit<AffordanceDef<void>, 'text' | 'label' | 'when'> & {
  text?: string;
  label?: string;
  panel?: string;
  /** Live pressed state for mutually-exclusive controls such as layout modes.
   *  The tool-panel renderer exposes it through aria-pressed and the shared
   *  selected-control styling; the command remains the only mutation path. */
  active?: () => boolean;
  /** Cluster start-slot toolbar buttons that share this key into one visual
   *  `.tool-group` (e.g. 'edit', 'layout'). Omit to render loose. */
  group?: string;
  origin?: string;
};

/** Where a tool panel anchors on the stage when it has not been dragged. */
export type PanelAnchor = 'top-left' | 'top-center' | 'top-right' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** A movable/collapsible tool panel on the stage. Declared as data via
 *  `contexts.affordances.declarePanel(...)` from the owning system's file, so
 *  adding a panel is one declaration + routing buttons to it (no bespoke render).
 *  Origin-scoped: the panel disappears when its declaring system is disabled. */
export type PanelDef = {
  id: string;
  anchor: PanelAnchor;
  /** Bind a collapse chevron to this fold id (and hide the body while folded). */
  foldId?: string;
  /** Render a drag handle so the user can reposition the panel. */
  movable?: boolean;
  /** Buttons in a row (`toolbar`) or a column (`stack`). Default `stack`. */
  layout?: 'toolbar' | 'stack';
  /** Re-evaluated on each redraw; when it returns false the panel is unmounted. */
  mountWhen?: () => boolean;
  /** Lower renders/iterates earlier. */
  order?: number;
  /** Owning system — set automatically when declared through `SystemCtx`. */
  origin?: string;
};

export type ActionDef<T = unknown> = {
  id: string;
  label: string;
  /** Canonical command shown in the palette. Optional for pointer-only actions. */
  paletteCommand?: string;
  /** Mouse/touch affordances. Empty array is legal IF the action's paletteCommand
   *  has an input binding (DX treats that as the keyboard affordance). */
  ui: AffordanceDef<T>[];
};

export type AbilityDef<T = unknown> = { id: string; actions: NonEmptyArray<ActionDef<T>> };

// ---------------------------------------------------------------------------
// Entity rendering
// ---------------------------------------------------------------------------

/** Structural slice of the live graph that an entity renderer needs.
 *  Kind-agnostic: callers go through `getItem(ref)` / `itemsOfKind(kind)`.
 *  An edge renderer that needs its endpoints calls `getItem({kind:'node', id})`. */
export type EntityRenderGraph = {
  getItem(ref: ItemRef): unknown | undefined;
  itemsOfKind<T = unknown>(kind: string): T[];
};

/** Per-item render scope. The render system constructs this once per item and
 *  passes it to `entity.render.draw`. Renderers stay declarative — they do not
 *  reach for the DOM, item-modes, or affordances directly. */
export type EntityRenderCtx = {
  graph: EntityRenderGraph;
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

// ---------------------------------------------------------------------------
// Collections and model
// ---------------------------------------------------------------------------

export type CollectionToolbar = {
  /** Override the button text. Default: `+ ${entity.label ?? collection.label-singular}`. */
  text?: string;
  surface?: AffordanceSurface;
  order?: number;
};

export type CollectionDef<T, Ctx = unknown> = {
  id: string;
  label: string;
  /** Item kind for command/id derivation. Defaults to `entity.kind`, then singular collection id. */
  kind?: string;
  entity?: EntityDef<T>;
  items: (ctx: Ctx) => T[];
  /** Defaults to `item.id`; DX reports an error if an item cannot provide one. */
  itemId?: (item: T) => Id;
  /** Defaults to `entity.labelOf`, then item id. */
  itemLabel?: (item: T) => string;
  toolbar?: CollectionToolbar | false;
  search?: true;
  order?: 'created';
  /** Render a standalone outline section for this collection. Default true. Set
   *  false for kinds that only appear nested inside another (e.g. containers,
   *  which live in the unified Outline tree, not their own list). */
  section?: boolean;
};

export type ResolvedCollectionDef<T, Ctx = unknown> = Omit<CollectionDef<T, Ctx>, 'kind' | 'itemId' | 'itemLabel' | 'search' | 'order'> & {
  kind: string;
  itemId: (item: T) => Id;
  itemLabel: (item: T) => string;
  search: true;
  order: 'created';
};

export type ModelDef<Ctx = unknown> = {
  entities: EntityDef<unknown, unknown>[];
  collections: CollectionDef<unknown, Ctx>[];
};
