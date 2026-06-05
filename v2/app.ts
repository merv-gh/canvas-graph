type Id = string;
type Renderable = string | globalThis.Node | (() => string | globalThis.Node);
type RawInput = 'click' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup' | 'wheel';

const Places = { Top: 'top', Left: 'left', Stage: 'stage', Modal: 'modal' } as const;
type Place = typeof Places[keyof typeof Places];

type Position = { x: number; y: number };
type Size = { w: number; h: number };
type Rect = Position & Size;
type ViewState = Position & { scale: number };
type Label = { text: string };
type NodeDraft = { Label?: Label; Position?: Position; Size?: Size };
type NodeEntity = { id: Id; kind: 'node'; Label: Label; Size: Size; Position?: Position };
type NodePatch = Partial<Pick<NodeEntity, 'Label' | 'Size' | 'Position'>>;

type AppEvents = {
  'app.start': void;
  'render.shell': void;
  'render.view.set': { place: Place; key?: string; view: Renderable };
  'render.view.clear': { place: Place; key?: string };
  'render.nodes.draw': void;
  'modal.open': { title?: string; body?: Renderable };
  'modal.close': void;
  'palette.open': void;
  'help.open': void;
  'view.changed': ViewState;
  'view.zoom.by': { screen: Position; factor: number };
  'view.zoom.in': void;
  'view.zoom.out': void;
  'view.zoom.reset': void;
  'view.pan.start': Position;
  'view.pan.move': Position;
  'view.pan.end': void;
  'editing.node.create': NodeDraft;
  'data.node.create': NodeDraft;
  'data.node.created': { id: Id };
  'data.node.update': { id: Id; patch: NodePatch };
  'data.node.updated': { id: Id };
  'layout.node.center': { id: Id };
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
type EventName = keyof AppEvents;
type EventOf<K extends EventName = EventName> = { name: K; data: AppEvents[K]; at: number };
type AnyEvent = { [K in EventName]: EventOf<K> }[EventName];
type Bus = {
  on<K extends EventName>(name: K, fn: (data: AppEvents[K], event: EventOf<K>) => void): void;
  onAny(fn: (event: AnyEvent) => void): void;
  emit<K extends EventName>(name: K, ...data: AppEvents[K] extends void ? [] : [AppEvents[K]]): void;
};

type CommandSource = { event?: Event; target?: Element | null };
type CommandInput = {
  on: RawInput;
  key?: string;
  selector?: string;
  global?: boolean;
  prevent?: boolean;
  stop?: boolean;
  when?: (event: Event, target: Element) => boolean;
};
type CommandSpec<K extends EventName = EventName> = {
  id: string;
  label: string;
  event: K;
  input?: CommandInput;
  group?: string;
  hidden?: boolean;
  shortcut?: string;
  payload?: (source: CommandSource) => AppEvents[K];
};

type World = ReturnType<typeof worldStore>;
type Contexts = ReturnType<typeof createContexts>;
type AppCtx = { bus: Bus; world: World; contexts: Contexts };
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

function worldStore() {
  let next = 1, selected: Id | null = null, focused: Id | null = null;
  const nodes = new Map<Id, NodeEntity>();
  return {
    get selected() { return selected; },
    set selected(id: Id | null) { selected = id; },
    get focused() { return focused; },
    set focused(id: Id | null) { focused = id; },
    createNode(draft: NodeDraft = {}) {
      const id = `e${next++}`;
      nodes.set(id, { id, kind: 'node', Size: { w: 150, h: 64 }, ...draft, Label: draft.Label ?? { text: id } });
      return id;
    },
    node: (id: Id) => nodes.get(id),
    nodes: () => [...nodes.values()],
    updateNode(id: Id, patch: NodePatch) {
      const node = nodes.get(id);
      if (!node) return false;
      Object.assign(node, patch);
      return true;
    },
  };
}

function createContexts(bus: Bus) {
  const commandMap = new Map<string, CommandSpec>();
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);

  const commands = {
    register: (command: CommandSpec) => commandMap.set(command.id, command),
    get: (id: string) => commandMap.get(id),
    all: () => [...commandMap.values()],
    setShortcut(id: string, shortcut: string) {
      const command = commandMap.get(id);
      if (!command) return false;
      command.shortcut = shortcut.trim();
      if (command.input?.key) command.input.key = keyOfShortcut(command.shortcut);
      return true;
    },
    run(id: string, source: CommandSource = {}) {
      const command = commandMap.get(id);
      if (!command) return false;
      const payload = command.payload?.(source);
      (bus.emit as (name: EventName, data?: unknown) => void)(command.event, payload);
      return true;
    },
  };

  const input = {
    start(root: Document | HTMLElement = document) {
      const route = (event: Event) => {
        const rawTarget = event.target instanceof Element ? event.target : null;
        const typing = event instanceof KeyboardEvent && /input|textarea|select/i.test(rawTarget?.tagName ?? '');

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
  return { bus, world: worldStore(), contexts: createContexts(bus) };
}

const systems = registry();
const features = registry();
const system = systems;
const feature = features;

system('render', ({ on, emit, world, contexts }) => {
  const root = document.getElementById('app')!;
  const views = new Map<Place, Map<string, Renderable>>();
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
  const nodeView = (node: NodeEntity) => {
    const el = contexts.templates.clone('node');
    const pos = node.Position ?? { x: 0, y: 0 };
    el.dataset.nodeId = node.id;
    el.classList.toggle('selected', world.selected === node.id);
    el.classList.toggle('focused', world.focused === node.id);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${node.Size.w}px`;
    el.style.height = `${node.Size.h}px`;
    contexts.templates.text(el, 'title', node.Label.text);
    contexts.templates.text(el, 'meta', node.id);
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
      world.nodes()
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

system('modal', ({ on, emit, contexts }) => {
  let open = false;
  contexts.commands.register({
    id: 'modal.open',
    label: 'Open modal',
    event: 'modal.open',
    group: 'modal',
    payload: ({ target }) => ({ title: (target as HTMLElement)?.dataset.title, body: (target as HTMLElement)?.dataset.body }),
  });
  contexts.commands.register({ id: 'modal.close', label: 'Close modal', event: 'modal.close', group: 'modal', shortcut: 'Esc', input: { on: 'keydown', key: 'Escape', global: true, when: () => open, prevent: true } });

  on('modal.close', () => {
    open = false;
    emit('render.view.set', { place: Places.Modal, key: 'modal', view: '' });
  });
  on('modal.open', ({ title = 'Modal', body = '' }) => {
    open = true;
    emit('render.view.set', {
      place: Places.Modal,
      key: 'modal',
      view: () => {
        const modal = contexts.templates.clone('modal');
        contexts.templates.text(modal, 'title', title);
        appendRenderable(contexts.templates.slot(modal, 'body'), body);
        return modal;
      },
    });
    queueMicrotask(() => (contexts.places.el(Places.Modal)?.querySelector('[autofocus]') as HTMLElement | null)?.focus());
  });
});

system('palette', ({ on, emit, contexts }) => {
  const visibleCommands = (query = '') => {
    const q = query.trim().toLowerCase();
    return contexts.commands.all()
      .filter(command => !command.hidden)
      .filter(command => !q || `${command.id} ${command.label} ${command.group ?? ''} ${shortcutOf(command)}`.toLowerCase().includes(q));
  };
  const commandSection = (group: string, commands: CommandSpec[]) => {
    const section = contexts.templates.clone('command-section');
    const rows = contexts.templates.slot(section, 'rows');
    contexts.templates.text(section, 'group', group);
    commands.forEach(command => {
      const row = contexts.templates.clone<HTMLButtonElement>('command-row');
      const shortcut = shortcutOf(command);
      row.dataset.command = command.id;
      contexts.templates.text(row, 'label', command.label);
      contexts.templates.text(row, 'id', command.id);
      if (shortcut) contexts.templates.text(row, 'shortcut', shortcut);
      else row.querySelector('kbd')?.remove();
      rows.append(row);
    });
    return section;
  };
  const renderList = (query = '') => {
    const fragment = document.createDocumentFragment();
    grouped(visibleCommands(query), command => command.group ?? systemOf(command.id))
      .forEach(([group, commands]) => fragment.append(commandSection(group, commands)));
    return fragment;
  };
  const renderPalette = () => {
    const palette = contexts.templates.clone('palette');
    contexts.templates.slot(palette, 'commands').append(renderList());
    return palette;
  };
  contexts.commands.register({ id: 'palette.open', label: 'Open palette', event: 'palette.open', group: 'palette', shortcut: 'P', input: { on: 'keydown', key: 'p', prevent: true } });
  on('palette.open', () => emit('modal.open', {
    title: 'Palette',
    body: renderPalette,
  }));
  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('palette-search')) return;
    const list = target.closest('.palette')?.querySelector('[data-slot="commands"]');
    if (list) list.replaceChildren(renderList(target.value));
  });
});

system('help', ({ on, emit, contexts }) => {
  const renderHelp = () => {
    const help = contexts.templates.clone('help');
    const list = contexts.templates.slot(help, 'systems');
    const sections = grouped(contexts.commands.all().filter(command => !command.hidden), command => command.group ?? systemOf(command.id));
    sections.forEach(([group, commands]) => {
      const section = contexts.templates.clone('command-section');
      const rows = contexts.templates.slot(section, 'rows');
      contexts.templates.text(section, 'group', group);
      commands.forEach(command => {
        const row = contexts.templates.clone('help-row');
        const input = row.querySelector('input');
        contexts.templates.text(row, 'label', command.label);
        contexts.templates.text(row, 'id', command.id);
        if (input) {
          input.dataset.shortcutCommand = command.id;
          input.value = shortcutOf(command);
          input.setAttribute('aria-label', `${command.label} shortcut`);
        }
        rows.append(row);
      });
      list.append(section);
    });
    return help;
  };
  contexts.commands.register({ id: 'help.open', label: 'Open help', event: 'help.open', group: 'help', shortcut: '?', input: { on: 'keydown', key: '?', prevent: true } });
  on('help.open', () => emit('modal.open', { title: 'Help', body: renderHelp }));
  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('shortcut-edit')) return;
    contexts.commands.setShortcut(target.dataset.shortcutCommand!, target.value);
  });
});

system('editing', ({ contexts }) => {
  let count = 1;
  contexts.commands.register({
    id: 'editing.node.create',
    label: 'Create node',
    event: 'editing.node.create',
    group: 'editing',
    shortcut: 'A',
    input: { on: 'keydown', key: 'a', prevent: true },
    payload: () => ({ Label: { text: `Node ${count++}` } }),
  });
});

system('data', ({ on, emit, world }) => {
  on('data.node.create', draft => {
    const id = world.createNode(draft);
    emit('data.node.created', { id });
  });
  on('data.node.update', ({ id, patch }) => {
    if (world.updateNode(id, patch)) emit('data.node.updated', { id });
  });
});

system('layout', ({ on, emit, contexts, world }) => {
  on('layout.node.center', ({ id }) => {
    const n = world.nodes().length;
    const center = contexts.view.spaceCenter(Places.Stage);
    emit('data.node.update', { id, patch: { Position: { x: center.x + (n % 4) * 24, y: center.y + (n % 3) * 18 } } });
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

system('selection', ({ on, emit, world, contexts }) => {
  contexts.commands.register({
    id: 'selection.node.select',
    label: 'Select node',
    event: 'selection.node.select',
    group: 'selection',
    hidden: true,
    input: { on: 'pointerdown', selector: '[data-node-id]', prevent: true },
    payload: ({ target }) => ({ id: (target as HTMLElement).dataset.nodeId! }),
  });
  contexts.commands.register({
    id: 'selection.node.clear',
    label: 'Clear selection',
    event: 'selection.node.clear',
    group: 'selection',
    input: { on: 'pointerdown', selector: `[data-place="${Places.Stage}"]`, when: isStageSurface },
  });
  on('selection.node.select', ({ id }) => { world.selected = id; emit('selection.node.selected', { id }); });
  on('selection.node.clear', () => { world.selected = null; emit('selection.node.selected', { id: null }); });
});

system('focus', ({ on, emit, world }) => {
  on('focus.node.focus', ({ id }) => { world.focused = id; emit('focus.node.focused', { id }); });
  on('focus.node.clear', () => { world.focused = null; emit('focus.node.focused', { id: null }); });
});

system('drag', ({ on, emit, world, contexts }) => {
  let drag: { id: Id; pointer: Position; start: Position } | null = null;
  contexts.commands.register({
    id: 'drag.node.start',
    label: 'Start drag',
    event: 'drag.node.start',
    group: 'drag',
    hidden: true,
    input: { on: 'pointerdown', selector: '[data-node-id]', prevent: true },
    payload: ({ event, target }) => ({ id: (target as HTMLElement).dataset.nodeId!, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
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
    const node = world.node(id);
    if (node?.Position) drag = { id, pointer: contexts.view.clientToSpace(Places.Stage, { x, y }), start: { ...node.Position } };
  });
  on('drag.node.move', ({ x, y }) => {
    if (!drag) return;
    const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
    emit('data.node.update', { id: drag.id, patch: { Position: { x: drag.start.x + pointer.x - drag.pointer.x, y: drag.start.y + pointer.y - drag.pointer.y } } });
    emit('drag.node.moved', { id: drag.id });
  });
  on('drag.node.end', () => { drag = null; });
});

feature('nodeLifecycle', ({ on, emit }) => {
  on('editing.node.create', draft => emit('data.node.create', draft));
  on('data.node.created', ({ id }) => {
    emit('layout.node.center', { id });
    emit('selection.node.select', { id });
    emit('focus.node.focus', { id });
  });
  on('data.node.updated', () => emit('render.nodes.draw'));
  on('selection.node.selected', () => emit('render.nodes.draw'));
  on('focus.node.focused', () => emit('render.nodes.draw'));
});

window.addEventListener('DOMContentLoaded', () => {
  const ctx = createAppContext();
  systems.start(ctx);
  features.start(ctx, () => ctx.bus.emit('app.start'));
  window.v2 = ctx;
});

export {};
