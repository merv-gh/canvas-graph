export type Id = string;
export type EdgeEntity = { id: Id; kind: 'edge'; From: Id; To: Id; Label?: Label };
export type EdgeDraft = { From: Id; To: Id; Label?: Label };
export type EdgeCreateDraft = Partial<EdgeDraft>;
export type EdgePatch = Partial<Pick<EdgeEntity, 'Label'>>;
export type Renderable = globalThis.Node | (() => globalThis.Node);
export type RawInput = 'click' | 'dblclick' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup' | 'wheel' | 'input' | 'change' | 'focusout';

export const Places = { Top: 'top', Left: 'left', Stage: 'stage', Modal: 'modal' } as const;
export type Place = typeof Places[keyof typeof Places];

export type Position = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = Position & Size;
export type ViewState = Position & { scale: number };
export type Label = { text: string };
export type NodeDraft = { Label?: Label; Position?: Position; Size?: Size; Collapsed?: boolean };
export type NodeEntity = { id: Id; kind: 'node'; Label: Label; Size: Size; Position?: Position; Collapsed?: boolean };
export type NodePatch = Partial<Pick<NodeEntity, 'Label' | 'Size' | 'Position' | 'Collapsed'>>;
export type NodeCreateOptions = { at?: Position; near?: Id | null };
/** Operation-time hints attached to create events. They control the lifecycle around the
 *  new node — focus behavior, edge creation, placement anchor — without polluting NodeDraft. */
export type CreateHints = {
  /** Don't move focus to the new node. Selection still moves (so user can keep editing). */
  keepFocus?: boolean;
  /** Place the new node near this id, using the same near-placement heuristic as the graph store. */
  relativeTo?: Id;
  /** After the node lands, also create an edge from this id to the new node id. */
  connectFrom?: Id;
};
export type NonEmptyArray<T> = [T, ...T[]];
export type ModalVisual = 'panel' | 'command' | 'properties';
export interface CustomItemKinds {}
export type BuiltinItemKind = 'graph' | 'node' | 'edge';
export type ItemKind = BuiltinItemKind | Extract<keyof CustomItemKinds, string>;
/** Addresses an item in the model. `parent` is the optional ancestor chain for
 *  nested-graph addressing — outermost graph first. A flat node lives at
 *  `{ kind: 'node', id: 'e1' }`; a node inside a container graph lives at
 *  `{ kind: 'node', id: 'e1', parent: ['g1', 'g2'] }`. The container ability
 *  (future) is what populates parent. Selection/focus stores treat refs by deep
 *  equality so nested vs flat ids don't collide. */
export type ItemRef = { kind: ItemKind; id: Id; parent?: Id[] };

/** Extension hook for third-party systems and plugins.
 *  Augment via module declaration to add new typed events without editing this file:
 *
 *    declare module './types' {
 *      interface CustomEvents { 'my.event': { foo: string } }
 *    }
 *
 *  AppEvents is the merge of BuiltinEvents (declared below) and CustomEvents.
 *  Bus.emit / on become aware of the augmented event name automatically. */
export interface CustomEvents {}

/** Extension hook for typed devtool/test surfaces published via `ctx.expose(key, value)`.
 *  Augment to add a new key without editing AppCtx:
 *
 *    declare module './types' {
 *      interface CustomExposable { myThing?: { count(): number } }
 *    }
 *
 *  AppCtx merges built-in keys (`dx`, `render`, …) with CustomExposable, so
 *  `window.v2.myThing` becomes typed in both producer and consumer code. */
export interface CustomExposable {}

