export type Id = string;
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
export type NonEmptyArray<T> = [T, ...T[]];
export type ModalVisual = 'panel' | 'command' | 'properties';
export type ItemKind = 'graph' | 'node';
export type ItemRef = { kind: ItemKind; id: Id };

export type AppEvents = {
  'app.start': void;
  'affordance.contributed': { surface: AffordanceSurface };
  'render.shell': void;
  'render.view.set': { place: Place; key?: string; view: Renderable };
  'render.view.clear': { place: Place; key?: string };
  'render.nodes.draw': void;
  'modal.open': { title?: string; body?: Renderable; visual?: ModalVisual };
  'modal.close': void;
  'palette.open': void;
  'help.open': void;
  'outline.draw': void;
  'outline.search.changed': { collectionId: Id; query: string };
  'commandModal.search.changed': { modalId: string; query: string };
  'shortcut.edit.preview': { id: string; shortcut: string };
  'shortcut.edit.commit': { id: string; shortcut: string };
  'view.changed': ViewState;
  'view.zoom.by': { screen: Position; factor: number };
  'view.zoom.in': void;
  'view.zoom.out': void;
  'view.zoom.reset': void;
  'view.pan.start': Position;
  'view.pan.move': Position;
  'view.pan.end': void;
  'editing.node.create': NodeDraft;
  'graph.create': void;
  'graph.created': { id: Id };
  'graph.delete': { id: Id };
  'graph.deleted': { id: Id; nextId: Id };
  'graph.switch': { id: Id };
  'graph.switched': { id: Id };
  'graph.node.create': NodeDraft;
  'graph.node.created': { graphId: Id; id: Id };
  'graph.node.update': { id: Id; patch: NodePatch };
  'graph.node.updated': { graphId: Id; id: Id };
  'graph.node.delete': { id: Id };
  'graph.node.deleted': { graphId: Id; id: Id };
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
};
export type EventName = keyof AppEvents;
export type EventOf<K extends EventName = EventName> = { name: K; data: AppEvents[K]; at: number };
export type AnyEvent = { [K in EventName]: EventOf<K> }[EventName];
export type Bus = {
  on<K extends EventName>(name: K, fn: (data: AppEvents[K], event: EventOf<K>) => void): void;
  onAny(fn: (event: AnyEvent) => void): void;
  emit<K extends EventName>(name: K, ...data: AppEvents[K] extends void ? [] : [AppEvents[K]]): void;
};

export type CommandSource = { event?: Event; target?: Element | null };
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
  payload?: (source: CommandSource) => AppEvents[K];
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
export type AffordanceDef<T = unknown> = {
  surface: AffordanceSurface;
  command: string;
  kind: 'button' | 'handler' | 'shortcut';
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
  ui: NonEmptyArray<AffordanceDef<T>>;
};
export type AbilityDef<T = unknown> = { id: string; actions: NonEmptyArray<ActionDef<T>> };
export type EntityDef<T, Patch = unknown> = {
  kind: string;
  label: string;
  labelOf: (item: T) => string;
  abilities: AbilityDef<T>[];
  properties?: PropertyDef<T, Patch>[];
};
export type CollectionDef<T, Ctx = unknown> = {
  id: string;
  label: string;
  entity?: EntityDef<T>;
  items: (ctx: Ctx) => T[];
  itemId: (item: T) => Id;
  itemLabel: (item: T) => string;
  selectCommand?: string;
  crud: { create: string; delete: string };
  search: true;
  order: 'created';
};
export type ModelDef<Ctx = unknown> = { entities: EntityDef<unknown, unknown>[]; collections: CollectionDef<unknown, Ctx>[] };
