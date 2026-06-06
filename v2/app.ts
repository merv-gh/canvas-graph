import { Places } from './types';
import type {
  AbilityDef,
  ActionDef,
  AffordanceDef,
  AnyEvent,
  AppEvents,
  Bus,
  CollectionDef,
  CommandSource,
  CommandSpec,
  EntityDef,
  EventName,
  Id,
  ItemRef,
  Label,
  ModelDef,
  NonEmptyArray,
  NodeCreateOptions,
  NodeDraft,
  NodeEntity,
  NodePatch,
  Place,
  Position,
  RawInput,
  Rect,
  Renderable,
  Size,
  UiValue,
  ViewState,
} from './types';

type Graphs = ReturnType<typeof graphStore>;
type Contexts = ReturnType<typeof createContexts>;
type AppCtx = { bus: Bus; graphs: Graphs; contexts: Contexts };
type AppCollectionDef<T> = CollectionDef<T, AppCtx>;
type AppModelDef = ModelDef<AppCtx>;
type SystemCtx = AppCtx & Pick<Bus, 'on' | 'emit'>;
type AppSystem = (ctx: SystemCtx) => void;
type Registry = ((name: string, setup: AppSystem) => void) & {
  start(ctx: AppCtx, then?: () => void): void;
  names(): string[];
};

declare global { interface Window { v2?: AppCtx } }

const systemOf = (id: string) => id.split('.')[0] || 'app';
const shortcutOf = (command: CommandSpec) => command.shortcut ?? (command.input?.key ? command.input.key.toUpperCase() : '');
const keyOfShortcut = (shortcut: string) => shortcut.trim().toLowerCase() === 'esc' ? 'Escape' : shortcut.trim();
const shortcutKey = (shortcut: string) => keyOfShortcut(shortcut).toLowerCase();
const keyMatches = (event: Event, key: string) => event instanceof KeyboardEvent
  && (
    event.key.toLowerCase() === key.toLowerCase()
    || (key === '?' && event.key === '/' && event.shiftKey)
    || (key === '+' && event.key === '=' && event.shiftKey)
  );
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const nodeRect = (node: NodeEntity): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};
const clientPoint = (event: Event): Position => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY });
const isStageSurface = (event: Event, stage: Element) =>
  event.target === stage || (event.target instanceof Element && event.target.classList.contains('nodes'));
const appendRenderable = (slot: Element, view: Renderable) => {
  const value = typeof view === 'function' ? view() : view;
  if (typeof value === 'string') slot.insertAdjacentHTML('beforeend', value);
  else slot.append(value);
};
const grouped = <T,>(items: T[], keyOf: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  items.forEach(item => (groups.get(keyOf(item)) || groups.set(keyOf(item), []).get(keyOf(item))!).push(item));
  return [...groups.entries()];
};
const action = <T,>(def: ActionDef<T>) => def;
const ability = <T,>(id: string, actions: NonEmptyArray<ActionDef<T>>): AbilityDef<T> => ({ id, actions });
const entity = <T,>(kind: string, def: Omit<EntityDef<T>, 'kind'>): EntityDef<T> => ({ kind, ...def });
const collection = <T,>(id: string, def: Omit<AppCollectionDef<T>, 'id'>): AppCollectionDef<T> => ({ id, ...def });
const uiValue = <T,>(value: UiValue<T> | undefined, item: T, fallback = '') =>
  typeof value === 'function' ? value(item) : value ?? fallback;
const entityUi = <T,>(entityDef: EntityDef<T>, slot?: string) =>
  entityDef.abilities.flatMap(abilityDef => abilityDef.actions.flatMap(actionDef =>
    actionDef.ui
      .filter(ui => ui.surface === 'entity' && (slot == null || ui.slot === slot))
      .map(ui => ({ action: actionDef, ui })),
  ));
const itemIdFrom = (target?: Element | null) =>
  target?.closest('[data-item-id]')?.getAttribute('data-item-id')
  ?? target?.closest('[data-node-id]')?.getAttribute('data-node-id')
  ?? target?.closest('[data-graph-id]')?.getAttribute('data-graph-id')
  ?? '';
const itemRefFrom = (target?: Element | null): ItemRef | null => {
  const node = target?.closest('[data-node-id]')?.getAttribute('data-node-id');
  if (node) return { kind: 'node', id: node };
  const graph = target?.closest('[data-graph-id]')?.getAttribute('data-graph-id');
  if (graph) return { kind: 'graph', id: graph };
  return null;
};

