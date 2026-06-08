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
 *  DEVTOOL / TEST surface on `window.v2`
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

export const Places = { Top: 'top', Left: 'left', Stage: 'stage', Modal: 'modal' } as const;
export type Place = typeof Places[keyof typeof Places];
export type RawInput = 'click' | 'dblclick' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup' | 'wheel' | 'input' | 'change' | 'focusout';

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

export type ModalVisual = 'panel' | 'command' | 'properties';

/** Framework events guaranteed by the v2 runtime. Domain events live next to
 *  their owners via `CustomEvents` augmentation. */
interface BuiltinEvents {
  /** Fired once after every system / ability / feature has started. */
  'app.start': void;
  /** Toast-style transient notice. Picked up by the event log and devtools. */
  'app.notice': { message: string; level?: 'info' | 'warn' | 'error' };
  /** Fired by the cancellation system on Escape or stage background click.
   *  The cancellation context routes it to the topmost active `Cancellable`. */
  'app.cancel': void;
  /** Fired by the affordances context when something contributes/withdraws a
   *  contribution on the given surface. The toolbar listens to redraw. */
  'affordance.contributed': { surface: AffordanceSurface };
  /** Render adapter contract — shell + slot flush. */
  'render.shell': void;
  'render.view.set': { place: Place; key?: string; view: Renderable };
  'render.view.clear': { place: Place; key?: string };
  /** Stage redraw trigger. The render scheduler emits this once per RAF when
   *  the nodes scope is dirty. Stage renderers (HTML, canvas, …) subscribe. */
  'render.stage.draw': void;
  /** Modal layer contract. Multiple systems open modals (commandForm,
   *  commandModal, configurable); they all go through these two events. */
  'modal.open': { title?: string; body?: Renderable; visual?: ModalVisual };
  'modal.close': void;
  /** Item-mode / item-overlay context change notification. Render listens to
   *  redraw stage chrome (selection rings, jump letters, etc.). */
  'itemMode.changed': { source?: string };
  'itemOverlay.changed': { source?: string };
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

/** Past-tense suffixes that mark an event as a fact (something already happened).
 *  Convention rule: imperative names (`graph.node.create`) are requests; fact names
 *  (`graph.node.created`) are emitted by the owning system after the change lands.
 *  Other systems subscribe to facts, never to requests. The render scheduler reads
 *  facts as redraw triggers via `factScope`. */
export const FACT_SUFFIXES = ['.created', '.updated', '.deleted', '.switched', '.selected', '.focused', '.changed'] as const;
export type FactSuffix = typeof FACT_SUFFIXES[number];
export type RedrawScope = 'nodes' | 'outline' | 'both';

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
  slot?: string;
  text?: UiValue<T>;
  label?: UiValue<T>;
  className?: string;
  attrs?: Record<string, UiValue<T>>;
  /** Sort hint for surfaces that have a sequence (top bar, list). Lower = earlier. */
  order?: number;
};

/** System-scoped affordance contribution (no per-item context). */
export type SystemAffordance = Omit<AffordanceDef<void>, 'text' | 'label'> & {
  text?: string;
  label?: string;
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
  tagItem(el: Element, ref: ItemRef): void;
  applyItemModes(el: Element, ref: ItemRef): void;
  /** Wire ability affordances (handlers + buttons) for this item's entity into
   *  any [data-slot=...] holes on the cloned element. */
  wireAffordances(el: HTMLElement): void;
  cloneTemplate<T extends Element = HTMLElement>(name: string): T;
  templateSlot(root: Element, name: string): Element;
  templateText(root: Element, name: string, value: unknown): void;
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
