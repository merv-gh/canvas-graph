export type Id = string;
export type EdgeEntity = { id: Id; kind: 'edge'; From: Id; To: Id; Label?: Label };
export type EdgeDraft = { From: Id; To: Id; Label?: Label };
export type EdgeCreateDraft = Partial<EdgeDraft>;
export type EdgePatch = Partial<Pick<EdgeEntity, 'Label'>>;
export type Renderable = string | globalThis.Node | (() => string | globalThis.Node);
export type RawInput = 'click' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup' | 'wheel' | 'input' | 'change' | 'focusout';

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
export type ItemKind = 'graph' | 'node' | 'edge';
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

interface BuiltinEvents {
  'app.start': void;
  'app.notice': { message: string; level?: 'info' | 'warn' | 'error' };
  'demo.run-self': void;
  'affordance.contributed': { surface: AffordanceSurface };
  'render.shell': void;
  'render.view.set': { place: Place; key?: string; view: Renderable };
  'render.view.clear': { place: Place; key?: string };
  'modal.open': { title?: string; body?: Renderable; visual?: ModalVisual };
  'modal.close': void;
  'palette.open': void;
  'help.open': void;
  'commandForm.open': { commandId: string; seed?: Record<string, string> };
  'commandForm.submit': { commandId: string; values: Record<string, string> };
	  'outline.draw': void;
	  'outline.search.changed': { collectionId: Id; query: string };
	  'commandModal.run': { commandId: string };
	  'commandModal.search.changed': { modalId: string; query: string };
  'shortcut.edit.preview': { id: string; shortcut: string };
  'shortcut.edit.commit': { id: string; shortcut: string };
  'view.changed': ViewState;
  'view.zoom.by': { screen: Position; factor: number };
  'view.zoom.in': void;
  'view.zoom.out': void;
  'view.zoom.reset': void;
  'view.fit.all': void;
  'view.fit.selected': void;
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
  'properties.item.input': { ref: ItemRef; field: string; value: string };
  'properties.item.toggle': { ref: ItemRef; field: string; checked: boolean };
  'selection.node.select': { id: Id };
  'selection.node.clear': void;
  'selection.node.selected': { id: Id | null };
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

export type CommandSource = { event?: Event; target?: Element | null };
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
  form?: CommandFormSpec;
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
export type EntityDef<T, Patch = unknown> = {
  kind: string;
  label: string;
  labelOf: (item: T) => string;
  abilities: AbilityDef<T>[];
  properties?: PropertyDef<T, Patch>[];
};
export type CollectionToolbar = {
  /** Override the button text. Default: `+ ${entity.label ?? collection.label-singular}`. */
  text?: string;
  surface?: AffordanceSurface;
  order?: number;
};
/** A collection declares the IDs of its CRUD commands (DX checks they exist).
 *  The actual commands are produced by `commands(api)` below — simple collections
 *  can omit it and the `collections` system will synthesize defaults. The api type
 *  is supplied by core.ts (CollectionCommandsApi) to avoid a circular import. */
export type CollectionDef<T, Ctx = unknown, Api = unknown> = {
  id: string;
  label: string;
  entity?: EntityDef<T>;
  items: (ctx: Ctx) => T[];
  itemId: (item: T) => Id;
  itemLabel: (item: T) => string;
  selectCommand?: string;
  crud: { create: string; delete: string };
  /** Factory called once at boot with the live app api. Returns command specs the
   *  collection owns (create, delete, navigation). Lets the collection close over
   *  graphs/selection/view without leaking state. */
  commands?: (api: Api) => CommandSpec[];
  toolbar?: CollectionToolbar | false;
  search: true;
  order: 'created';
};
export type ModelDef<Ctx = unknown, Api = unknown> = {
  entities: EntityDef<unknown, unknown>[];
  collections: CollectionDef<unknown, Ctx, Api>[];
};