function templateContext() {
  const find = (root: ParentNode, selector: string) =>
    root instanceof Element && root.matches(selector) ? root : root.querySelector(selector);
  const clone = <T extends HTMLElement = HTMLElement>(name: string) => {
    const template = document.getElementById(`tpl-${name}`);
    const node = template instanceof HTMLTemplateElement ? template.content.firstElementChild?.cloneNode(true) : null;
    if (!(node instanceof HTMLElement)) throw new Error(`Missing template: ${name}`);
    return node as T;
  };
  const text = (root: ParentNode, name: string, value: unknown) => {
    const el = find(root, `[data-text="${name}"]`);
    if (el) el.textContent = String(value ?? '');
    return root;
  };
  const slot = (root: ParentNode, name: string) => {
    const el = find(root, `[data-slot="${name}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`Missing slot: ${name}`);
    return el;
  };
  return { clone, text, slot };
}

function viewContext(places: Map<Place, HTMLElement>) {
  let state: ViewState = { x: 0, y: 0, scale: 1 };
  const localRect = (place: Place) => places.get(place)?.getBoundingClientRect();
  const get = () => ({ ...state });
  const set = (next: Partial<ViewState>) => {
    state = {
      x: next.x ?? state.x,
      y: next.y ?? state.y,
      scale: clamp(next.scale ?? state.scale, 0.25, 3),
    };
    return get();
  };
  const clientToScreen = (place: Place, point: Position) => {
    const rect = localRect(place);
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : point;
  };
  const screenToSpace = (point: Position) => ({ x: state.x + point.x / state.scale, y: state.y + point.y / state.scale });
  const spaceToScreen = (point: Position) => ({ x: (point.x - state.x) * state.scale, y: (point.y - state.y) * state.scale });
  const clientToSpace = (place: Place, point: Position) => screenToSpace(clientToScreen(place, point));
  const screenCenter = (place: Place) => {
    const rect = localRect(place);
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  };
  const spaceCenter = (place: Place) => screenToSpace(screenCenter(place));
  const visibleRect = (place: Place, margin = 0): Rect | null => {
    const rect = localRect(place);
    if (!rect) return null;
    return {
      x: state.x - margin,
      y: state.y - margin,
      w: rect.width / state.scale + margin * 2,
      h: rect.height / state.scale + margin * 2,
    };
  };
  const isVisible = (place: Place, rect: Rect, margin = 0) => {
    const visible = visibleRect(place, margin);
    return !visible || rectsIntersect(visible, rect);
  };
  const zoomAtScreen = (screen: Position, factor: number) => {
    const before = screenToSpace(screen);
    const scale = clamp(state.scale * factor, 0.25, 3);
    return set({ scale, x: before.x - screen.x / scale, y: before.y - screen.y / scale });
  };
  return { get, set, clientToScreen, screenToSpace, spaceToScreen, clientToSpace, screenCenter, spaceCenter, visibleRect, isVisible, zoomAtScreen };
}

function eventBus(): Bus {
  const listeners = new Map<EventName, ((data: unknown, event: AnyEvent) => void)[]>();
  const any: ((event: AnyEvent) => void)[] = [];
  return {
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)!).push(fn as (data: unknown, event: AnyEvent) => void); },
    onAny(fn) { any.push(fn); },
    emit(name, ...args) {
      const event = { name, data: args[0], at: performance.now() } as AnyEvent;
      any.forEach(fn => fn(event));
      (listeners.get(name) || []).forEach(fn => fn(event.data, event));
    },
  };
}

class GraphNode implements NodeEntity {
  kind = 'node' as const;
  Label: Label;
  Size: Size;
  Position?: Position;
  Collapsed?: boolean;

  constructor(readonly graph: Graph, readonly id: Id, draft: NodeDraft = {}) {
    this.Label = draft.Label ?? { text: id };
    this.Size = draft.Size ?? { w: 150, h: 64 };
    this.Position = draft.Position;
    this.Collapsed = draft.Collapsed;
  }
}

class Graph {
  static new(id: Id) { return new Graph(id); }

  selected: Id | null = null;
  focused: Id | null = null;
  private nextNode = 1;
  private items = new Map<Id, GraphNode>();

  private constructor(readonly id: Id) {}

  node(draft?: NodeDraft, options?: NodeCreateOptions): GraphNode;
  node(id: Id): GraphNode | undefined;
  node(value: NodeDraft | Id = {}, options: NodeCreateOptions = {}) {
    if (typeof value === 'string') return this.items.get(value);
    const id = `e${this.nextNode++}`;
    const node = new GraphNode(this, id, this.withDefaults(value, options));
    this.items.set(id, node);
    return node;
  }

  nodes() { return [...this.items.values()]; }
  selectedNode() { return this.selected ? this.node(this.selected) : undefined; }
  createNode(draft: NodeDraft = {}, options: NodeCreateOptions = {}) { return this.node(draft, options).id; }
  updateNode(id: Id, patch: NodePatch) {
    const node = this.node(id);
    if (!node) return false;
    Object.assign(node, patch);
    return true;
  }
  deleteNode(id: Id) {
    const deleted = this.items.delete(id);
    if (this.selected === id) this.selected = null;
    if (this.focused === id) this.focused = null;
    return deleted;
  }

  private withDefaults(draft: NodeDraft, options: NodeCreateOptions): NodeDraft {
    const nearId = options.near ?? this.selected;
    const selected = options.near === null || !nearId ? undefined : this.node(nearId);
    const anchor = selected?.Position ?? options.at ?? { x: 0, y: 0 };
    const spread = this.items.size % 4;
    return {
      ...draft,
      Position: draft.Position ?? {
        x: anchor.x + (selected ? 180 : spread * 24),
        y: anchor.y + (selected ? 0 : (this.items.size % 3) * 18),
      },
    };
  }
}

function graphStore() {
  let next = 1;
  const graphs = new Map<Id, Graph>();
  const nextId = () => {
    let id = `g${next++}`;
    while (graphs.has(id)) id = `g${next++}`;
    return id;
  };
  const create = (id: Id = nextId()) => {
    const existing = graphs.get(id);
    if (existing) return existing;
    const graph = Graph.new(id);
    graphs.set(id, graph);
    return graph;
  };
  let current = create();
  return {
    get current() { return current; },
    all: () => [...graphs.values()],
    get: (id: Id) => graphs.get(id),
    create,
    delete(id: Id) {
      if (graphs.size <= 1) return current;
      graphs.delete(id);
      if (current.id === id) current = graphs.values().next().value ?? create();
      return current;
    },
    switch(id: Id) {
      current = graphs.get(id) ?? create(id);
      return current;
    },
  };
}

function createContexts(bus: Bus) {
  const commandMap = new Map<string, CommandSpec>();
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);
  const shortcutConflict = (id: string, shortcut: string) => {
    const key = shortcutKey(shortcut);
    if (!key) return undefined;
    return [...commandMap.values()].find(command => command.id !== id && shortcutKey(shortcutOf(command)) === key);
  };

  const commands = {
    register: (command: CommandSpec) => commandMap.set(command.id, command),
    get: (id: string) => commandMap.get(id),
    all: () => [...commandMap.values()],
    shortcutConflict,
    setShortcut(id: string, shortcut: string) {
      const command = commandMap.get(id);
      if (!command) return false;
      const next = shortcut.trim();
      if (shortcutConflict(id, next)) return false;
      command.shortcut = next;
      if (command.input?.key) command.input.key = keyOfShortcut(command.shortcut);
      return true;
    },
    run(id: string, source: CommandSource = {}) {
      const command = commandMap.get(id);
      if (!command || command.available?.(source) === false) return false;
      const payload = command.payload?.(source);
      (bus.emit as (name: EventName, data?: unknown) => void)(command.event, payload);
      return true;
    },
  };

  const input = {
    start(root: Document | HTMLElement = document) {
      const route = (event: Event) => {
        const rawTarget = event.target instanceof Element ? event.target : null;
        const typing = event instanceof KeyboardEvent
          && (/input|textarea|select/i.test(rawTarget?.tagName ?? '') || (rawTarget instanceof HTMLElement && rawTarget.isContentEditable));

        const button = event.type === 'click' ? rawTarget?.closest('[data-command]') : null;
        if (button instanceof HTMLElement) {
          event.preventDefault();
          commands.run(button.dataset.command!, { event, target: button });
          return;
        }

        for (const command of commands.all()) {
          const binding = command.input;
          if (!binding || binding.on !== event.type) continue;
          if (binding.key && !keyMatches(event, binding.key)) continue;
          if (typing && !binding.global) continue;
          const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
          if (!(target instanceof Element) || (binding.selector && !target)) continue;
          if (binding.when && !binding.when(event, target)) continue;
          if (binding.prevent) event.preventDefault();
          commands.run(command.id, { event, target });
          if (binding.stop) break;
        }
      };
      (['click', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'wheel'] as RawInput[])
        .forEach(type => root.addEventListener(type, route, type === 'wheel' ? { passive: false } : undefined));
    },
  };

  const placeContext = {
    set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
    el: (place: Place) => places.get(place) ?? null,
  };

  return { commands, input, places: placeContext, templates, view };
}

function registry(): Registry {
  const entries: { name: string; setup: AppSystem }[] = [];
  const register = ((name: string, setup: AppSystem) => { entries.push({ name, setup }); }) as Registry;
  register.start = (ctx, then) => {
    const api: SystemCtx = { ...ctx, on: ctx.bus.on, emit: ctx.bus.emit };
    entries.forEach(entry => entry.setup(api));
    then?.();
  };
  register.names = () => entries.map(entry => entry.name);
  return register;
}

function createAppContext(): AppCtx {
  const bus = eventBus();
  return { bus, graphs: graphStore(), contexts: createContexts(bus) };
}

const selectable = () => ability<GraphNode>('selectable', [action<GraphNode>({
  id: 'node.select',
  label: 'Select node',
  paletteCommand: 'selection.node.next',
  ui: [{ surface: 'entity', command: 'selection.node.select', kind: 'handler' }],
})]);
const draggable = () => ability<GraphNode>('draggable', [action<GraphNode>({
  id: 'node.drag',
  label: 'Move node',
  paletteCommand: 'graph.node.nudge.right',
  ui: [{ surface: 'entity', command: 'drag.node.start', kind: 'handler', slot: 'header', attrs: { 'data-drag-handle': '' } }],
})]);
const collapsible = () => ability<GraphNode>('collapsible', [action<GraphNode>({
  id: 'node.collapse',
  label: 'Collapse node',
  paletteCommand: 'node.collapse.toggle',
  ui: [{
    surface: 'entity',
    command: 'node.collapse.toggle',
    kind: 'button',
    slot: 'header:start',
    className: 'node-action node-toggle',
    text: node => node.Collapsed ? '+' : '-',
    label: node => node.Collapsed ? 'Expand node' : 'Collapse node',
  }],
})]);
const editable = () => ability<GraphNode>('editable', [action<GraphNode>({
  id: 'node.title.edit',
  label: 'Edit node title',
  paletteCommand: 'node.title.edit',
  ui: [{
    surface: 'entity',
    command: 'node.title.edit',
    kind: 'handler',
    slot: 'title',
    className: 'editable-inline',
    attrs: { contenteditable: 'plaintext-only', 'data-command': 'node.title.edit' },
  }],
})]);
const configurable = () => ability<GraphNode>('configurable', [action<GraphNode>({
  id: 'node.configure',
  label: 'Configure node',
  paletteCommand: 'item.properties.open',
  ui: [{
    surface: 'entity',
    command: 'item.properties.open',
    kind: 'button',
    slot: 'header:end',
    className: 'node-action node-config',
    text: '⚙',
    label: 'Configure node',
  }],
})]);

const nodeEntity = entity<GraphNode>('node', {
  label: 'Node',
  labelOf: node => node.Label.text,
  abilities: [selectable(), draggable(), collapsible(), editable(), configurable()],
});

const appModel = {
  entities: [nodeEntity as EntityDef<unknown>],
  collections: [
    collection<Graph>('graphs', {
      label: 'Graphs',
      items: ctx => ctx.graphs.all(),
      itemId: graph => graph.id,
      itemLabel: graph => graph.id,
      selectCommand: 'graph.switch.item',
      crud: { create: 'graph.create', delete: 'graph.delete.current' },
      search: true,
      order: 'created',
    }) as AppCollectionDef<unknown>,
    collection<GraphNode>('nodes', {
      label: 'Nodes',
      entity: nodeEntity,
      items: ctx => ctx.graphs.current.nodes(),
      itemId: node => node.id,
      itemLabel: node => node.Label.text,
      selectCommand: 'selection.node.select',
      crud: { create: 'editing.node.create', delete: 'graph.node.delete.selected' },
      search: true,
      order: 'created',
    }) as AppCollectionDef<unknown>,
  ],
} satisfies AppModelDef;

function validateModel(model: AppModelDef, commands: ReturnType<Contexts['commands']['all']>) {
  const commandIds = new Set(commands.map(command => command.id));
  const visibleCommandIds = new Set(commands.filter(command => !command.hidden).map(command => command.id));
  const issues: string[] = [];
  model.entities.forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    if (!abilityDef.actions.length) issues.push(`${entityDef.kind}.${abilityDef.id} has no actions`);
    abilityDef.actions.forEach(actionDef => {
      if (!visibleCommandIds.has(actionDef.paletteCommand)) issues.push(`${actionDef.id} missing visible palette command ${actionDef.paletteCommand}`);
      if (!actionDef.ui.length) issues.push(`${actionDef.id} has no UI affordance`);
      actionDef.ui.forEach(ui => {
        if (!commandIds.has(ui.command)) issues.push(`${actionDef.id} UI missing command ${ui.command}`);
      });
    });
  }));
  model.collections.forEach(collectionDef => {
    if (!commandIds.has(collectionDef.crud.create)) issues.push(`${collectionDef.id} missing create command ${collectionDef.crud.create}`);
    if (!commandIds.has(collectionDef.crud.delete)) issues.push(`${collectionDef.id} missing delete command ${collectionDef.crud.delete}`);
    if (!collectionDef.search) issues.push(`${collectionDef.id} missing search`);
    if (!collectionDef.order) issues.push(`${collectionDef.id} missing order`);
  });
  return issues;
}

const systems = registry();
const features = registry();
const system = systems;
const feature = features;

system('render', ({ on, emit, graphs, contexts }) => {
  const root = document.getElementById('app')!;
  const views = new Map<Place, Map<string, Renderable>>();
  const applyAffordance = (el: HTMLElement, node: GraphNode, ui: AffordanceDef<GraphNode>) => {
    if (ui.className) el.classList.add(...ui.className.split(/\s+/).filter(Boolean));
    Object.entries(ui.attrs ?? {}).forEach(([name, value]) => el.setAttribute(name, uiValue(value, node)));
  };
  const affordanceButton = (node: GraphNode, actionDef: ActionDef<GraphNode>, ui: AffordanceDef<GraphNode>) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = ui.command;
    button.textContent = uiValue(ui.text, node, actionDef.label);
    button.setAttribute('aria-label', uiValue(ui.label, node, actionDef.label));
    applyAffordance(button, node, ui);
    return button;
  };
  const wireNodeAffordances = (el: HTMLElement, node: GraphNode) => {
    entityUi(nodeEntity, 'header')
      .filter(({ ui }) => ui.kind === 'handler')
      .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, 'header'), node, ui));
    entityUi(nodeEntity, 'title')
      .filter(({ ui }) => ui.kind === 'handler')
      .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, 'title'), node, ui));
    (['header:start', 'header:end'] as const).forEach(slot => {
      const target = contexts.templates.slot(el, slot);
      entityUi(nodeEntity, slot)
        .filter(({ ui }) => ui.kind === 'button')
        .forEach(({ action, ui }) => target.append(affordanceButton(node, action, ui)));
    });
  };
  const syncStageView = () => {
    const stage = contexts.places.el(Places.Stage), view = contexts.view.get();
    if (!stage) return;
    stage.style.setProperty('--grid-size', `${32 * view.scale}px`);
    stage.style.setProperty('--grid-x', `${-view.x * view.scale}px`);
    stage.style.setProperty('--grid-y', `${-view.y * view.scale}px`);
    stage.dataset.zoom = `${Math.round(view.scale * 100)}%`;
  };
  const flush = (place: Place) => {
    const slot = contexts.places.el(place), parts = views.get(place);
    if (!slot || !parts) return;
    slot.replaceChildren();
    [...parts.values()].forEach(view => appendRenderable(slot, view));
  };
  const nodeView = (node: GraphNode) => {
    const graph = graphs.current;
    const el = contexts.templates.clone('node');
    const pos = node.Position ?? { x: 0, y: 0 };
    el.dataset.nodeId = node.id;
    el.classList.toggle('selected', graph.selected === node.id);
    el.classList.toggle('focused', graph.focused === node.id);
    el.classList.toggle('collapsed', !!node.Collapsed);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${node.Size.w}px`;
    el.style.height = `${node.Size.h}px`;
    contexts.templates.text(el, 'title', node.Label.text);
    contexts.templates.text(el, 'meta', node.id);
    wireNodeAffordances(el, node);
    return el;
  };
  const drawNodes = () => emit('render.view.set', {
    place: Places.Stage,
    key: 'nodes',
    view: () => {
      syncStageView();
      const view = contexts.view.get();
      const layer = contexts.templates.clone('nodes');
      layer.style.transform = `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})`;
      graphs.current.nodes()
        .filter(node => contexts.view.isVisible(Places.Stage, nodeRect(node), 160))
        .forEach(node => layer.append(nodeView(node)));
      return layer;
    },
  });

  on('render.shell', () => {
    root.replaceChildren(contexts.templates.clone('shell'));
    Object.values(Places).forEach(place => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
    syncStageView();
    Object.values(Places).forEach(flush);
  });
  on('render.view.set', ({ place, key = 'default', view }) => {
    (views.get(place) || views.set(place, new Map()).get(place)!).set(key, view);
    flush(place);
  });
  on('render.view.clear', ({ place, key }) => { key ? views.get(place)?.delete(key) : views.delete(place); flush(place); });
  on('render.nodes.draw', drawNodes);
  on('view.changed', drawNodes);
});

system('input', ({ on, contexts }) => {
  on('app.start', () => contexts.input.start());
});

system('main', ({ on, emit, contexts }) => {
  on('app.start', () => {
    emit('render.shell');
    emit('render.view.set', {
      place: Places.Top,
      key: 'toolbar',
      view: () => contexts.templates.clone('toolbar'),
    });
  });
});

system('log', ({ bus, emit, contexts }) => {
  const rows: string[] = [];
  const renderLog = () => {
    const panel = contexts.templates.clone('log');
    const list = contexts.templates.slot(panel, 'rows');
    rows.forEach(row => {
      const item = contexts.templates.clone('log-row');
      contexts.templates.text(item, 'name', row);
      list.append(item);
    });
    return panel;
  };
  bus.onAny(event => {
    if (event.name.startsWith('render.')) return;
    rows.unshift(event.name);
    rows.length = Math.min(rows.length, 12);
    emit('render.view.set', {
      place: Places.Left,
      key: 'log',
      view: renderLog,
    });
  });
});

system('outline', ctx => {
  const { on, emit, contexts } = ctx;
  const searches = new Map<string, string>();
  const el = (tag: string, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const renderCollection = (collectionDef: AppCollectionDef<unknown>) => {
    const section = el('section', 'outline-section');
    const head = el('div', 'outline-head');
    const title = el('h2', 'panel-title', collectionDef.label);
    const createButton = el('button', 'icon-button', '+') as HTMLButtonElement;
    createButton.dataset.command = collectionDef.crud.create;
    head.append(title, createButton);
    section.append(head);

    const query = searches.get(collectionDef.id) ?? '';
    const search = el('input', 'outline-search') as HTMLInputElement;
    search.placeholder = `Search ${collectionDef.label.toLowerCase()}`;
    search.value = query;
    search.dataset.collectionId = collectionDef.id;
    section.append(search);

    const list = el('div', 'outline-list');
    collectionDef.items(ctx)
      .filter(item => collectionDef.itemLabel(item).toLowerCase().includes(query.toLowerCase()))
      .forEach(item => {
        const id = collectionDef.itemId(item);
        const row = el('div', 'outline-row');
        row.dataset.itemId = id;
        if (collectionDef.id === 'graphs') row.dataset.graphId = id;
        if (collectionDef.id === 'nodes') row.dataset.nodeId = id;
        const main = el('button', 'outline-main', collectionDef.itemLabel(item)) as HTMLButtonElement;
        if (collectionDef.selectCommand) main.dataset.command = collectionDef.selectCommand;
        const remove = el('button', 'icon-button', 'x') as HTMLButtonElement;
        remove.dataset.command = collectionDef.crud.delete;
        row.append(main, remove);
        list.append(row);
      });
    section.append(list);
    return section;
  };
  const renderOutline = () => {
    const panel = el('section', 'outline');
    appModel.collections.forEach(collectionDef => panel.append(renderCollection(collectionDef)));
    return panel;
  };
  const draw = () => emit('render.view.set', { place: Places.Left, key: 'outline', view: renderOutline });
  on('app.start', draw);
  on('outline.draw', draw);
  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('outline-search')) return;
    searches.set(target.dataset.collectionId!, target.value);
    draw();
    const next = contexts.places.el(Places.Left)?.querySelector(`[data-collection-id="${target.dataset.collectionId}"]`) as HTMLInputElement | null;
    next?.focus();
    next?.setSelectionRange(next.value.length, next.value.length);
  });
});

