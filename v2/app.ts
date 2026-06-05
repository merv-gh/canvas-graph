type Id = string;
type Html = string;
type View = Html | (() => Html);
type RawInput = 'click' | 'keydown' | 'pointerdown' | 'pointermove' | 'pointerup';

const Places = { Top: 'top', Left: 'left', Stage: 'stage', Modal: 'modal' } as const;
type Place = typeof Places[keyof typeof Places];

type Position = { x: number; y: number };
type Size = { w: number; h: number };
type Label = { text: string };
type NodeDraft = { Label?: Label; Position?: Position; Size?: Size; Selectable?: boolean; Draggable?: boolean };
type NodeEntity = NodeDraft & { id: Id; kind: 'node'; Label: Label };

type AppEvents = {
  'app.start': void;
  'view.shell': void;
  'view.set': { place: Place; key?: string; view: View };
  'view.clear': { place: Place; key?: string };
  'modal.open': { title?: string; body?: Html };
  'modal.close': void;
  'palette.open': void;
  'node.create': NodeDraft;
  'node.created': { id: Id };
  'node.changed': { id: Id };
  'node.select': { id: Id };
  'node.clearSelection': void;
  'node.selected': { id: Id | null };
  'node.drag.start': { id: Id; x: number; y: number };
  'node.drag.move': { x: number; y: number };
  'node.drag.end': void;
  'node.moved': { id: Id };
};
type EventName = keyof AppEvents;
type EventOf<K extends EventName = EventName> = { name: K; data: AppEvents[K]; at: number };
type AnyEvent = { [K in EventName]: EventOf<K> }[EventName];
type Bus = {
  on<K extends EventName>(name: K, fn: (data: AppEvents[K], event: EventOf<K>) => void): void;
  onAny(fn: (event: AnyEvent) => void): void;
  emit<K extends EventName>(name: K, ...data: AppEvents[K] extends void ? [] : [AppEvents[K]]): void;
};

type InputBinding = {
  on: RawInput;
  key?: string;
  selector?: string;
  prevent?: boolean;
  stop?: boolean;
  emit: EventName | ((event: Event, target: Element) => EventName);
  map?: (event: Event, target: Element) => unknown;
  when?: (event: Event, target: Element) => boolean;
};

type World = ReturnType<typeof worldStore>;
type Contexts = ReturnType<typeof createContexts>;
type AppCtx = { bus: Bus; world: World; contexts: Contexts };
type AppSystem = (ctx: AppCtx) => void;
type Systems = ((name: string, setup: AppSystem) => void) & {
  start(ctx: AppCtx, then?: () => void): void;
  names(): string[];
};

declare global { interface Window { v2?: AppCtx } }

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]!);

function eventBus(): Bus {
  const listeners = new Map<EventName, Function[]>(), any: ((event: AnyEvent) => void)[] = [];
  return {
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)!).push(fn); },
    onAny(fn) { any.push(fn); },
    emit(name, ...args) {
      const event = { name, data: args[0], at: performance.now() } as AnyEvent;
      any.forEach(fn => fn(event));
      (listeners.get(name) || []).forEach(fn => fn(event.data, event));
    },
  };
}

function worldStore() {
  let next = 1, selected: Id | null = null;
  const nodes = new Map<Id, NodeEntity>();
  return {
    get selected() { return selected; },
    set selected(id: Id | null) { selected = id; },
    createNode(draft: NodeDraft = {}) {
      const id = `e${next++}`;
      nodes.set(id, { id, kind: 'node', ...draft, Label: draft.Label ?? { text: id } });
      return id;
    },
    node: (id: Id) => nodes.get(id),
    nodes: () => [...nodes.values()],
    patchNode(id: Id, patch: Partial<Omit<NodeEntity, 'id' | 'kind'>>) {
      Object.assign(nodes.get(id) ?? {}, patch);
    },
  };
}

