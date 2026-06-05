type Id = string;
type Html = string;
type Renderable = string | globalThis.Node | (() => string | globalThis.Node);
type RawInput = 'click' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup';

const Places = { Top: 'top', Left: 'left', Stage: 'stage', Modal: 'modal' } as const;
type Place = typeof Places[keyof typeof Places];

type Position = { x: number; y: number };
type Size = { w: number; h: number };
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
  'modal.open': { title?: string; body?: Html };
  'modal.close': void;
  'palette.open': void;
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
  prevent?: boolean;
  stop?: boolean;
  when?: (event: Event, target: Element) => boolean;
};
type CommandSpec<K extends EventName = EventName> = {
  id: string;
  label: string;
  event: K;
  input?: CommandInput;
  palette?: boolean;
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

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]!);

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

  const commands = {
    register: (command: CommandSpec) => commandMap.set(command.id, command),
    get: (id: string) => commandMap.get(id),
    all: () => [...commandMap.values()],
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
        if (event instanceof KeyboardEvent && /input|textarea|select/i.test(rawTarget?.tagName ?? '')) return;

        const button = event.type === 'click' ? rawTarget?.closest('[data-command]') : null;
        if (button instanceof HTMLElement) {
          event.preventDefault();
          commands.run(button.dataset.command!, { event, target: button });
          return;
        }

        for (const command of commands.all()) {
          const binding = command.input;
          if (!binding || binding.on !== event.type) continue;
          if (binding.key && (!(event instanceof KeyboardEvent) || event.key.toLowerCase() !== binding.key.toLowerCase())) continue;
          const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
          if (!(target instanceof Element) || (binding.selector && !target)) continue;
          if (binding.when && !binding.when(event, target)) continue;
          if (binding.prevent) event.preventDefault();
          commands.run(command.id, { event, target });
          if (binding.stop) break;
        }
      };
      (['click', 'keydown', 'pointerdown', 'pointermove', 'pointerup'] as RawInput[]).forEach(type => root.addEventListener(type, route));
    },
  };

  const placeContext = {
    set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
    el: (place: Place) => places.get(place) ?? null,
    center(place: Place): Position {
      const rect = places.get(place)?.getBoundingClientRect();
      return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
    },
  };

  return { commands, input, places: placeContext };
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
  const append = (slot: HTMLElement, view: Renderable) => {
    const value = typeof view === 'function' ? view() : view;
    if (typeof value === 'string') slot.insertAdjacentHTML('beforeend', value);
    else slot.append(value);
  };
  const flush = (place: Place) => {
    const slot = contexts.places.el(place), parts = views.get(place);
    if (!slot || !parts) return;
    slot.replaceChildren();
    [...parts.values()].forEach(view => append(slot, view));
  };
  const drawNodes = () => emit('render.view.set', {
    place: Places.Stage,
    key: 'nodes',
    view: () => `<div class="nodes">${world.nodes().map(node => {
      const pos = node.Position ?? { x: 0, y: 0 };
      const focusClass = world.focused === node.id ? ' focused' : '';
      return `<article class="node ${world.selected === node.id ? 'selected' : ''}${focusClass}" data-node-id="${node.id}"
        style="left:${pos.x}px;top:${pos.y}px;width:${node.Size.w}px;height:${node.Size.h}px">
        <div class="node-title">${esc(node.Label.text)}</div>
        <div class="node-meta">${esc(node.id)}</div>
      </article>`;
    }).join('')}</div>`,
  });

  on('render.shell', () => {
    root.innerHTML = `<section class="shell">
      <header class="top" data-place="${Places.Top}"></header>
      <aside class="left" data-place="${Places.Left}"></aside>
      <main class="stage" data-place="${Places.Stage}"></main>
      <div class="modal-slot" data-place="${Places.Modal}"></div>
    </section>`;
    Object.values(Places).forEach(place => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
    Object.values(Places).forEach(flush);
  });
  on('render.view.set', ({ place, key = 'default', view }) => {
    (views.get(place) || views.set(place, new Map()).get(place)!).set(key, view);
    flush(place);
  });
  on('render.view.clear', ({ place, key }) => { key ? views.get(place)?.delete(key) : views.delete(place); flush(place); });
  on('render.nodes.draw', drawNodes);
});

system('input', ({ on, contexts }) => {
  on('app.start', () => contexts.input.start());
});

system('main', ({ on, emit }) => {
  on('app.start', () => {
    emit('render.shell');
    emit('render.view.set', {
      place: Places.Top,
      key: 'toolbar',
      view: `<span class="brand">ECS Graph v2</span>
        <button data-command="editing.node.create">+ Node</button>
        <button data-command="palette.open">Palette</button>
        <button data-command="modal.open" data-title="Modal" data-body="Ready.">Modal</button>`,
    });
  });
});