system('modal', ({ on, emit, contexts }) => {
  let open = false;
  contexts.commands.register({
    id: 'modal.open',
    label: 'Open modal',
    event: 'modal.open',
    group: 'modal',
    payload: ({ target }) => ({ title: (target as HTMLElement)?.dataset.title, body: (target as HTMLElement)?.dataset.body, visual: (target as HTMLElement)?.dataset.visual as AppEvents['modal.open']['visual'] }),
  });
  contexts.commands.register({ id: 'modal.close', label: 'Close modal', event: 'modal.close', group: 'modal', shortcut: 'Esc', input: { on: 'keydown', key: 'Escape', global: true, when: () => open, prevent: true } });

  on('modal.close', () => {
    open = false;
    emit('render.view.set', { place: Places.Modal, key: 'modal', view: '' });
  });
  on('modal.open', ({ title = 'Modal', body = '', visual = 'panel' }) => {
    open = true;
    emit('render.view.set', {
      place: Places.Modal,
      key: 'modal',
      view: () => {
        const modal = contexts.templates.clone('modal');
        modal.dataset.visual = visual;
        contexts.templates.text(modal, 'title', title);
        appendRenderable(contexts.templates.slot(modal, 'body'), body);
        return modal;
      },
    });
    queueMicrotask(() => (contexts.places.el(Places.Modal)?.querySelector('[autofocus]') as HTMLElement | null)?.focus());
  });
});