function createContexts(bus: Bus) {
  const bindings: InputBinding[] = [];
  const places = new Map<Place, HTMLElement>();
  return {
    input: {
      bind: (binding: InputBinding) => bindings.push(binding),
      start(root: Document | HTMLElement = document) {
        const route = (event: Event) => {
          if (event instanceof KeyboardEvent && /input|textarea|select/i.test((event.target as Element)?.tagName ?? '')) return;
          for (const binding of bindings) {
            if (binding.on !== event.type) continue;
            if (binding.key && (!(event instanceof KeyboardEvent) || event.key.toLowerCase() !== binding.key.toLowerCase())) continue;
            const target = event.target instanceof Element && binding.selector ? event.target.closest(binding.selector) : event.target;
            if (!(target instanceof Element) || (binding.selector && !target)) continue;
            if (binding.when && !binding.when(event, target)) continue;
            if (binding.prevent) event.preventDefault();
            const name = typeof binding.emit === 'function' ? binding.emit(event, target) : binding.emit;
            (bus.emit as (name: EventName, data?: unknown) => void)(name, binding.map?.(event, target));
            if (binding.stop) break;
          }
        };
        (['click', 'keydown', 'pointerdown', 'pointermove', 'pointerup'] as RawInput[]).forEach(type => root.addEventListener(type, route));
      },
    },
    places: {
      set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
      el: (place: Place) => places.get(place) ?? null,
      rect: (place: Place) => places.get(place)?.getBoundingClientRect(),
      center(place: Place): Position {
        const rect = places.get(place)?.getBoundingClientRect();
        return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
      },
    },
  };
}

function systemRegistry(): Systems {
  const entries: { name: string; setup: AppSystem }[] = [];
  const register = ((name: string, setup: AppSystem) => { entries.push({ name, setup }); }) as Systems;
  register.start = (ctx, then) => { entries.forEach(entry => entry.setup(ctx)); then?.(); };
  register.names = () => entries.map(entry => entry.name);
  return register;
}

function createAppContext(): AppCtx {
  const bus = eventBus();
  return { bus, world: worldStore(), contexts: createContexts(bus) };
}

const systems = systemRegistry();
const system = systems;