system('log', ({ bus, emit }) => {
  const rows: string[] = [];
  bus.onAny(event => {
    if (event.name.startsWith('render.')) return;
    rows.unshift(event.name);
    rows.length = Math.min(rows.length, 12);
    emit('render.view.set', {
      place: Places.Left,
      key: 'log',
      view: `<h2 class="panel-title">Event log</h2><div class="log">${rows.map(row => `<div class="log-row">${esc(row)}</div>`).join('')}</div>`,
    });
  });
});

system('modal', ({ on, emit, contexts }) => {
  let open = false;
  contexts.commands.register({
    id: 'modal.open',
    label: 'Open modal',
    event: 'modal.open',
    palette: true,
    payload: ({ target }) => ({ title: (target as HTMLElement)?.dataset.title, body: (target as HTMLElement)?.dataset.body }),
  });
  contexts.commands.register({ id: 'modal.close', label: 'Close modal', event: 'modal.close', palette: true, input: { on: 'keydown', key: 'Escape', when: () => open, prevent: true } });

  on('modal.close', () => {
    open = false;
    emit('render.view.set', { place: Places.Modal, key: 'modal', view: '' });
  });
  on('modal.open', ({ title = 'Modal', body = '' }) => {
    open = true;
    emit('render.view.set', {
      place: Places.Modal,
      key: 'modal',
      view: `<div class="modal-slot open">
        <div class="backdrop" data-command="modal.close"></div>
        <section class="modal">
          <div class="modal-head"><span>${esc(title)}</span><button data-command="modal.close">Close</button></div>
          <div class="modal-body">${body}</div>
        </section>
      </div>`,
    });
  });
});

system('palette', ({ on, emit, contexts }) => {
  contexts.commands.register({ id: 'palette.open', label: 'Open palette', event: 'palette.open', input: { on: 'keydown', key: 'p', prevent: true } });
  on('palette.open', () => emit('modal.open', {
    title: 'Palette',
    body: contexts.commands.all().filter(command => command.palette).map(command =>
      `<div class="palette-row"><span>${esc(command.label)}</span><button data-command="${esc(command.id)}">Run</button></div>`
    ).join(''),
  }));
});

system('editing', ({ contexts }) => {
  let count = 1;
  contexts.commands.register({
    id: 'editing.node.create',
    label: 'Create node',
    event: 'editing.node.create',
    palette: true,
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
    const center = contexts.places.center(Places.Stage);
    emit('data.node.update', { id, patch: { Position: { x: center.x + (n % 4) * 24, y: center.y + (n % 3) * 18 } } });
  });
});

system('selection', ({ on, emit, world, contexts }) => {
  contexts.commands.register({
    id: 'selection.node.select',
    label: 'Select node',
    event: 'selection.node.select',
    input: { on: 'pointerdown', selector: '[data-node-id]', prevent: true },
    payload: ({ target }) => ({ id: (target as HTMLElement).dataset.nodeId! }),
  });
  contexts.commands.register({
    id: 'selection.node.clear',
    label: 'Clear selection',
    event: 'selection.node.clear',
    input: { on: 'pointerdown', selector: `[data-place="${Places.Stage}"]`, when: (event, stage) => event.target === stage || (event.target as Element).classList.contains('nodes') },
  });
  on('selection.node.select', ({ id }) => { world.selected = id; emit('selection.node.selected', { id }); });
  on('selection.node.clear', () => { world.selected = null; emit('selection.node.selected', { id: null }); });
});

system('focus', ({ on, emit, world }) => {
  on('focus.node.focus', ({ id }) => { world.focused = id; emit('focus.node.focused', { id }); });
  on('focus.node.clear', () => { world.focused = null; emit('focus.node.focused', { id: null }); });
});

system('drag', ({ on, emit, world, contexts }) => {
  let drag: { id: Id; x: number; y: number; start: Position } | null = null;
  contexts.commands.register({
    id: 'drag.node.start',
    label: 'Start drag',
    event: 'drag.node.start',
    input: { on: 'pointerdown', selector: '[data-node-id]', prevent: true },
    payload: ({ event, target }) => ({ id: (target as HTMLElement).dataset.nodeId!, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
  });
  contexts.commands.register({
    id: 'drag.node.move',
    label: 'Move dragged node',
    event: 'drag.node.move',
    input: { on: 'pointermove', when: () => !!drag, prevent: true },
    payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
  });
  contexts.commands.register({ id: 'drag.node.end', label: 'End drag', event: 'drag.node.end', input: { on: 'pointerup', when: () => !!drag } });

  on('drag.node.start', ({ id, x, y }) => {
    const node = world.node(id);
    if (node?.Position) drag = { id, x, y, start: { ...node.Position } };
  });
  on('drag.node.move', ({ x, y }) => {
    if (!drag) return;
    emit('data.node.update', { id: drag.id, patch: { Position: { x: drag.start.x + x - drag.x, y: drag.start.y + y - drag.y } } });
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