type CommandModalDef = {
  id: 'palette' | 'help';
  title: string;
  event: 'palette.open' | 'help.open';
  label: string;
  shortcut: string;
  key: string;
  editableHotkeys: boolean;
  availableOnly: boolean;
  placeholder: string;
};
const commandModals: Record<CommandModalDef['id'], CommandModalDef> = {
  palette: { id: 'palette', title: 'Palette', event: 'palette.open', label: 'Open palette', shortcut: 'P', key: 'p', editableHotkeys: false, availableOnly: true, placeholder: 'Search commands' },
  help: { id: 'help', title: 'Help', event: 'help.open', label: 'Open help', shortcut: '?', key: '?', editableHotkeys: true, availableOnly: false, placeholder: 'Search shortcuts' },
};

system('commandModal', ({ on, emit, contexts }) => {
  const syncShortcutConflict = (input: HTMLInputElement) => {
    const conflict = contexts.commands.shortcutConflict(input.dataset.shortcutCommand!, input.value);
    input.classList.toggle('is-conflict', !!conflict);
    input.toggleAttribute('aria-invalid', !!conflict);
    input.title = conflict ? `Already used by ${conflict.label}` : '';
    input.closest('.help-row')?.classList.toggle('has-conflict', !!conflict);
    return !conflict;
  };
  const visibleCommands = (modal: CommandModalDef, query = '') => {
    const q = query.trim().toLowerCase();
    return contexts.commands.all()
      .filter(command => !command.hidden)
      .filter(command => !modal.availableOnly || command.available?.() !== false)
      .filter(command => !q || `${command.id} ${command.label} ${command.group ?? ''} ${shortcutOf(command)}`.toLowerCase().includes(q));
  };
  const commandSection = (modal: CommandModalDef, group: string, commands: CommandSpec[]) => {
    const section = contexts.templates.clone('command-section');
    const rows = contexts.templates.slot(section, 'rows');
    contexts.templates.text(section, 'group', group);
    commands.forEach(command => {
      const shortcut = shortcutOf(command);
      const row = contexts.templates.clone<HTMLElement>(modal.editableHotkeys ? 'help-row' : 'command-row');
      if (!modal.editableHotkeys) row.dataset.command = command.id;
      contexts.templates.text(row, 'label', command.label);
      contexts.templates.text(row, 'id', command.id);
      if (modal.editableHotkeys) {
        const input = row.querySelector('input');
        if (input) {
          input.dataset.shortcutCommand = command.id;
          input.value = shortcut;
          input.setAttribute('aria-label', `${command.label} shortcut`);
          syncShortcutConflict(input);
        }
      } else if (shortcut) contexts.templates.text(row, 'shortcut', shortcut);
      else row.querySelector('kbd')?.remove();
      rows.append(row);
    });
    return section;
  };
  const renderList = (modal: CommandModalDef, query = '') => {
    const fragment = document.createDocumentFragment();
    grouped(visibleCommands(modal, query), command => command.group ?? systemOf(command.id))
      .forEach(([group, commands]) => fragment.append(commandSection(modal, group, commands)));
    return fragment;
  };
  const renderCommandModal = (modal: CommandModalDef) => {
    const palette = contexts.templates.clone('palette');
    palette.dataset.commandModal = modal.id;
    const input = palette.querySelector('.palette-search');
    if (input instanceof HTMLInputElement) input.placeholder = modal.placeholder;
    contexts.templates.slot(palette, 'commands').append(renderList(modal));
    return palette;
  };
  Object.values(commandModals).forEach(modal => contexts.commands.register({
    id: modal.event,
    label: modal.label,
    event: modal.event,
    group: 'modal',
    shortcut: modal.shortcut,
    input: { on: 'keydown', key: modal.key, prevent: true },
  }));
  const open = (modal: CommandModalDef) => emit('modal.open', {
    title: modal.title,
    visual: 'command',
    body: () => renderCommandModal(modal),
  });
  on('palette.open', () => open(commandModals.palette));
  on('help.open', () => open(commandModals.help));
  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.classList.contains('shortcut-edit')) {
      syncShortcutConflict(target);
      return;
    }
    if (!target.classList.contains('palette-search')) return;
    const root = target.closest('[data-command-modal]');
    const modal = root instanceof HTMLElement ? commandModals[root.dataset.commandModal as CommandModalDef['id']] : null;
    const list = root?.querySelector('[data-slot="commands"]');
    if (modal && list) list.replaceChildren(renderList(modal, target.value));
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('shortcut-edit')) return;
    if (!syncShortcutConflict(target)) return;
    contexts.commands.setShortcut(target.dataset.shortcutCommand!, target.value);
  });
});