system('render', ({ bus, world, contexts }) => {
  const root = document.getElementById('app')!;
  const views = new Map<Place, Map<string, View>>();
  const flush = (place: Place) => {
    const slot = contexts.places.el(place), parts = views.get(place);
    if (slot && parts) slot.innerHTML = [...parts.values()].map(view => typeof view === 'function' ? view() : view).join('');
  };
  const drawNodes = () => bus.emit('view.set', {
    place: Places.Stage,
    key: 'nodes',
    view: () => `<div class="nodes">${world.nodes().map(node => `
      <article class="node ${world.selected === node.id ? 'selected' : ''}" data-node-id="${node.id}"
        style="left:${node.Position?.x}px;top:${node.Position?.y}px;width:${node.Size?.w}px;height:${node.Size?.h}px">
        <div class="node-title">${esc(node.Label.text)}</div>
        <div class="node-meta">${esc(node.id)}</div>
      </article>`).join('')}</div>`,
  });

  bus.on('view.shell', () => {
    root.innerHTML = `<section class="shell">
      <header class="top" data-place="${Places.Top}"></header>
      <aside class="left" data-place="${Places.Left}"></aside>
      <main class="stage" data-place="${Places.Stage}"></main>
      <div class="modal-slot" data-place="${Places.Modal}"></div>
    </section>`;
    Object.values(Places).forEach(place => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
    Object.values(Places).forEach(flush);
  });
  bus.on('view.set', ({ place, key = 'default', view }) => {
    (views.get(place) || views.set(place, new Map()).get(place)!).set(key, view);
    flush(place);
  });
  bus.on('view.clear', ({ place, key }) => { key ? views.get(place)?.delete(key) : views.delete(place); flush(place); });
  bus.on('node.created', ({ id }) => {
    const node = world.node(id);
    if (!node) return;
    const n = world.nodes().length, center = contexts.places.center(Places.Stage);
    world.patchNode(id, {
      Position: node.Position ?? { x: center.x + (n % 4) * 24, y: center.y + (n % 3) * 18 },
      Size: node.Size ?? { w: 150, h: 64 },
    });
    bus.emit('node.changed', { id });
    drawNodes();
  });
  ['app.start', 'node.changed', 'node.selected', 'node.moved'].forEach(name => bus.on(name as EventName, drawNodes));
});

system('input', ({ bus, contexts }) => {
  contexts.input.bind({
    on: 'click',
    selector: '[data-emit]',
    emit: (_, el) => el.getAttribute('data-emit') as EventName,
    map: (_, el) => Object.fromEntries(Object.entries((el as HTMLElement).dataset).filter(([key]) => key !== 'emit')),
  });
  bus.on('app.start', () => contexts.input.start());
});

system('main', ({ bus }) => {
  bus.on('app.start', () => {
    bus.emit('view.shell');
    bus.emit('view.set', {
      place: Places.Top,
      key: 'toolbar',
      view: `<span class="brand">ECS Graph v2</span>
        <button data-emit="node.create">+ Node</button>
        <button data-emit="palette.open">Palette</button>
        <button data-emit="modal.open" data-title="Modal" data-body="Ready.">Modal</button>`,
    });
  });
});

system('log', ({ bus }) => {
  const rows: string[] = [];
  bus.onAny(event => {
    if (event.name.startsWith('view.')) return;
    rows.unshift(event.name);
    rows.length = Math.min(rows.length, 12);
    bus.emit('view.set', {
      place: Places.Left,
      key: 'log',
      view: `<h2 class="panel-title">Event log</h2><div class="log">${rows.map(row => `<div class="log-row">${esc(row)}</div>`).join('')}</div>`,
    });
  });
});

system('modal', ({ bus, contexts }) => {
  let open = false;
  const close = () => { open = false; bus.emit('view.set', { place: Places.Modal, key: 'modal', view: '' }); };
  contexts.input.bind({ on: 'keydown', key: 'Escape', emit: 'modal.close', when: () => open, prevent: true });
  bus.on('modal.close', close);
  bus.on('modal.open', ({ title = 'Modal', body = '' }) => {
    open = true;
    bus.emit('view.set', {
      place: Places.Modal,
      key: 'modal',
      view: `<div class="modal-slot open">
        <div class="backdrop" data-emit="modal.close"></div>
        <section class="modal">
          <div class="modal-head"><span>${esc(title)}</span><button data-emit="modal.close">Close</button></div>
          <div class="modal-body">${body}</div>
        </section>
      </div>`,
    });
  });
});

system('palette', ({ bus, contexts }) => {
  contexts.input.bind({ on: 'keydown', key: 'p', emit: 'palette.open', prevent: true });
  bus.on('palette.open', () => bus.emit('modal.open', {
    title: 'Palette',
    body: `<div class="palette-row"><span>Create node</span><button data-emit="node.create">Run</button></div>
      <div class="palette-row"><span>Close modal</span><button data-emit="modal.close">Run</button></div>`,
  }));
});

system('editing', ({ bus, contexts }) => {
  let count = 1;
  contexts.input.bind({ on: 'keydown', key: 'a', emit: 'node.create', map: () => ({ Label: { text: `Node ${count++}` } }), prevent: true });
  bus.on('node.create', draft => { if (!draft.Label) draft.Label = { text: `Node ${count++}` }; });
});

system('graph', ({ bus, world }) => {
  bus.on('node.create', draft => {
    const id = world.createNode({ Selectable: true, Draggable: true, ...draft });
    bus.emit('node.created', { id });
    bus.emit('node.select', { id });
  });
});

system('selection', ({ bus, world, contexts }) => {
  contexts.input.bind({
    on: 'pointerdown',
    selector: '[data-node-id]',
    emit: 'node.select',
    map: (_, el) => ({ id: (el as HTMLElement).dataset.nodeId! }),
    prevent: true,
  });
  contexts.input.bind({
    on: 'pointerdown',
    selector: `[data-place="${Places.Stage}"]`,
    emit: 'node.clearSelection',
    when: (event, stage) => event.target === stage || (event.target as Element).classList.contains('nodes'),
  });
  bus.on('node.select', ({ id }) => { world.selected = id; bus.emit('node.selected', { id }); });
  bus.on('node.clearSelection', () => { world.selected = null; bus.emit('node.selected', { id: null }); });
});

system('drag', ({ bus, world, contexts }) => {
  let drag: { id: Id; x: number; y: number; start: Position } | null = null;
  contexts.input.bind({
    on: 'pointerdown',
    selector: '[data-node-id]',
    emit: 'node.drag.start',
    map: (event, el) => ({ id: (el as HTMLElement).dataset.nodeId!, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
    prevent: true,
  });
  contexts.input.bind({ on: 'pointermove', emit: 'node.drag.move', when: () => !!drag, map: event => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }), prevent: true });
  contexts.input.bind({ on: 'pointerup', emit: 'node.drag.end', when: () => !!drag });
  bus.on('node.drag.start', ({ id, x, y }) => {
    const node = world.node(id);
    if (node?.Draggable && node.Position) drag = { id, x, y, start: { ...node.Position } };
  });
  bus.on('node.drag.move', ({ x, y }) => {
    if (!drag) return;
    world.patchNode(drag.id, { Position: { x: drag.start.x + x - drag.x, y: drag.start.y + y - drag.y } });
    bus.emit('node.moved', { id: drag.id });
  });
  bus.on('node.drag.end', () => { drag = null; });
});

window.addEventListener('DOMContentLoaded', () => {
  const ctx = createAppContext();
  systems.start(ctx, () => ctx.bus.emit('app.start'));
  window.v2 = ctx;
});

export {};
