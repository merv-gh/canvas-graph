const Places = Object.freeze({
  Top: 'top',
  Left: 'left',
  Stage: 'stage',
  Modal: 'modal',
});

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

function eventBus() {
  const listeners = new Map(), any = [];
  return {
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); },
    onAny(fn) { any.push(fn); },
    emit(name, data = {}) {
      const event = { name, data, at: performance.now() };
      any.forEach(fn => fn(event));
      (listeners.get(name) || []).forEach(fn => fn(data, event));
    },
  };
}

function worldStore() {
  let next = 1;
  const entities = new Map();
  return {
    state: { selected: null },
    create(type, components) {
      const id = `e${next++}`;
      entities.set(id, { id, type, ...components });
      return id;
    },
    get: id => entities.get(id),
    patch(id, patch) { Object.assign(entities.get(id), patch); },
    all: type => [...entities.values()].filter(entity => !type || entity.type === type),
  };
}

function renderSystem(ctx) {
  const root = document.getElementById('app');
  const slots = {};
  const views = new Map();

  const flush = place => {
    const slot = slots[place], parts = views.get(place);
    if (slot && parts) slot.innerHTML = [...parts.values()].map(view => typeof view === 'function' ? view() : view).join('');
  };

  ctx.bus.on('render.shell', () => {
    root.innerHTML = `
      <section class="shell">
        <header class="top" data-place="${Places.Top}"></header>
        <aside class="left" data-place="${Places.Left}"></aside>
        <main class="stage" data-place="${Places.Stage}"></main>
        <div class="modal-slot" data-place="${Places.Modal}"></div>
      </section>`;
    Object.values(Places).forEach(place => { slots[place] = root.querySelector(`[data-place="${place}"]`); });
    Object.values(Places).forEach(flush);
  });
  ctx.bus.on('render.set', ({ place, key = 'default', view }) => {
    if (!views.has(place)) views.set(place, new Map());
    views.get(place).set(key, view);
    flush(place);
  });
  ctx.bus.on('render.clear', ({ place, key }) => {
    if (key) views.get(place)?.delete(key);
    else views.delete(place);
    flush(place);
  });

  ctx.dom = { place: name => slots[name], rect: name => slots[name]?.getBoundingClientRect() };
}

function inputSystem(ctx) {
  const bindings = [];
  const input = {
    bind(binding) { bindings.push(binding); },
    start(root = document) {
      ['click', 'keydown', 'pointerdown', 'pointermove', 'pointerup'].forEach(type =>
        root.addEventListener(type, event => route(type, event)));
    },
  };
  const route = (type, event) => {
    if (type === 'keydown' && /input|textarea|select/i.test(event.target.tagName)) return;
    for (const binding of bindings) {
      if (binding.on !== type) continue;
      if (binding.key && event.key.toLowerCase() !== binding.key.toLowerCase()) continue;
      const target = binding.selector ? event.target.closest(binding.selector) : event.target;
      if (binding.selector && !target) continue;
      if (binding.when && !binding.when(event, target)) continue;
      if (binding.prevent) event.preventDefault();
      ctx.bus.emit(
        typeof binding.emit === 'function' ? binding.emit(event, target) : binding.emit,
        binding.map ? binding.map(event, target) : {},
      );
      if (binding.stop) break;
    }
  };

  input.bind({
    on: 'click',
    selector: '[data-emit]',
    emit: (_, el) => el.dataset.emit,
    map: (_, el) => Object.fromEntries(Object.entries(el.dataset).filter(([key]) => key !== 'emit')),
  });
  ctx.input = input;
}

function mainSystem({ bus }) {
  bus.on('app.start', () => {
    bus.emit('render.shell');
    bus.emit('render.set', {
      place: Places.Top,
      key: 'toolbar',
      view: `
        <span class="brand">ECS Graph v2</span>
        <button data-emit="node.create">+ Node</button>
        <button data-emit="palette.open">Palette</button>
        <button data-emit="modal.open" data-title="Modal" data-body="Ready.">Modal</button>`,
    });
    bus.emit('render.set', { place: Places.Stage, key: 'base', view: '<div class="nodes" data-layer="nodes"></div>' });
  });
}

function logSystem({ bus }) {
  const rows = [];
  bus.onAny(event => {
    if (event.name.startsWith('render.')) return;
    rows.unshift(event.name);
    rows.length = Math.min(rows.length, 12);
    bus.emit('render.set', {
      place: Places.Left,
      key: 'log',
      view: `<h2 class="panel-title">Event log</h2><div class="log">${rows.map(row => `<div class="log-row">${esc(row)}</div>`).join('')}</div>`,
    });
  });
}