system('domain', ({ contexts, graphs }) => {
  let count = 1;
  const selectedNode = () => graphs.current.selectedNode();
  const nodeId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.selected || '';
  const graphId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.id;
  const nextNodeId = () => {
    const nodes = graphs.current.nodes();
    const index = Math.max(0, nodes.findIndex(node => node.id === graphs.current.selected));
    return nodes[(index + 1) % nodes.length]?.id ?? nodes[0]?.id ?? '';
  };
  const nextGraphId = () => graphs.all().find(graph => graph.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

  contexts.commands.register({
    id: 'editing.node.create',
    label: 'Create node',
    event: 'editing.node.create',
    group: 'editing',
    shortcut: 'A',
    input: { on: 'keydown', key: 'a', prevent: true },
    payload: () => ({ Label: { text: `Node ${count++}` } }),
  });
  contexts.commands.register({
    id: 'graph.create',
    label: 'Create graph',
    event: 'graph.create',
    group: 'graph',
    shortcut: 'N',
    input: { on: 'keydown', key: 'n', prevent: true },
  });
  contexts.commands.register({
    id: 'graph.switch.next',
    label: 'Switch graph',
    event: 'graph.switch',
    group: 'graph',
    shortcut: 'G',
    input: { on: 'keydown', key: 'g', prevent: true },
    payload: () => ({ id: nextGraphId() }),
  });
  contexts.commands.register({
    id: 'graph.switch.item',
    label: 'Switch graph item',
    event: 'graph.switch',
    group: 'graph',
    hidden: true,
    payload: source => ({ id: graphId(source) }),
  });
  contexts.commands.register({
    id: 'graph.node.delete.selected',
    label: 'Delete node',
    event: 'graph.node.delete',
    group: 'graph',
    shortcut: 'Delete',
    input: { on: 'keydown', key: 'Delete', prevent: true },
    available: source => !!nodeId(source ?? {}) || !!graphs.current.selected,
    payload: source => ({ id: nodeId(source) }),
  });
  contexts.commands.register({
    id: 'graph.delete.current',
    label: 'Delete graph',
    event: 'graph.delete',
    group: 'graph',
    available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
    payload: source => ({ id: graphId(source) }),
  });
  contexts.commands.register({
    id: 'selection.node.select',
    label: 'Select node',
    event: 'selection.node.select',
    group: 'selection',
    hidden: true,
    input: { on: 'pointerdown', selector: '[data-node-id]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
    payload: source => ({ id: nodeId(source) }),
  });
  contexts.commands.register({
    id: 'selection.node.next',
    label: 'Select next node',
    event: 'selection.node.select',
    group: 'selection',
    shortcut: 'Tab',
    input: { on: 'keydown', key: 'Tab', prevent: true },
    available: () => graphs.current.nodes().length > 0,
    payload: () => ({ id: nextNodeId() }),
  });
  contexts.commands.register({
    id: 'selection.node.clear',
    label: 'Clear selection',
    event: 'selection.node.clear',
    group: 'selection',
    available: () => !!graphs.current.selected,
    input: { on: 'pointerdown', selector: `[data-place="${Places.Stage}"]`, when: isStageSurface },
  });
  contexts.commands.register({
    id: 'graph.node.nudge.right',
    label: 'Nudge node right',
    event: 'graph.node.update',
    group: 'node',
    shortcut: 'ArrowRight',
    input: { on: 'keydown', key: 'ArrowRight', prevent: true },
    available: () => !!selectedNode(),
    payload: () => {
      const node = selectedNode()!;
      const pos = node.Position ?? { x: 0, y: 0 };
      return { id: node.id, patch: { Position: { x: pos.x + 24, y: pos.y } } };
    },
  });
  contexts.commands.register({
    id: 'node.collapse.toggle',
    label: 'Toggle node collapse',
    event: 'graph.node.update',
    group: 'node',
    shortcut: 'C',
    input: { on: 'keydown', key: 'c', prevent: true },
    available: source => !!nodeId(source ?? {}) || !!selectedNode(),
    payload: source => {
      const id = nodeId(source) || graphs.current.selected || graphs.current.nodes()[0]?.id || '';
      const node = graphs.current.node(id)!;
      return { id, patch: { Collapsed: !node.Collapsed } };
    },
  });
  contexts.commands.register({
    id: 'node.title.edit',
    label: 'Edit node title',
    event: 'node.title.edit',
    group: 'node',
    shortcut: 'Enter',
    input: { on: 'keydown', key: 'Enter', prevent: true },
    available: source => !!nodeId(source ?? {}) || !!selectedNode(),
    payload: source => ({ id: nodeId(source) || graphs.current.selected || '' }),
  });
  contexts.commands.register({
    id: 'item.properties.open',
    label: 'Open item properties',
    event: 'item.properties.open',
    group: 'item',
    available: source => !!itemRefFrom(source?.target) || !!selectedNode(),
    payload: source => itemRefFrom(source.target) ?? { kind: 'node', id: graphs.current.selected || '' },
  });
});

system('inlineEdit', ({ on, emit, graphs }) => {
  const titleEl = (id: Id) => document.querySelector(`.node[data-node-id="${id}"] .node-title`);
  on('node.title.edit', ({ id }) => queueMicrotask(() => {
    const title = titleEl(id);
    if (!(title instanceof HTMLElement)) return;
    title.focus();
    const range = document.createRange();
    range.selectNodeContents(title);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }));
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('node-title') || event.key !== 'Enter') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.blur();
  });
  document.addEventListener('blur', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('node-title')) return;
    const id = itemIdFrom(target);
    const node = graphs.current.node(id);
    if (!node) return;
    const text = target.textContent?.trim() || node.Label.text;
    if (text !== node.Label.text) emit('graph.node.update', { id, patch: { Label: { text } } });
    else target.textContent = node.Label.text;
  }, true);
});