interface BuiltinEvents {
  'app.start': void;
  'app.notice': { message: string; level?: 'info' | 'warn' | 'error' };
  /** Fired by the cancellation system on Escape or stage background click.
   *  The cancellation context routes it to the topmost active Cancellable. */
  'app.cancel': void;
  'demo.run-self': void;
  'affordance.contributed': { surface: AffordanceSurface };
  'render.shell': void;
  'render.view.set': { place: Place; key?: string; view: Renderable };
  'render.view.clear': { place: Place; key?: string };
  /** Request that the stage redraws its items (nodes/edges/overlays). The render
   *  scheduler emits this once per RAF when the nodes scope is dirty. Stage
   *  renderers (HTML, canvas, …) subscribe; multiple may coexist. */
  'render.stage.draw': void;
  'modal.open': { title?: string; body?: Renderable; visual?: ModalVisual };
  'modal.close': void;
  'palette.open': void;
  'help.open': void;
  'commandForm.open': { commandId: string; seed?: Record<string, string> };
  'commandForm.submit': { commandId: string; values: Record<string, string> };
  'commandPicker.open': { commandId: string; source?: CommandSource };
  'commandPicker.step': { commandId: string; step: string; ref: ItemRef };
  'commandPicker.cancel': void;
  'commandPicker.submit': { commandId: string; values: Record<string, ItemRef> };
  'outline.draw': void;
  'outline.search.changed': { collectionId: Id; query: string };
  'commandModal.run': { commandId: string };
  'commandModal.search.changed': { modalId: string; query: string };
  'shortcut.edit.preview': { id: string; shortcut: string };
  'shortcut.edit.commit': { id: string; shortcut: string };
  'flag.toggle': { name: string; on: boolean };
  'view.changed': ViewState;
  'view.zoom.by': { screen: Position; factor: number };
  'view.zoom.in': void;
  'view.zoom.out': void;
  'view.zoom.reset': void;
  'view.fit.all': void;
  'view.fit.selected': void;
  'view.fit.item': ItemRef;
  'layout.apply.radial': void;
  'layout.apply.grid': void;
  'layout.apply.tidy': void;
  'view.pan.start': Position;
  'view.pan.move': Position;
  'view.pan.end': void;
  'editing.node.create': NodeDraft & CreateHints;
  'editing.edge.create': EdgeCreateDraft;
  'graph.create': void;
  'graph.created': { id: Id };
  'graph.delete': { id: Id };
  'graph.deleted': { id: Id; nextId: Id };
  'graph.switch': { id: Id };
  'graph.switched': { id: Id };
  'graph.node.create': NodeDraft & CreateHints;
  'graph.node.created': { graphId: Id; id: Id; hints?: CreateHints };
  'graph.node.update': { id: Id; patch: NodePatch };
  'graph.node.updated': { graphId: Id; id: Id };
  'graph.node.delete': { id: Id };
  'graph.node.deleted': { graphId: Id; id: Id };
  'graph.edge.create': EdgeDraft;
  'graph.edge.created': { graphId: Id; id: Id; edge: EdgeEntity };
  'graph.edge.update': { id: Id; patch: EdgePatch };
  'graph.edge.updated': { graphId: Id; id: Id };
  'graph.edge.delete': { id: Id };
  'graph.edge.deleted': { graphId: Id; id: Id };
  'node.title.edit': { id: Id };
  'node.title.commit': { id: Id; text: string; finish?: boolean };
  'item.properties.open': ItemRef;
  'itemMode.changed': { source?: string };
  'itemOverlay.changed': { source?: string };
  'properties.item.input': { ref: ItemRef; field: string; value: string };
  'properties.item.toggle': { ref: ItemRef; field: string; checked: boolean };
  'selection.item.select': ItemRef;
  'selection.item.clear': void;
  'selection.item.delete': void;
  'selection.item.selected': ItemRef | null;
  'selection.node.select': { id: Id };
  'selection.node.clear': void;
  'selection.node.selected': { id: Id | null };
  'focus.item.focus': ItemRef;
  'focus.item.clear': void;
  'focus.item.focused': ItemRef | null;
  'focus.node.focus': { id: Id };
  'focus.node.clear': void;
  'focus.node.focused': { id: Id | null };
  'drag.node.start': { id: Id; x: number; y: number };
  'drag.node.move': { x: number; y: number };
  'drag.node.end': void;
  'drag.node.moved': { id: Id };
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

/** Past-tense suffixes that mark an event as a fact (something already happened).
 *  Convention rule: imperative names ('graph.node.create') are requests; fact names
 *  ('graph.node.created') are emitted by the owning system after the change lands.
 *  Other systems subscribe to facts, never to requests. The render scheduler reads
 *  facts as redraw triggers via factScope. */
export const FACT_SUFFIXES = ['.created', '.updated', '.deleted', '.switched', '.selected', '.focused', '.changed'] as const;
export type FactSuffix = typeof FACT_SUFFIXES[number];
export type RedrawScope = 'nodes' | 'outline' | 'both';

/** Where a command run originated. 'keyboard' / 'pointer' come from the input
 *  router; 'palette' from command modal rows; 'feature' when one system runs
 *  another; 'programmatic' is the default for direct `commands.run(id)` calls
 *  (devtools, tests, boot wiring). Lets handlers and `available` filters
 *  discriminate without sniffing CommandSource.event. */
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
  /** Key under which the chosen ItemRef is stored in `values`. */
  id: string;
  /** Banner shown above the stage while this step is active. */
  prompt?: string;
  /** Decide which already-known refs are pickable for this step. Receives the
   *  values picked so far so a step can exclude its predecessor (no self-loops). */
  filter?: (values: Record<string, ItemRef>, source: CommandSource) => (ref: ItemRef) => boolean;
  /** Return a ref to skip this step entirely. Lets "From" auto-fill from the
   *  current selection so edge creation is one keystroke when source is selected. */
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
  enabled?: boolean;        // explicit toggle. Default true.
  origin?: string;          // system/ability name that registered the command (for unregister + DX)
  available?: (source?: CommandSource) => boolean;
  payload?: (source: CommandSource) => AppEvents[K] | undefined;
  /** Open a modal form before dispatching. Use for free-form text/number entry. */
  form?: CommandFormSpec;
  /** Drive a keyboard letter-pick flow before dispatching. Use when the
   *  command needs to reference items in the graph (source/target, parent,
   *  jump target) — keeps the action 2-3 keystrokes total. */
  picker?: PickerSpec;
};
export type FeatureFlags = Record<string, boolean>;

export type UiValue<T = unknown> = string | ((item: T) => string);
/** PropertyInput is open: any registered renderer name. 'text' | 'number' | 'checkbox' ship as defaults. */
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
export type AffordanceSurface = 'palette' | 'list' | 'entity' | 'top';
/** AffordanceKind enumerates how a user touches the affordance.
 *  - 'button'  → renders as a clickable button
 *  - 'handler' → wired to an existing template node via attrs (no new element)
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
  /** Canonical command shown in the palette. Optional for pointer-only actions (e.g. "Drag with mouse"). */
  paletteCommand?: string;
  /** Mouse/touch affordances. Empty array is legal IF the action's paletteCommand
   *  has an input binding (DX treats that as the keyboard affordance). */
  ui: AffordanceDef<T>[];
};
export type AbilityDef<T = unknown> = { id: string; actions: NonEmptyArray<ActionDef<T>> };

/** Structural slice of the live graph that an entity renderer needs to resolve
 *  cross-item state (e.g. an edge resolving its endpoints). Render passes the
 *  current graph here without leaking the full GraphStore type. */
export type EntityRenderGraph = {
  getNode(id: Id): NodeEntity | undefined;
  getEdge(id: Id): EdgeEntity | undefined;
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
   *  any [data-slot=...] holes on the cloned element. No-op on non-HTML returns. */
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