function modalSystem({ bus, input }) {
  let open = false;
  const close = () => {
    open = false;
    bus.emit('render.set', { place: Places.Modal, key: 'modal', view: '' });
  };
  input.bind({ on: 'keydown', key: 'Escape', emit: 'modal.close', when: () => open, prevent: true });
  bus.on('modal.close', close);
  bus.on('modal.open', ({ title = 'Modal', body = '' }) => {
    open = true;
    bus.emit('render.set', {
      place: Places.Modal,
      key: 'modal',
      view: `
        <div class="modal-slot open">
          <div class="backdrop" data-emit="modal.close"></div>
          <section class="modal">
            <div class="modal-head"><span>${esc(title)}</span><button data-emit="modal.close">Close</button></div>
            <div class="modal-body">${body}</div>
          </section>
        </div>`,
    });
  });
}

function paletteSystem({ bus, input }) {
  input.bind({ on: 'keydown', key: 'p', emit: 'palette.open', prevent: true });
  bus.on('palette.open', () => bus.emit('modal.open', {
    title: 'Palette',
    body: `
      <div class="palette-row"><span>Create node</span><button data-emit="node.create">Run</button></div>
      <div class="palette-row"><span>Close modal</span><button data-emit="modal.close">Run</button></div>`,
  }));
}

function editingSystem({ bus, world, input, dom }) {
  let count = 1;
  input.bind({ on: 'keydown', key: 'a', emit: 'node.create', prevent: true });
  bus.on('node.create', () => {
    const rect = dom.rect(Places.Stage) || { width: innerWidth, height: innerHeight };
    const id = world.create('node', {
      Label: { text: `Node ${count++}` },
      Position: { x: rect.width / 2 + (count % 4) * 24, y: rect.height / 2 + (count % 3) * 18 },
      Size: { w: 150, h: 64 },
      Selectable: true,
      Draggable: true,
    });
    bus.emit('node.created', { id });
    bus.emit('node.select', { id });
  });
}

function selectionSystem({ bus, world, input }) {
  input.bind({
    on: 'pointerdown',
    selector: '[data-node-id]',
    emit: 'node.select',
    map: (_, el) => ({ id: el.dataset.nodeId }),
    prevent: true,
  });
  input.bind({
    on: 'pointerdown',
    selector: `[data-place="${Places.Stage}"]`,
    emit: 'node.clearSelection',
    when: (event, stage) => event.target === stage || event.target.classList.contains('nodes'),
  });
  bus.on('node.select', ({ id }) => {
    world.state.selected = id;
    bus.emit('node.selected', { id });
  });
  bus.on('node.clearSelection', () => {
    world.state.selected = null;
    bus.emit('node.selected', { id: null });
  });
}

function dragSystem({ bus, world, input }) {
  let drag = null;
  input.bind({
    on: 'pointerdown',
    selector: '[data-node-id]',
    emit: 'node.drag.start',
    map: (event, el) => ({ id: el.dataset.nodeId, x: event.clientX, y: event.clientY }),
    prevent: true,
  });
  input.bind({ on: 'pointermove', emit: 'node.drag.move', when: () => !!drag, map: event => ({ x: event.clientX, y: event.clientY }), prevent: true });
  input.bind({ on: 'pointerup', emit: 'node.drag.end', when: () => !!drag });
  bus.on('node.drag.start', ({ id, x, y }) => {
    const node = world.get(id);
    if (!node?.Draggable) return;
    drag = { id, x, y, start: { ...node.Position } };
  });
  bus.on('node.drag.move', ({ x, y }) => {
    if (!drag) return;
    world.patch(drag.id, { Position: { x: drag.start.x + x - drag.x, y: drag.start.y + y - drag.y } });
    bus.emit('node.moved', { id: drag.id });
  });
  bus.on('node.drag.end', () => { drag = null; });
}

function nodeRenderSystem({ bus, world }) {
  const draw = () => bus.emit('render.set', {
    place: Places.Stage,
    key: 'nodes',
    view: `<div class="nodes">${world.all('node').map(node => `
      <article class="node ${world.state.selected === node.id ? 'selected' : ''}" data-node-id="${node.id}"
        style="left:${node.Position.x}px;top:${node.Position.y}px;width:${node.Size.w}px;height:${node.Size.h}px">
        <div class="node-title">${esc(node.Label.text)}</div>
        <div class="node-meta">${esc(node.id)}</div>
      </article>`).join('')}</div>`,
  });
  ['app.start', 'node.created', 'node.selected', 'node.moved'].forEach(name => bus.on(name, draw));
}

function start() {
  const ctx = { bus: eventBus(), world: worldStore(), input: null, dom: null };
  renderSystem(ctx);
  inputSystem(ctx);
  [
    mainSystem,
    logSystem,
    modalSystem,
    paletteSystem,
    editingSystem,
    selectionSystem,
    dragSystem,
    nodeRenderSystem,
  ].forEach(system => system(ctx));
  ctx.input.start();
  window.v2 = ctx;
  ctx.bus.emit('app.start');
}

window.addEventListener('DOMContentLoaded', start);