system('properties', ({ on, emit, graphs, contexts }) => {
  const renderNodeProperties = (node: GraphNode) => {
    const form = contexts.templates.clone('properties');
    form.dataset.itemKind = 'node';
    form.dataset.itemId = node.id;
    (form.querySelector('[data-field="title"]') as HTMLInputElement).value = node.Label.text;
    (form.querySelector('[data-field="width"]') as HTMLInputElement).value = `${node.Size.w}`;
    (form.querySelector('[data-field="height"]') as HTMLInputElement).value = `${node.Size.h}`;
    (form.querySelector('[data-field="collapsed"]') as HTMLInputElement).checked = !!node.Collapsed;
    return form;
  };
  const nodeFrom = (target: Element) => {
    const form = target.closest('.properties');
    return form instanceof HTMLElement && form.dataset.itemKind === 'node'
      ? graphs.current.node(form.dataset.itemId ?? '')
      : undefined;
  };
  const updateSize = (node: GraphNode, field: string, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const Size = { ...node.Size, [field === 'width' ? 'w' : 'h']: clamp(n, field === 'width' ? 96 : 40, 900) };
    emit('graph.node.update', { id: node.id, patch: { Size } });
  };

  on('item.properties.open', ref => {
    if (ref.kind !== 'node') return;
    const node = graphs.current.node(ref.id);
    if (!node) return;
    emit('modal.open', {
      title: 'Node Properties',
      visual: 'properties',
      body: () => renderNodeProperties(node),
    });
  });
  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.closest('.properties')) return;
    const node = nodeFrom(target);
    if (!node) return;
    if (target.dataset.field === 'title') emit('graph.node.update', { id: node.id, patch: { Label: { text: target.value } } });
    if (target.dataset.field === 'width' || target.dataset.field === 'height') updateSize(node, target.dataset.field, target.value);
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.field !== 'collapsed') return;
    const node = nodeFrom(target);
    if (node) emit('graph.node.update', { id: node.id, patch: { Collapsed: target.checked } });
  });
});

system('graph', ({ on, emit, graphs, contexts }) => {
  on('graph.create', () => {
    const graph = graphs.create();
    graphs.switch(graph.id);
    emit('graph.created', { id: graph.id });
    emit('graph.switched', { id: graph.id });
  });
  on('graph.switch', ({ id }) => {
    const graph = graphs.switch(id);
    emit('graph.switched', { id: graph.id });
  });
  on('graph.node.create', draft => {
    const node = graphs.current.node(draft, { at: contexts.view.spaceCenter(Places.Stage) });
    emit('graph.node.created', { graphId: graphs.current.id, id: node.id });
  });
  on('graph.node.update', ({ id, patch }) => {
    if (graphs.current.updateNode(id, patch)) emit('graph.node.updated', { graphId: graphs.current.id, id });
  });
  on('graph.node.delete', ({ id }) => {
    if (graphs.current.deleteNode(id)) emit('graph.node.deleted', { graphId: graphs.current.id, id });
  });
  on('graph.delete', ({ id }) => {
    const next = graphs.delete(id);
    emit('graph.deleted', { id, nextId: next.id });
    emit('graph.switched', { id: next.id });
  });
});

system('view', ({ on, emit, contexts }) => {
  let pan: { pointer: Position; view: ViewState } | null = null;
  const stageSelector = `[data-place="${Places.Stage}"]`;
  const commit = () => emit('view.changed', contexts.view.get());
  const centerZoom = (factor: number) => {
    contexts.view.zoomAtScreen(contexts.view.screenCenter(Places.Stage), factor);
    commit();
  };

  contexts.commands.register({
    id: 'view.zoom.wheel',
    label: 'Wheel zoom',
    event: 'view.zoom.by',
    group: 'view',
    hidden: true,
    input: { on: 'wheel', selector: stageSelector, prevent: true },
    payload: ({ event }) => {
      const wheel = event as WheelEvent;
      return {
        screen: contexts.view.clientToScreen(Places.Stage, { x: wheel.clientX, y: wheel.clientY }),
        factor: Math.exp(-wheel.deltaY * 0.001),
      };
    },
  });
  contexts.commands.register({ id: 'view.zoom.in', label: 'Zoom in', event: 'view.zoom.in', group: 'view', shortcut: '+', input: { on: 'keydown', key: '+', prevent: true } });
  contexts.commands.register({ id: 'view.zoom.out', label: 'Zoom out', event: 'view.zoom.out', group: 'view', shortcut: '-', input: { on: 'keydown', key: '-', prevent: true } });
  contexts.commands.register({ id: 'view.zoom.reset', label: 'Reset view', event: 'view.zoom.reset', group: 'view', shortcut: '0', input: { on: 'keydown', key: '0', prevent: true } });
  contexts.commands.register({
    id: 'view.pan.start',
    label: 'Start canvas pan',
    event: 'view.pan.start',
    group: 'view',
    hidden: true,
    input: { on: 'pointerdown', selector: stageSelector, when: isStageSurface, prevent: true },
    payload: ({ event }) => clientPoint(event!),
  });
  contexts.commands.register({
    id: 'view.pan.move',
    label: 'Pan canvas',
    event: 'view.pan.move',
    group: 'view',
    hidden: true,
    input: { on: 'pointermove', when: () => !!pan, prevent: true },
    payload: ({ event }) => clientPoint(event!),
  });
  contexts.commands.register({ id: 'view.pan.end', label: 'End canvas pan', event: 'view.pan.end', group: 'view', hidden: true, input: { on: 'pointerup', when: () => !!pan } });

  on('view.zoom.by', ({ screen, factor }) => { contexts.view.zoomAtScreen(screen, factor); commit(); });
  on('view.zoom.in', () => centerZoom(1.2));
  on('view.zoom.out', () => centerZoom(1 / 1.2));
  on('view.zoom.reset', () => { contexts.view.set({ x: 0, y: 0, scale: 1 }); commit(); });
  on('view.pan.start', pointer => {
    pan = { pointer, view: contexts.view.get() };
    contexts.places.el(Places.Stage)?.classList.add('panning');
  });
  on('view.pan.move', pointer => {
    if (!pan) return;
    contexts.view.set({
      x: pan.view.x - (pointer.x - pan.pointer.x) / pan.view.scale,
      y: pan.view.y - (pointer.y - pan.pointer.y) / pan.view.scale,
    });
    commit();
  });
  on('view.pan.end', () => {
    pan = null;
    contexts.places.el(Places.Stage)?.classList.remove('panning');
  });
});

system('selection', ({ on, emit, graphs, contexts }) => {
  on('selection.node.select', ({ id }) => { graphs.current.selected = id; emit('selection.node.selected', { id }); });
  on('selection.node.clear', () => { graphs.current.selected = null; emit('selection.node.selected', { id: null }); });
});

system('focus', ({ on, emit, graphs }) => {
  on('focus.node.focus', ({ id }) => { graphs.current.focused = id; emit('focus.node.focused', { id }); });
  on('focus.node.clear', () => { graphs.current.focused = null; emit('focus.node.focused', { id: null }); });
});

system('drag', ({ on, emit, graphs, contexts }) => {
  let drag: { id: Id; pointer: Position; start: Position } | null = null;
  contexts.commands.register({
    id: 'drag.node.start',
    label: 'Start drag',
    event: 'drag.node.start',
    group: 'drag',
    hidden: true,
    input: { on: 'pointerdown', selector: '[data-drag-handle]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
    payload: ({ event, target }) => ({ id: itemIdFrom(target), x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
  });
  contexts.commands.register({
    id: 'drag.node.move',
    label: 'Move dragged node',
    event: 'drag.node.move',
    group: 'drag',
    hidden: true,
    input: { on: 'pointermove', when: () => !!drag, prevent: true },
    payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
  });
  contexts.commands.register({ id: 'drag.node.end', label: 'End drag', event: 'drag.node.end', group: 'drag', hidden: true, input: { on: 'pointerup', when: () => !!drag } });

  on('drag.node.start', ({ id, x, y }) => {
    const node = graphs.current.node(id);
    if (node?.Position) drag = { id, pointer: contexts.view.clientToSpace(Places.Stage, { x, y }), start: { ...node.Position } };
  });
  on('drag.node.move', ({ x, y }) => {
    if (!drag) return;
    const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
    emit('graph.node.update', { id: drag.id, patch: { Position: { x: drag.start.x + pointer.x - drag.pointer.x, y: drag.start.y + pointer.y - drag.pointer.y } } });
    emit('drag.node.moved', { id: drag.id });
  });
  on('drag.node.end', () => { drag = null; });
});

system('dx', ({ on, contexts }) => {
  on('app.start', () => {
    const issues = validateModel(appModel, contexts.commands.all());
    if (issues.length) throw new Error(`DX model contract failed:\n${issues.join('\n')}`);
  });
});

feature('nodeLifecycle', ({ on, emit }) => {
  on('editing.node.create', draft => emit('graph.node.create', draft));
  on('graph.node.created', ({ id }) => {
    emit('selection.node.select', { id });
    emit('focus.node.focus', { id });
  });
  on('graph.node.updated', () => emit('render.nodes.draw'));
  on('graph.node.deleted', () => emit('render.nodes.draw'));
  on('graph.switched', () => emit('render.nodes.draw'));
  on('graph.created', () => emit('outline.draw'));
  on('graph.deleted', () => emit('outline.draw'));
  on('graph.node.created', () => emit('outline.draw'));
  on('graph.node.deleted', () => emit('outline.draw'));
  on('graph.switched', () => emit('outline.draw'));
  on('selection.node.selected', () => emit('render.nodes.draw'));
  on('selection.node.selected', () => emit('outline.draw'));
  on('focus.node.focused', () => emit('render.nodes.draw'));
});

window.addEventListener('DOMContentLoaded', () => {
  const ctx = createAppContext();
  systems.start(ctx);
  features.start(ctx, () => ctx.bus.emit('app.start'));
  window.v2 = ctx;
});

export {};
