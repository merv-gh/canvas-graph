/* ============================================================
   1. SCHEDULER
   ============================================================ */
let rafId = null;
function scheduleRender() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => { rafId = null; render(); });
}

/* ============================================================
   2. CONTEXT
   ============================================================ */
const Context = {
  selectedId: null,
  mode: 'normal',           // normal | connecting | palette
  camera: { x: 0, y: 0, zoom: 1, layerZ: 0 },
  history: [],
  lastVisited: null,
  connectSource: null,
  drag: { active: false, id: null, sx: 0, sy: 0, moved: false },
  mouse: { x: innerWidth/2, y: innerHeight/2 },
  lastEvents: [],
  demoSpeed: 1,
  layoutMode: 'radial', // radial | vertical | horizontal | grid
  theme: document.documentElement.dataset.theme || 'default',
};
const LAYOUTS = ['radial','vertical','horizontal','grid'];
const THEMES = [
  { id: 'default', label: 'Default' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'blueprint', label: 'Blueprint' },
];

/* ============================================================
   3. TOAST (coalesces streams, suppresses noise)
   ============================================================ */
const activeStreams = new Set();
const TOAST_SUPPRESS = new Set(['compAdded','entityRemoved','worldCleared']);
function logToast(name, data) {
  if (typeof toastEnabled !== 'undefined' && !toastEnabled) return;
  if (TOAST_SUPPRESS.has(name)) return;
  if (name === 'camera-pan' || name === 'node-drag') {
    if (activeStreams.has(name)) return;
    activeStreams.add(name);
    name += ' (start)';
  }
  if (name === 'camera-pan-end' || name === 'node-drag-end') {
    activeStreams.delete(name.replace('-end',''));
  }
  const payload = data ? JSON.stringify(data).slice(0, 80) : '';
  const entry = `<span class="t">${performance.now().toFixed(0)}</span><span class="n">${name}</span> <span class="m">${Context.mode}${payload ? ' • ' + payload : ''}</span>`;
  Context.lastEvents.unshift(entry);
  if (Context.lastEvents.length > 7) Context.lastEvents.pop();
  document.getElementById('toast').innerHTML = Context.lastEvents.map(h => `<div class="toast-item">${h}</div>`).join('');
}

/* ============================================================
   4. EVENT BUS
   ============================================================ */
class EventBus {
  constructor() { this.l = {}; }
  on(e, cb) { (this.l[e] = this.l[e] || []).push(cb); return () => this.off(e, cb); }
  off(e, cb) { if (this.l[e]) this.l[e] = this.l[e].filter(f => f !== cb); }
  emit(e, d) {
    (this.l[e] || []).forEach(cb => cb(d || {}));
    window.__ecsCaseHarness?.recordEvent?.(e, d);
    logToast(e, d);
    scheduleRender();
  }
}
const bus = new EventBus();

/* ============================================================
   5. ECS
   ============================================================ */
const world = {
  e: new Map(), c: {}, id: 1,
  create() { const i = this.id++; this.e.set(i, new Set()); return i; },
  add(i, t, d) { (this.c[t] = this.c[t] || new Map()).set(i, d); this.e.get(i).add(t); bus.emit('compAdded', { i, t }); },
  get(i, t) { return this.c[t]?.get(i); },
  has(i, t) { return this.e.get(i)?.has(t); },
  remove(i) { this.e.get(i)?.forEach(t => this.c[t]?.delete(i)); this.e.delete(i); bus.emit('entityRemoved', { i }); },
  q(ts) { const r = []; for (const [i, cs] of this.e) if (ts.every(t => cs.has(t))) r.push(i); return r; },
  clear() {
    for (const [i] of this.e) {
      const n = this.c.Node?.get(i); if (n?.domEl) n.domEl.remove();
    }
    this.e.clear(); this.c = {}; this.id = 1;
    bus.emit('worldCleared');
  }
};

/* ============================================================
   6. CANVAS & PROJECTION
   ============================================================ */
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const uiLayer = document.getElementById('ui-layer');

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
window.addEventListener('resize', () => { resize(); scheduleRender(); });
resize();

function persp(z) { return 1000 / (1000 - z); }
function worldToScreen(x, y, z) {
  const c = Context.camera, s = c.zoom * persp(z);
  return { x: (x - c.x) * s + canvas.width / 2, y: (y - c.y) * s + canvas.height / 2, scale: s };
}
function screenToWorld(sx, sy, z = Context.camera.layerZ) {
  const c = Context.camera, s = c.zoom * persp(z);
  return { x: (sx - canvas.width / 2) / s + c.x, y: (sy - canvas.height / 2) / s + c.y, z };
}

/* ============================================================
   7. SHORTCUTS
   ============================================================ */
const SHORTCUTS = [
  { event: 'keydown', key: 'a', mode: 'normal', repeat: false, emit: 'cmd-add-node' },
  { event: 'keydown', key: 'A', modifiers: ['shift'], mode: 'normal', repeat: false, emit: 'cmd-add-sibling' },
  { event: 'keydown', key: 'x', mode: 'normal', repeat: false, emit: 'cmd-delete' },
  { event: 'keydown', key: 'Delete', mode: 'normal', repeat: false, emit: 'cmd-delete' },
  { event: 'keydown', key: 'e', mode: 'normal', repeat: false, emit: 'cmd-edit' },
  { event: 'keydown', key: 'c', mode: 'normal', repeat: false, emit: 'cmd-connect-start' },
  { event: 'keydown', key: ' ', mode: 'normal', repeat: false, emit: 'cmd-collapse' },
  { event: 'keydown', key: 'l', mode: 'normal', repeat: false, emit: 'cmd-layout' },
  { event: 'keydown', key: 'L', modifiers: ['shift'], mode: 'normal', repeat: false, emit: 'cmd-layout-cycle' },
  { event: 'keydown', key: 'f', mode: 'normal', repeat: false, emit: 'cmd-fit-view' },
  { event: 'keydown', key: 'F', modifiers: ['shift'], mode: 'normal', repeat: false, emit: 'cmd-fit-parent' },
  { event: 'keydown', key: 'j', mode: 'normal', repeat: false, emit: 'cmd-jump' },
  { event: 'keydown', key: '1', mode: 'normal', repeat: false, emit: 'cmd-layer', payload: { z: 0 } },
  { event: 'keydown', key: '2', mode: 'normal', repeat: false, emit: 'cmd-layer', payload: { z: -300 } },
  { event: 'keydown', key: '3', mode: 'normal', repeat: false, emit: 'cmd-layer', payload: { z: -600 } },
  { event: 'keydown', key: 'Escape', mode: 'normal', emit: 'cmd-deselect' },
  { event: 'keydown', key: 'z', modifiers: ['alt'], mode: 'normal', repeat: false, emit: 'cmd-history-back' },
  { event: 'keydown', key: 'p', mode: 'normal', repeat: false, emit: 'cmd-palette-open' },
  { event: 'keydown', key: 'Escape', mode: 'connecting', emit: 'cmd-connect-cancel' },
  { event: 'keydown', key: '/', mode: 'connecting', emit: 'cmd-connect-pick' },
  { event: 'keydown', key: 'Tab', mode: 'connecting', emit: 'cmd-connect-pick' },
  { event: 'keydown', key: 'Escape', mode: 'palette', emit: 'cmd-palette-close' },

  { event: 'keydown', key: 'ArrowLeft', emit: 'pan-left' },
  { event: 'keydown', key: 'ArrowRight', emit: 'pan-right' },
  { event: 'keydown', key: 'ArrowUp', emit: 'pan-up' },
  { event: 'keydown', key: 'ArrowDown', emit: 'pan-down' },
  { event: 'keydown', key: '+', emit: 'zoom-in' },
  { event: 'keydown', key: '=', emit: 'zoom-in' },
  { event: 'keydown', key: '-', emit: 'zoom-out' },

  { event: 'wheel', deltaY: '<0', emit: 'zoom-in' },
  { event: 'wheel', deltaY: '>0', emit: 'zoom-out' },

  { event: 'dblclick', target: 'node', emit: 'cmd-edit' },
];

class DomainEventRouter {
  constructor(map) { this.map = map; }
  match(raw) {
    for (const sc of this.map) {
      if (sc.event && sc.event !== raw.type) continue;
      if (sc.key && sc.key !== raw.key) continue;
      if (sc.target && sc.target !== raw.target) continue;
      if (sc.mode && sc.mode !== Context.mode) continue;
      if (sc.repeat === false && raw.repeat) continue;
      if (sc.deltaY) {
        if (sc.deltaY === '>0' && !(raw.deltaY > 0)) continue;
        if (sc.deltaY === '<0' && !(raw.deltaY < 0)) continue;
      }
      if (sc.modifiers) {
        let ok = true;
        for (const m of sc.modifiers) {
          if (m === 'ctrl' && !raw.ctrl) ok = false;
          if (m === 'shift' && !raw.shift) ok = false;
          if (m === 'alt' && !raw.alt) ok = false;
          if (m === 'meta' && !raw.meta) ok = false;
        }
        if (!ok) continue;
      }
      bus.emit(sc.emit, { ...(sc.payload || {}), eid: raw.eid });
      return true;
    }
    return false;
  }
}
const router = new DomainEventRouter(SHORTCUTS);

/* ============================================================
   8. INPUT CONTROLLER
   ============================================================ */
class InputController {
  constructor() {
    this.stream = null;
    window.addEventListener('keydown', e => this._key(e));
    window.addEventListener('wheel', e => this._wheel(e), { passive: true });
    window.addEventListener('mousedown', e => this._md(e));
    window.addEventListener('mousemove', e => this._mm(e));
    window.addEventListener('mouseup', e => this._mu(e));
    window.addEventListener('dblclick', e => this._dbl(e));
  }
  _tgt(e) {
    if (e.target.closest('.node')) return 'node';
    if (e.target.closest('.modal')) return 'modal';
    if (e.target.closest('#dock')) return 'dock';
    return 'background';
  }
  _key(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Jump-mode swallows everything: buffer chars, match hint, select.
    if (Context.mode === 'jump') { handleJumpKey(e); return; }
    // In connect mode, any printable char opens the picker prefilled with that char
    // — makes keyboard-only "connect to X" discoverable.
    if (Context.mode === 'connecting' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      bus.emit('cmd-connect-pick');
      const ch = e.key;
      setTimeout(() => { paletteInput.value = ch; paletteSel = 0; renderPalette(ch); }, 0);
      return;
    }
    const matched = router.match({ type: 'keydown', key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, repeat: e.repeat });
    if (matched) { e.preventDefault(); e.stopPropagation(); }
  }
  _wheel(e) {
    if (e.target.closest('.modal')) return;
    router.match({ type: 'wheel', deltaY: e.deltaY > 0 ? '>0' : '<0' });
  }
  _md(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const t = this._tgt(e);
    Context.drag = { active: true, id: null, sx: e.clientX, sy: e.clientY, moved: false };
    if (t === 'node') {
      const el = e.target.closest('.node');
      const eid = parseInt(el.dataset.eid);
      const wasSelected = Context.selectedId === eid;
      const onTitle = !!e.target.closest('.title');
      const isContainer = el.classList.contains('is-container');
      // Container header click → collapse subtree (don't enter edit, don't drag).
      if (isContainer && Context.mode === 'normal' && onTitle) {
        Context.drag.active = false;
        bus.emit('node-select', { eid });
        bus.emit('cmd-collapse', { eid });
        e.stopPropagation();
        return;
      }
      // Single-click rename: clicking title of already-selected leaf enters edit.
      if (wasSelected && onTitle && Context.mode === 'normal' && !isContainer) {
        Context.drag.active = false;
        bus.emit('cmd-edit', { eid });
        e.stopPropagation();
        return;
      }
      bus.emit('node-select', { eid });
      Context.drag.id = eid;
      e.stopPropagation();
    }
  }
  _mm(e) {
    Context.mouse.x = e.clientX;
    Context.mouse.y = e.clientY;
    if (Context.mode === 'connecting') { scheduleRender(); return; }
    if (!Context.drag.active) return;
    const dx = e.movementX, dy = e.movementY;
    Context.drag.moved = Context.drag.moved || Math.hypot(e.clientX - Context.drag.sx, e.clientY - Context.drag.sy) > 4;
    if (!Context.drag.moved) return;
    if (!this.stream) this.stream = Context.drag.id !== null ? 'node-drag' : 'camera-pan';
    bus.emit(this.stream, { eid: Context.drag.id, dx, dy });
  }
  _mu(e) {
    if (this.stream) { bus.emit(this.stream + '-end'); this.stream = null; }
    if (!Context.drag.active) { return; }
    const wasClick = !Context.drag.moved;
    Context.drag.active = false;
    if (!wasClick) return;
    const t = this._tgt(e);
    if (t === 'node') {
      const eid = parseInt(e.target.closest('.node').dataset.eid);
      if (Context.mode === 'connecting') {
        if (eid !== Context.connectSource) bus.emit('cmd-connect-finish', { from: Context.connectSource, to: eid });
        else bus.emit('cmd-connect-cancel');
      } else {
        const n = world.get(eid, 'Node');
        if (n && n.collapsed) bus.emit('cmd-collapse', { eid });
      }
    } else if (t === 'background') {
      if (Context.mode === 'connecting') {
        // Connect-to creates a new node and links from source
        const w = screenToWorld(e.clientX, e.clientY, Context.camera.layerZ);
        bus.emit('cmd-add-node', { at: [w.x, w.y, w.z], title: 'Node', connectFrom: Context.connectSource });
      } else {
        bus.emit('bg-click');
      }
    }
  }
  _dbl(e) {
    if (e.target.closest('.node')) {
      const eid = parseInt(e.target.closest('.node').dataset.eid);
      router.match({ type: 'dblclick', target: 'node', eid });
    }
  }
}
new InputController();

/* ============================================================
   9. PALETTE COMMANDS (data-driven, editable)
   ============================================================ */
let PALETTE_COMMANDS = [
  // `context`: which selection types this action is most relevant for.
  //   'node'   — applies to a selected node
  //   'edge'   — applies to a selected edge
  //   'none'   — useful when nothing is selected (e.g., create-at-cursor)
  //   'always' — global action, never context-specific
  { label: 'Add Child Node', shortcut: 'A', emit: 'cmd-add-node', context: ['node','none'] },
  { label: 'Add Sibling', shortcut: '⇧A', emit: 'cmd-add-sibling', context: ['node'] },
  { label: 'Edit Title / Label', shortcut: 'E', emit: 'cmd-edit', context: ['node','edge'] },
  { label: 'Delete', shortcut: 'X', emit: 'cmd-delete', context: ['node','edge'] },
  { label: 'Connect From Selected', shortcut: 'C', emit: 'cmd-connect-start', context: ['node'] },
  { label: 'Collapse / Expand', shortcut: 'Space', emit: 'cmd-collapse', context: ['node'] },
  { label: 'Fit View', shortcut: 'F', emit: 'cmd-fit-view', context: ['node','edge','none'] },
  { label: 'Fit View → Parent', shortcut: '⇧F', emit: 'cmd-fit-parent', context: ['node'] },
  { label: 'Jump to…', shortcut: 'J', emit: 'cmd-jump', context: ['always'] },
  { label: 'Auto Layout Tree', shortcut: 'L', emit: 'cmd-layout', context: ['node','none'] },
  { label: 'Cycle Layout Mode', shortcut: '⇧L', emit: 'cmd-layout-cycle', context: ['always'] },
  { label: 'Layer: Front', shortcut: '1', emit: 'cmd-layer', payload: { z: 0 }, context: ['always'] },
  { label: 'Layer: Mid', shortcut: '2', emit: 'cmd-layer', payload: { z: -300 }, context: ['always'] },
  { label: 'Layer: Back', shortcut: '3', emit: 'cmd-layer', payload: { z: -600 }, context: ['always'] },
  { label: 'Deselect', shortcut: 'Esc', emit: 'cmd-deselect', context: ['node','edge'] },
  { label: 'History Back', shortcut: 'Alt+Z', emit: 'cmd-history-back', context: ['always'] },
  { label: 'Run Demo', shortcut: '', emit: 'cmd-demo-start', context: ['always'] },
  { label: 'Cycle Theme', shortcut: '', emit: 'cmd-theme-cycle', context: ['always'] },
  { label: 'Toggle Case Recording', shortcut: '', emit: 'cmd-case-record-toggle', context: ['always'] },
  { label: 'Export Case to Clipboard', shortcut: '', emit: 'cmd-case-export', context: ['always'] },
  { label: 'Reset Canvas', shortcut: '', emit: 'cmd-reset', context: ['always'] },
  { label: 'Edit Palette…', shortcut: '', emit: 'cmd-edit-palette', context: ['always'] },
];
function paletteSortedFor(items) {
  const sel = Context.selectedId;
  const kind = sel == null ? 'none' : (world.has(sel, 'Edge') ? 'edge' : 'node');
  const score = (c) => {
    const ctx = c.context || ['always'];
    if (ctx.includes(kind)) return 0;       // context match
    if (ctx.includes('always')) return 1;   // global
    return 2;                               // not applicable
  };
  return items.map((c, i) => ({ c, i, s: score(c) }))
              .sort((a, b) => a.s - b.s || a.i - b.i)
              .map(o => o.c);
}

const palette = document.getElementById('palette');
const paletteInput = document.getElementById('palette-input');
const paletteList = document.getElementById('palette-list');
let paletteSource = null;  // null => use PALETTE_COMMANDS; else fn returning array
let paletteSel = 0;
function openPalette(source = null, placeholder = 'Type a command…') {
  paletteSource = source;
  paletteSel = 0;
  Context.mode = 'palette';
  palette.classList.remove('hidden');
  paletteInput.placeholder = placeholder;
  paletteInput.value = ''; paletteInput.focus();
  renderPalette();
}
function closePalette() {
  const wasPicking = !!paletteSource;
  paletteSource = null;
  palette.classList.add('hidden');
  Context.mode = 'normal';
  if (wasPicking && Context.connectSource) { Context.connectSource = null; }
  scheduleRender();
}
function currentPaletteItems(filter = '') {
  const src = paletteSource ? paletteSource() : paletteSortedFor(PALETTE_COMMANDS);
  const f = filter.toLowerCase();
  return src.filter(c => c.label.toLowerCase().includes(f));
}
function renderPalette(filter = '') {
  const cmds = currentPaletteItems(filter);
  if (paletteSel >= cmds.length) paletteSel = 0;
  paletteList.innerHTML = cmds.map((c, i) => `
    <div class="item ${i === paletteSel ? 'sel' : ''}" data-idx="${i}">
      <span><span style="color:var(--text-mute);font-family:monospace;font-size:10px;margin-right:6px;">${i < 9 ? '⌥'+(i+1) : '  '}</span>${c.label}</span>
      <span class="shortcut">${c.shortcut || ''}</span>
    </div>`).join('');
  paletteList.querySelectorAll('.item').forEach(el => {
    el.addEventListener('click', () => {
      const c = cmds[parseInt(el.dataset.idx)];
      closePalette(); bus.emit(c.emit, c.payload);
    });
  });
}
palette.addEventListener('mousedown', e => e.stopPropagation());
paletteInput.addEventListener('input', e => { paletteSel = 0; renderPalette(e.target.value); });
paletteInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { bus.emit('cmd-palette-close'); return; }
  const cmds = currentPaletteItems(paletteInput.value);
  if (e.key === 'ArrowDown') { paletteSel = Math.min(cmds.length - 1, paletteSel + 1); renderPalette(paletteInput.value); e.preventDefault(); return; }
  if (e.key === 'ArrowUp') { paletteSel = Math.max(0, paletteSel - 1); renderPalette(paletteInput.value); e.preventDefault(); return; }
  if (e.key === 'Enter') {
    const c = cmds[paletteSel]; if (c) { closePalette(); bus.emit(c.emit, c.payload); }
    e.preventDefault(); return;
  }
  // Alt+1..9 quick pick
  if (e.altKey && e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key) - 1;
    const c = cmds[i]; if (c) { closePalette(); bus.emit(c.emit, c.payload); }
    e.preventDefault();
  }
});

/* Palette editor modal — row-list with search + arrow nav + Alt+1..9 quick-edit. */
const editor = document.getElementById('editor');
const editorSearch = document.getElementById('editor-search');
const editorList = document.getElementById('editor-list');
let editorSel = 0;
const escHtml = s => (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function visibleEditorItems() {
  const f = editorSearch.value.toLowerCase();
  return PALETTE_COMMANDS.map((c, idx) => ({ c, idx }))
    .filter(o => !f || o.c.label.toLowerCase().includes(f) || (o.c.emit || '').toLowerCase().includes(f));
}
function renderEditor() {
  const items = visibleEditorItems();
  if (editorSel >= items.length) editorSel = Math.max(0, items.length - 1);
  editorList.innerHTML = items.map((o, i) => `
    <div class="row ${i === editorSel ? 'sel' : ''}" data-idx="${o.idx}" data-vis="${i}">
      <span class="num">${i < 9 ? '⌥' + (i + 1) : ''}</span>
      <input class="ed f-label" value="${escHtml(o.c.label)}" placeholder="label">
      <input class="ed f-sc" value="${escHtml(o.c.shortcut || '')}" placeholder="shortcut">
      <input class="ed f-emit mono" value="${escHtml(o.c.emit || '')}" placeholder="cmd-event-name">
      <button class="del" title="delete">×</button>
    </div>`).join('');
  editorList.querySelectorAll('.row').forEach(row => {
    const idx = parseInt(row.dataset.idx);
    const vis = parseInt(row.dataset.vis);
    row.querySelector('.f-label').addEventListener('input', e => PALETTE_COMMANDS[idx].label = e.target.value);
    row.querySelector('.f-sc').addEventListener('input', e => PALETTE_COMMANDS[idx].shortcut = e.target.value);
    row.querySelector('.f-emit').addEventListener('input', e => PALETTE_COMMANDS[idx].emit = e.target.value.trim());
    row.querySelector('.del').addEventListener('click', () => {
      PALETTE_COMMANDS.splice(idx, 1); renderEditor();
    });
    row.addEventListener('mousedown', () => { editorSel = vis; renderEditor(); });
  });
}
function openEditor() {
  closePalette();
  editorSel = 0; editorSearch.value = '';
  editor.classList.remove('hidden');
  editorSearch.focus();
  renderEditor();
}
document.getElementById('btn-edit-palette').addEventListener('click', () => bus.emit('cmd-edit-palette'));
document.getElementById('editor-close').addEventListener('click', () => editor.classList.add('hidden'));
document.getElementById('editor-add').addEventListener('click', () => {
  PALETTE_COMMANDS.push({ label: 'New command', shortcut: '', emit: 'cmd-new' });
  editorSearch.value = ''; editorSel = visibleEditorItems().length - 1; renderEditor();
  setTimeout(() => editorList.querySelector('.row.sel .f-label')?.focus(), 0);
});
document.getElementById('editor-del').addEventListener('click', () => {
  const items = visibleEditorItems();
  const target = items[editorSel];
  if (target) { PALETTE_COMMANDS.splice(target.idx, 1); renderEditor(); }
});
editorSearch.addEventListener('input', () => { editorSel = 0; renderEditor(); });
editorSearch.addEventListener('keydown', e => {
  const items = visibleEditorItems();
  if (e.key === 'Escape') { editor.classList.add('hidden'); return; }
  if (e.key === 'ArrowDown') { editorSel = Math.min(items.length - 1, editorSel + 1); renderEditor(); e.preventDefault(); return; }
  if (e.key === 'ArrowUp') { editorSel = Math.max(0, editorSel - 1); renderEditor(); e.preventDefault(); return; }
  if (e.key === 'Enter') {
    const row = editorList.querySelector('.row.sel');
    row?.querySelector('.f-label')?.focus(); e.preventDefault(); return;
  }
  if (e.altKey && e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key) - 1;
    if (i < items.length) {
      editorSel = i; renderEditor();
      editorList.querySelector('.row.sel .f-label')?.focus();
    }
    e.preventDefault();
  }
});
editor.addEventListener('mousedown', e => e.stopPropagation());

/* ============================================================
   10. DOMAIN HANDLERS
   ============================================================ */
bus.on('node-select', ({ eid }) => {
  if (Context.mode === 'connecting') return;
  if (Context.selectedId && Context.selectedId !== eid) {
    Context.lastVisited = Context.selectedId;
    Context.history.unshift(Context.selectedId);
    if (Context.history.length > 20) Context.history.pop();
  }
  Context.selectedId = eid;
});
bus.on('bg-click', () => {
  if (Context.mode === 'palette') { bus.emit('cmd-palette-close'); return; }
  if (Context.mode === 'connecting') { bus.emit('cmd-connect-cancel'); return; }
  bus.emit('cmd-deselect');
});
bus.on('cmd-deselect', () => { Context.selectedId = null; });
bus.on('cmd-history-back', () => { if (Context.history.length) Context.selectedId = Context.history.shift(); });

bus.on('cmd-add-node', (d = {}) => {
  let parent = d.parent !== undefined ? d.parent : Context.selectedId;
  if (parent != null && !world.has(parent, 'Node')) parent = null; // edge selected → no parent
  const pt = parent != null ? world.get(parent, 'Transform') : null;
  let [wx, wy, wz] = d.at || (pt ? [pt.x, pt.y + 100, pt.z] : (() => {
    const w = screenToWorld(Context.mouse.x, Context.mouse.y, Context.camera.layerZ);
    return [w.x, w.y, w.z];
  })());
  const eid = createNode(wx, wy, wz, d.title || nextChildName(parent), d.body || '', parent);
  Context.selectedId = eid;
  if (d.connectFrom !== undefined && d.connectFrom !== null) {
    createEdge(d.connectFrom, eid, '');
    Context.mode = 'normal'; Context.connectSource = null;
  }
  // Auto-space: re-lay out the affected parent's subtree so the new child doesn't overlap.
  // Skip when caller supplied an explicit position (demo scripts, fuzzy-create at click point).
  if (parent != null && !d.at) applyLayout(Context.layoutMode, parent);
});
bus.on('cmd-delete', ({ eid } = {}) => {
  const t = eid || Context.selectedId;
  if (!t) return;
  if (world.has(t, 'Edge')) { world.remove(t); Context.selectedId = null; return; }
  if (world.has(t, 'Node')) { deleteTree(t); Context.selectedId = null; }
});
bus.on('cmd-edit', ({ eid } = {}) => {
  const target = eid || Context.selectedId; if (!target) return;
  if (world.has(target, 'Edge')) { openEdgeLabelEditor(target); return; }
  const n = world.get(target, 'Node'); if (!n) return;
  const te = n.domEl.querySelector('.title');
  if (te.querySelector('input')) return;
  const inp = document.createElement('input');
  inp.value = n.title; te.innerHTML = ''; te.appendChild(inp); inp.focus(); inp.select();
  const save = () => { n.title = inp.value; te.innerHTML = n.title; scheduleRender(); };
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.value = n.title; inp.blur(); }
    e.stopPropagation();
  });
});
function openEdgeLabelEditor(eid) {
  const ed = world.get(eid, 'Edge'); if (!ed) return;
  const t1 = world.get(ed.from, 'Transform'), t2 = world.get(ed.to, 'Transform');
  if (!t1 || !t2) return;
  const s1 = worldToScreen(t1.x, t1.y, t1.z), s2 = worldToScreen(t2.x, t2.y, t2.z);
  const inp = document.createElement('input');
  inp.className = 'edge-label-edit';
  inp.style.left = ((s1.x + s2.x) / 2) + 'px';
  inp.style.top  = ((s1.y + s2.y) / 2 - 8) + 'px';
  inp.value = ed.label || '';
  inp.placeholder = '(label)';
  document.body.appendChild(inp);
  inp.focus(); inp.select();
  const finish = (save) => { if (save) ed.label = inp.value; inp.remove(); scheduleRender(); };
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { finish(false); }
    e.stopPropagation();
  });
}
bus.on('cmd-connect-start', () => {
  if (Context.selectedId && world.has(Context.selectedId, 'Node')) {
    Context.mode = 'connecting'; Context.connectSource = Context.selectedId;
  }
});
bus.on('cmd-connect-finish', ({ from, to }) => {
  createEdge(from, to, ''); Context.mode = 'normal'; Context.connectSource = null;
});
bus.on('cmd-connect-cancel', () => { Context.mode = 'normal'; Context.connectSource = null; });
bus.on('cmd-connect-pick', () => {
  const from = Context.connectSource; if (!from) return;
  openPalette(() => world.q(['Node']).filter(id => id !== from).map(id => {
    const n = world.get(id, 'Node');
    return { label: `#${id} · ${n.title}` + (n.body ? ` — ${n.body.slice(0,30)}` : ''),
             shortcut: '', emit: 'cmd-connect-finish', payload: { from, to: id } };
  }), 'Pick target node…');
});
bus.on('cmd-collapse', ({ eid } = {}) => {
  const t = eid || Context.selectedId;
  if (!t) return;
  const n = world.get(t, 'Node'); if (n) n.collapsed = !n.collapsed;
});
bus.on('cmd-layer', ({ z }) => { Context.camera.layerZ = z; });
bus.on('cmd-layout', () => applyLayout(Context.layoutMode));
bus.on('cmd-layout-cycle', () => {
  const i = LAYOUTS.indexOf(Context.layoutMode);
  Context.layoutMode = LAYOUTS[(i + 1) % LAYOUTS.length];
  bus.emit('layout-mode-changed', { mode: Context.layoutMode });
  applyLayout(Context.layoutMode);
});
bus.on('cmd-add-sibling', () => {
  const sel = Context.selectedId;
  if (!sel || !world.has(sel, 'Node')) { bus.emit('cmd-add-node'); return; }
  const n = world.get(sel, 'Node');
  // If sel has parent: create sibling (child of sel.parentId). If sel is root: create child of sel.
  const parent = n.parentId || sel;
  const pt = world.get(parent, 'Transform');
  createNode(pt.x, pt.y + 100, pt.z, nextChildName(parent), '', parent);
  applyLayout(Context.layoutMode, parent);
  // Selection unchanged — spam Shift+A to keep adding siblings.
});
/* Layout engine: tidy-tree width allocation so siblings don't overlap. */
function subtreeWidth(id, unit) {
  const n = world.get(id, 'Node');
  if (!n || n.collapsed || !n.children.length) return unit;
  return n.children.reduce((s, c) => s + subtreeWidth(c, unit), 0);
}
function applyLayout(mode, rootId = null) {
  const selNode = Context.selectedId && world.has(Context.selectedId, 'Node') ? Context.selectedId : null;
  const root = rootId || selNode || world.q(['Node']).find(id => !world.get(id, 'Node').parentId);
  if (!root) return;
  // Mark all nodes for one smooth-transition frame so layout animates rather than snapping.
  world.q(['Node']).forEach(id => { const n = world.get(id, 'Node'); n.domEl?.classList.add('smooth'); });
  setTimeout(() => world.q(['Node']).forEach(id => world.get(id, 'Node').domEl?.classList.remove('smooth')), 420);

  const rt = world.get(root, 'Transform');
  const z = rootId && rt ? rt.z : Context.camera.layerZ;
  const lay = (id, x, y, depth, aStart, aSpread) => {
    const t = world.get(id, 'Transform'), n = world.get(id, 'Node');
    if (!t || !n) return;
    t.x = x; t.y = y; t.z = z;
    if (n.collapsed || !n.children.length) return;
    const cs = n.children;
    if (mode === 'radial') {
      const r = 200 + depth * 50, step = aSpread / Math.max(1, cs.length);
      cs.forEach((cid, i) => {
        const a = aStart - aSpread / 2 + step * (i + 0.5);
        lay(cid, x + Math.cos(a) * r, y + Math.sin(a) * r, depth + 1, a, Math.PI / (1 + depth * 0.6));
      });
    } else if (mode === 'vertical' || mode === 'horizontal') {
      const unit = mode === 'vertical' ? 200 : 110;
      const cross = mode === 'vertical' ? 180 : 280;
      const total = cs.reduce((s, c) => s + subtreeWidth(c, unit), 0);
      let cursor = -total / 2;
      cs.forEach(cid => {
        const w = subtreeWidth(cid, unit);
        const center = cursor + w / 2;
        if (mode === 'vertical') lay(cid, x + center, y + cross, depth + 1);
        else lay(cid, x + cross, y + center, depth + 1);
        cursor += w;
      });
    } else if (mode === 'grid') {
      const cols = Math.max(1, Math.ceil(Math.sqrt(cs.length)));
      const cw = 200, ch = 140;
      cs.forEach((cid, i) => {
        const gx = (i % cols) - (cols - 1) / 2;
        const gy = Math.floor(i / cols) + 1;
        lay(cid, x + gx * cw, y + gy * ch, depth + 1);
      });
    }
  };
  const ax = rootId && rt ? rt.x : 0;
  const ay = rootId && rt ? rt.y : (mode === 'vertical' ? -200 : 0);
  lay(root, ax, ay, 0, -Math.PI / 2, Math.PI * 1.6);
}
bus.on('cmd-palette-open', () => openPalette());
bus.on('cmd-palette-close', () => closePalette());
bus.on('cmd-edit-palette', () => openEditor());
bus.on('cmd-reset', () => { world.clear(); Context.selectedId = null; Context.history = []; Context.camera = { x:0,y:0,zoom:1,layerZ:0 }; });

/* ============================================================
   Fit-view: center camera on selected node + its visible subtree.
   ============================================================ */
function fitView(target) {
  if (target == null) {
    target = world.q(['Node']).find(id => !world.get(id, 'Node').parentId);
    if (target == null) return;
  }
  let bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  if (world.has(target, 'Edge')) {
    const ed = world.get(target, 'Edge');
    const t1 = world.get(ed.from, 'Transform'), t2 = world.get(ed.to, 'Transform');
    if (!t1 || !t2) return;
    bbox.minX = Math.min(t1.x, t2.x) - 80; bbox.maxX = Math.max(t1.x, t2.x) + 80;
    bbox.minY = Math.min(t1.y, t2.y) - 60; bbox.maxY = Math.max(t1.y, t2.y) + 60;
  } else {
    const ids = [target];
    const collect = (id) => {
      const n = world.get(id, 'Node');
      if (n && !n.collapsed) n.children.forEach(c => { ids.push(c); collect(c); });
    };
    collect(target);
    for (const id of ids) {
      const t = world.get(id, 'Transform'), n = world.get(id, 'Node');
      if (!t || !n) continue;
      const w = (n.domEl.offsetWidth || 200) / 2;
      const h = (n.domEl.offsetHeight || 70) / 2;
      bbox.minX = Math.min(bbox.minX, t.x - w);
      bbox.maxX = Math.max(bbox.maxX, t.x + w);
      bbox.minY = Math.min(bbox.minY, t.y - h);
      bbox.maxY = Math.max(bbox.maxY, t.y + h);
    }
  }
  if (!isFinite(bbox.minX)) return;
  const padding = 120;
  const w = (bbox.maxX - bbox.minX) + padding * 2;
  const h = (bbox.maxY - bbox.minY) + padding * 2;
  Context.camera.zoom = Math.min(canvas.width / w, canvas.height / h, 2.0);
  Context.camera.x = (bbox.minX + bbox.maxX) / 2;
  Context.camera.y = (bbox.minY + bbox.maxY) / 2;
  scheduleRender();
}
bus.on('cmd-fit-view', () => fitView(Context.selectedId));
bus.on('cmd-fit-parent', () => {
  const sel = Context.selectedId;
  if (sel == null) { fitView(null); return; }
  if (world.has(sel, 'Edge')) { fitView(sel); return; }
  const n = world.get(sel, 'Node');
  fitView(n && n.parentId != null ? n.parentId : sel);
});

/* ============================================================
   Label-jump nav: press J → hint chips → type to select.
   Hints derived from word-first-letters; collisions resolved by digit suffix.
   ============================================================ */
let jumpHints = new Map();        // hint string → eid
let jumpBuffer = '';
function generateHint(title, used) {
  const t = (title || 'node').trim();
  const words = t.split(/[\s\-_./]+/).filter(Boolean);
  let base = words.length > 1
    ? words.map(w => w[0].toLowerCase()).slice(0, 4).join('')
    : (words[0] || 'n').slice(0, 2).toLowerCase();
  if (!base) base = 'n';
  let h = base, i = 1;
  while (used.has(h)) h = base + i++;
  used.add(h);
  return h;
}
function buildJumpHints() {
  jumpHints = new Map();
  const used = new Set();
  for (const id of world.q(['Node'])) {
    if (!isVisible(id)) continue;
    const n = world.get(id, 'Node');
    jumpHints.set(generateHint(n.title, used), id);
  }
  // Edges with non-empty labels and visible endpoints (skip container-implied parent→child).
  for (const id of world.q(['Edge'])) {
    const ed = world.get(id, 'Edge');
    if (!ed.label) continue;
    if (!isVisible(ed.from) || !isVisible(ed.to)) continue;
    const src = world.get(ed.from, 'Node');
    if (src && !src.collapsed && src.children.includes(ed.to)) continue;
    jumpHints.set(generateHint(ed.label, used), id);
  }
}
function hintPosition(eid) {
  if (world.has(eid, 'Node')) {
    const n = world.get(eid, 'Node');
    const r = n.domEl.getBoundingClientRect();
    return { x: r.left - 4, y: r.top + r.height/2 };
  }
  if (world.has(eid, 'Edge')) {
    const ed = world.get(eid, 'Edge');
    const t1 = world.get(ed.from, 'Transform'), t2 = world.get(ed.to, 'Transform');
    if (!t1 || !t2) return null;
    const s1 = worldToScreen(t1.x, t1.y, t1.z), s2 = worldToScreen(t2.x, t2.y, t2.z);
    return { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 - 12 };
  }
  return null;
}
function renderJumpHints() {
  const jl = document.getElementById('jump-layer');
  if (Context.mode !== 'jump') { jl.innerHTML = ''; return; }
  const html = [];
  for (const [hint, eid] of jumpHints) {
    if (jumpBuffer && !hint.startsWith(jumpBuffer)) continue;
    const pos = hintPosition(eid); if (!pos) continue;
    const typed = hint.slice(0, jumpBuffer.length);
    const rest = hint.slice(jumpBuffer.length);
    const cls = (jumpBuffer && hint.startsWith(jumpBuffer) ? 'jump-hint match' : 'jump-hint')
              + (world.has(eid, 'Edge') ? ' edge' : '');
    html.push(`<div class="${cls}" style="left:${pos.x}px;top:${pos.y}px;"><span class="typed">${typed}</span>${rest}</div>`);
  }
  jl.innerHTML = html.join('');
}
bus.on('cmd-jump', () => {
  if (!world.q(['Node']).length) return;
  Context.mode = 'jump';
  jumpBuffer = '';
  buildJumpHints();
  renderJumpHints();
});
bus.on('cmd-jump-cancel', () => {
  Context.mode = 'normal'; jumpBuffer = ''; jumpHints = new Map();
  renderJumpHints();
  scheduleRender();
});
function handleJumpKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); bus.emit('cmd-jump-cancel'); return; }
  if (e.key === 'Backspace') { e.preventDefault(); jumpBuffer = jumpBuffer.slice(0, -1); renderJumpHints(); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();
  const next = jumpBuffer + e.key.toLowerCase();
  if (jumpHints.has(next)) {
    const eid = jumpHints.get(next);
    bus.emit('node-select', { eid });
    bus.emit('cmd-jump-cancel');
    bus.emit('cmd-fit-view');
    return;
  }
  // Any hint still possible with this prefix?
  const stillPossible = [...jumpHints.keys()].some(h => h.startsWith(next));
  jumpBuffer = stillPossible ? next : '';
  renderJumpHints();
}
bus.on('cmd-demo-start', () => runDemo());
bus.on('cmd-demo-stop', () => stopDemo());

bus.on('node-drag', ({ eid, dx, dy }) => {
  const t = world.get(eid, 'Transform'); if (t) { const p = persp(t.z); t.x += dx / (Context.camera.zoom*p); t.y += dy / (Context.camera.zoom*p); }
});
bus.on('camera-pan', ({ dx, dy }) => {
  Context.camera.x -= dx / Context.camera.zoom; Context.camera.y -= dy / Context.camera.zoom;
});
bus.on('zoom-in', () => Context.camera.zoom *= 1.12);
bus.on('zoom-out', () => Context.camera.zoom /= 1.12);
bus.on('pan-left', () => Context.camera.x -= 40 / Context.camera.zoom);
bus.on('pan-right', () => Context.camera.x += 40 / Context.camera.zoom);
bus.on('pan-up', () => Context.camera.y -= 40 / Context.camera.zoom);
bus.on('pan-down', () => Context.camera.y += 40 / Context.camera.zoom);

/* ============================================================
   11. FACTORIES
   ============================================================ */
function nextChildName(parentId) {
  if (parentId == null) return 'Root';
  const p = world.get(parentId, 'Node'); if (!p) return 'Node';
  const used = new Set(p.children.map(c => (world.get(c, 'Node')?.title || '').trim()));
  for (let c = 65; c <= 90; c++) { const name = String.fromCharCode(c); if (!used.has(name)) return name; }
  for (let i = 1; ; i++) { const name = 'N' + i; if (!used.has(name)) return name; }
}
function createNode(x, y, z, title, body = '', parentId = null) {
  const eid = world.create();
  const el = document.createElement('div');
  el.className = 'node'; el.dataset.eid = eid;
  el.innerHTML = `<div class="title">${title}</div><div class="body">${body}</div>`;
  uiLayer.appendChild(el);
  world.add(eid, 'Transform', { x, y, z });
  world.add(eid, 'Node', { title, body, parentId, domEl: el, children: [], collapsed: false });
  if (parentId) { const p = world.get(parentId, 'Node'); if (p) p.children.push(eid); }
  return eid;
}
function createEdge(from, to, label = '') {
  const eid = world.create();
  world.add(eid, 'Edge', { from, to, label });
  return eid;
}
function isVisible(id) {
  const n = world.get(id, 'Node'); if (!n) return true;
  if (n.parentId) { const p = world.get(n.parentId, 'Node'); if (p && p.collapsed) return false; return isVisible(n.parentId); }
  return true;
}
function deleteTree(id) {
  const n = world.get(id, 'Node');
  if (n) { [...n.children].forEach(deleteTree); n.domEl.remove(); }
  world.q(['Edge']).forEach(eid2 => { const ed = world.get(eid2, 'Edge'); if (ed.from === id || ed.to === id) world.remove(eid2); });
  world.remove(id);
}

/* ============================================================
   12. RENDER (grid → containers → edges → ghost → nodes)
   ============================================================ */
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const css = getComputedStyle(document.documentElement);
  const themeColor = (name, fallback) => css.getPropertyValue(name).trim() || fallback;

  // Grid (two-tone for depth)
  const c = Context.camera;
  ctx.lineWidth = 1;
  const gs = 60 * c.zoom;
  const ox = (canvas.width / 2 - c.x * c.zoom) % gs;
  const oy = (canvas.height / 2 - c.y * c.zoom) % gs;
  ctx.strokeStyle = themeColor('--canvas-grid', '#252840');
  ctx.beginPath();
  for (let x = ox; x < canvas.width; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
  for (let y = oy; y < canvas.height; y += gs) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
  ctx.stroke();

  // 3D nested containers: draw a translucent rounded box around each parent's subtree.
  // Walk from deepest -> shallowest so outer boxes sit behind inner ones.
  const nodes = world.q(['Transform','Node']);
  const depthMap = new Map();
  const depthOf = (id) => {
    if (depthMap.has(id)) return depthMap.get(id);
    const n = world.get(id, 'Node');
    const d = n.parentId ? depthOf(n.parentId) + 1 : 0;
    depthMap.set(id, d); return d;
  };
  nodes.forEach(depthOf);
  const parents = nodes.filter(id => {
    const n = world.get(id, 'Node');
    return n.children.length && !n.collapsed && isVisible(id);
  }).sort((a, b) => depthOf(a) - depthOf(b));

  // Bounding box of a parent's *descendants* only (excludes the parent itself, since
  // an expanded parent gets repositioned to a header bar above its subtree).
  const HEADER_H = 38;
  const descendantsBounds = (id) => {
    const result = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const visit = (i) => {
      const t = world.get(i, 'Transform'), n = world.get(i, 'Node');
      if (!t || !n) return;
      const el = n.domEl;
      const w = (el.offsetWidth || 180) / 2;
      const h = (el.offsetHeight || 70) / 2;
      const s = worldToScreen(t.x, t.y, t.z);
      result.minX = Math.min(result.minX, s.x - w * s.scale);
      result.maxX = Math.max(result.maxX, s.x + w * s.scale);
      result.minY = Math.min(result.minY, s.y - h * s.scale);
      result.maxY = Math.max(result.maxY, s.y + h * s.scale);
      if (!n.collapsed) n.children.forEach(visit);
    };
    const root = world.get(id, 'Node');
    if (root && !root.collapsed) root.children.forEach(visit);
    return result;
  };

  const bboxByParent = new Map();
  for (const pid of parents) bboxByParent.set(pid, descendantsBounds(pid));

  const headerPositions = new Map();
  const placedHeaders = [];
  const rectsTooClose = (a, b, gap = 8) =>
    a.left < b.right + gap && a.right + gap > b.left &&
    a.top < b.bottom + gap && a.bottom + gap > b.top;

  for (const pid of parents) {
    const b = bboxByParent.get(pid);
    if (!isFinite(b.minX)) continue;
    const n = world.get(pid, 'Node');
    const headerW = n.domEl.offsetWidth || 180;
    const headerH = n.domEl.offsetHeight || HEADER_H;
    const cx = (b.minX + b.maxX) / 2;
    let cy = b.minY - 22 - headerH/2;
    let rect = {
      left: cx - headerW/2,
      right: cx + headerW/2,
      top: cy - headerH/2,
      bottom: cy + headerH/2,
    };

    while (placedHeaders.some(placed => rectsTooClose(rect, placed))) {
      cy -= headerH + 8;
      rect = {
        left: cx - headerW/2,
        right: cx + headerW/2,
        top: cy - headerH/2,
        bottom: cy + headerH/2,
      };
    }

    headerPositions.set(pid, { cx, cy });
    placedHeaders.push(rect);
  }

  for (const pid of parents) {
    const b = bboxByParent.get(pid);
    if (!isFinite(b.minX)) continue;
    const pad = 22;
    const x = b.minX - pad;
    const y = b.minY - pad - HEADER_H;
    const w = (b.maxX - b.minX) + pad*2;
    const h = (b.maxY - b.minY) + pad*2 + HEADER_H;
    const r = 14;
    ctx.fillStyle = themeColor('--container-fill', 'rgba(43,50,86,0.55)');
    ctx.strokeStyle = themeColor('--container-stroke', 'rgba(111,134,196,0.4)');
    ctx.lineWidth = 1.2;
    roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
  }

  // Edges
  ctx.lineWidth = 2;
  for (const eid of world.q(['Edge'])) {
    const ed = world.get(eid, 'Edge');
    if (!isVisible(ed.from) || !isVisible(ed.to)) continue;
    // Skip parent→child arrows when the parent is an expanded container —
    // containment carries the relationship visually.
    const srcN = world.get(ed.from, 'Node');
    if (srcN && !srcN.collapsed && srcN.children.includes(ed.to)) continue;
    const t1 = world.get(ed.from, 'Transform'), t2 = world.get(ed.to, 'Transform');
    if (!t1 || !t2) continue;
    const s1 = worldToScreen(t1.x, t1.y, t1.z), s2 = worldToScreen(t2.x, t2.y, t2.z);
    const sel = Context.selectedId === eid;
    ctx.strokeStyle = sel ? themeColor('--edge-selected', '#ffb84d') : themeColor('--edge', '#5bd2ff');
    ctx.lineWidth = sel ? 3 : 2;
    ctx.globalAlpha = Math.min(1, Math.min(s1.scale, s2.scale));
    ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
    const ang = Math.atan2(s2.y - s1.y, s2.x - s1.x);
    const ah = 9 * Math.min(s1.scale, s2.scale);
    ctx.fillStyle = sel ? themeColor('--edge-selected', '#ffb84d') : themeColor('--edge', '#5bd2ff');
    ctx.beginPath();
    ctx.moveTo(s2.x, s2.y);
    ctx.lineTo(s2.x - ah * Math.cos(ang - 0.4), s2.y - ah * Math.sin(ang - 0.4));
    ctx.lineTo(s2.x - ah * Math.cos(ang + 0.4), s2.y - ah * Math.sin(ang + 0.4));
    ctx.fill();
    if (ed.label) {
      ctx.fillStyle = themeColor('--edge-label', '#8590b5'); ctx.font = '12px sans-serif';
      ctx.fillText(ed.label, (s1.x + s2.x) / 2, (s1.y + s2.y) / 2 - 6);
    }
    ctx.globalAlpha = 1;
  }

  // Ghost connect line (drawn whenever a source is staged, including during picker)
  if (Context.connectSource) {
    const t = world.get(Context.connectSource, 'Transform');
    if (t) {
      const s = worldToScreen(t.x, t.y, t.z);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(Context.mouse.x, Context.mouse.y);
      ctx.strokeStyle = themeColor('--ghost', '#ffb84d'); ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = themeColor('--ghost', '#ffb84d'); ctx.font = '12px sans-serif';
      ctx.fillText('connect (click empty to create)', (s.x + Context.mouse.x) / 2 + 10, (s.y + Context.mouse.y) / 2 - 8);
    }
  }

  // DOM nodes
  nodes.sort((a, b) => world.get(a, 'Transform').z - world.get(b, 'Transform').z);
  for (const eid of nodes) {
    const t = world.get(eid, 'Transform'), n = world.get(eid, 'Node');
    const s = worldToScreen(t.x, t.y, t.z);
    const vis = isVisible(eid);
    n.domEl.style.display = vis ? 'block' : 'none'; if (!vis) continue;
    const b = bboxByParent.get(eid);
    const isContainer = !!(b && isFinite(b.minX));
    if (isContainer) {
      const header = headerPositions.get(eid);
      const cx = header?.cx ?? (b.minX + b.maxX) / 2;
      const cy = header?.cy ?? b.minY - 22 - HEADER_H/2;
      n.domEl.style.transform = `translate(${cx}px,${cy}px) translate(-50%,-50%)`;
      n.domEl.style.opacity = 1;
      n.domEl.style.zIndex = Math.floor(t.z + 1000) + 2;
    } else {
      n.domEl.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-50%) scale(${s.scale})`;
      n.domEl.style.opacity = Math.max(0.4, Math.min(1, s.scale));
      n.domEl.style.zIndex = Math.floor(t.z + 1000);
    }
    n.domEl.classList.toggle('is-container', isContainer);
    n.domEl.classList.toggle('selected', Context.selectedId === eid);
    n.domEl.classList.toggle('connecting', Context.connectSource === eid);
    n.domEl.classList.toggle('collapsed', n.collapsed);
    n.domEl.classList.toggle('has-children', n.children.length > 0);
  }

  document.getElementById('hud-mode').textContent =
    Context.mode === 'normal' ? 'NORMAL' :
    Context.mode === 'connecting' ? 'CONNECTING' :
    Context.mode === 'jump' ? 'JUMP' + (jumpBuffer ? ` "${jumpBuffer}"` : '') : 'PALETTE';
  const hl = document.getElementById('hud-layout'); if (hl) hl.textContent = Context.layoutMode;
  if (Context.mode === 'jump') renderJumpHints();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

/* ============================================================
   13. DEMO RUNNER (user-flow event simulator)
   ============================================================ */
let demoTimer = null;
function stopDemo() {
  if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  document.getElementById('btn-demo').style.display = '';
  document.getElementById('btn-stop').style.display = 'none';
}
function runDemo() {
  stopDemo();
  bus.emit('cmd-reset');
  // Capture entity ids as they are created via emit; we reference them by 'last' or named refs.
  const refs = {};
  const remember = (key) => { refs[key] = Context.selectedId; };
  // Each step demonstrates user *thinking*: select before add, connect-create, rename.
  const script = [
    // Build root
    { fn: () => bus.emit('cmd-add-node', { at:[0,-260,0], title:'JVM Runtime', parent:null }), say:'create root', delay: 500 },
    { fn: () => remember('jvm'), delay: 50 },
    // Add three regions as children — user must keep selecting parent each time
    { fn: () => bus.emit('node-select', { eid: refs.jvm }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[-340,40,0], title:'Heap', body:'Object storage' }), delay: 450 },
    { fn: () => remember('heap'), delay: 50 },
    { fn: () => bus.emit('node-select', { eid: refs.jvm }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[340,40,0], title:'JVM Stack', body:'Per-thread' }), delay: 450 },
    { fn: () => remember('stack'), delay: 50 },
    { fn: () => bus.emit('node-select', { eid: refs.jvm }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[0,0,0], title:'Metaspace', body:'Class metadata' }), delay: 450 },
    { fn: () => remember('meta'), delay: 50 },
    // Heap children at deeper layer
    { fn: () => bus.emit('cmd-layer', { z:-300 }), delay: 250 },
    { fn: () => bus.emit('node-select', { eid: refs.heap }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[-420,220,-300], title:'Eden', body:'New objects' }), delay: 400 },
    { fn: () => remember('eden'), delay: 50 },
    { fn: () => bus.emit('node-select', { eid: refs.heap }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[-190,220,-300], title:'Survivor', body:'S0 / S1' }), delay: 400 },
    { fn: () => bus.emit('node-select', { eid: refs.heap }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[40,220,-300], title:'Old Gen', body:'Long-lived' }), delay: 400 },
    // Stack threads
    { fn: () => bus.emit('node-select', { eid: refs.stack }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[260,220,-300], title:'Thread-1', body:'frame' }), delay: 400 },
    { fn: () => remember('t1'), delay: 50 },
    { fn: () => bus.emit('node-select', { eid: refs.stack }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[500,220,-300], title:'Thread-2', body:'frame' }), delay: 400 },
    // Object node at z=-600, demonstrate connect-create flow
    { fn: () => bus.emit('cmd-layer', { z:-600 }), delay: 250 },
    { fn: () => bus.emit('node-select', { eid: refs.eden }), delay: 200 },
    { fn: () => bus.emit('cmd-add-node', { at:[-520,420,-600], title:'Object', body:'In Eden' }), delay: 450 },
    { fn: () => remember('obj'), delay: 50 },
    // Show off connect mode -> create new node by clicking empty space (simulated)
    { fn: () => bus.emit('node-select', { eid: refs.t1 }), delay: 250 },
    { fn: () => bus.emit('cmd-connect-start'), delay: 250 },
    { fn: () => bus.emit('cmd-add-node', { at:[340,420,-600], title:'ref', body:'local var', connectFrom: refs.t1 }), delay: 450 },
    // Reuse layout
    { fn: () => bus.emit('node-select', { eid: refs.jvm }), delay: 250 },
    { fn: () => bus.emit('cmd-layout'), delay: 600 },
    // Final touch: collapse heap to show 3D nesting flatten
    { fn: () => bus.emit('node-select', { eid: refs.heap }), delay: 400 },
    { fn: () => bus.emit('cmd-collapse'), delay: 600 },
    { fn: () => bus.emit('cmd-collapse'), delay: 600 },
  ];
  const startUI = () => {
    document.getElementById('btn-demo').style.display = 'none';
    document.getElementById('btn-stop').style.display = '';
  };
  startUI();
  let i = 0;
  const tick = () => {
    if (i >= script.length) { stopDemo(); return; }
    const step = script[i++];
    step.fn();
    const d = (step.delay || 300) / (Context.demoSpeed || 1);
    demoTimer = setTimeout(tick, d);
  };
  demoTimer = setTimeout(tick, 100);
}

/* ============================================================
   14. DOCK WIRING
   ============================================================ */
function themeById(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}
function refreshThemeBtn() {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const theme = themeById(Context.theme);
  btn.textContent = `Theme: ${theme.label}`;
  btn.classList.toggle('active', theme.id !== 'default');
}
function setTheme(id, { persist = true } = {}) {
  const theme = themeById(id);
  Context.theme = theme.id;
  if (theme.id === 'default') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme.id;
  if (persist) {
    try { localStorage.setItem('graphTheme', theme.id); } catch (_) {}
  }
  refreshThemeBtn();
  scheduleRender();
}
function nextThemeId() {
  const i = THEMES.findIndex(t => t.id === Context.theme);
  return THEMES[(i + 1) % THEMES.length].id;
}
bus.on('cmd-theme-cycle', () => setTheme(nextThemeId()));

document.getElementById('btn-demo').addEventListener('click', () => bus.emit('cmd-demo-start'));
document.getElementById('btn-stop').addEventListener('click', () => bus.emit('cmd-demo-stop'));
document.getElementById('btn-reset').addEventListener('click', () => bus.emit('cmd-reset'));
document.getElementById('btn-theme').addEventListener('click', () => bus.emit('cmd-theme-cycle'));
setTheme(Context.theme, { persist: false });
const speedEl = document.getElementById('speed');
const speedVal = document.getElementById('speed-val');
speedEl.addEventListener('input', () => {
  Context.demoSpeed = parseFloat(speedEl.value);
  speedVal.textContent = Context.demoSpeed.toFixed(2) + '×';
});

/* Toast toggle (off by default, persisted) */
let toastEnabled = (() => { try { return localStorage.getItem('toastEnabled') === '1'; } catch (_) { return false; } })();
const btnToast = document.getElementById('btn-toast');
function refreshToastBtn() {
  btnToast.textContent = `Toast: ${toastEnabled ? 'on' : 'off'}`;
  btnToast.classList.toggle('active', toastEnabled);
  if (!toastEnabled) { document.getElementById('toast').innerHTML = ''; Context.lastEvents = []; }
}
btnToast.addEventListener('click', () => {
  toastEnabled = !toastEnabled;
  try { localStorage.setItem('toastEnabled', toastEnabled ? '1' : '0'); } catch (_) {}
  refreshToastBtn();
});
refreshToastBtn();

/* ============================================================
   15. SEED: Java Memory Model
   ============================================================ */

function buildJMM() {
  const ids = {};
  [
    ['jvm', 0, -260, 0, 'JVM Runtime', ''],
    ['heap', -340, 40, 0, 'Heap', 'Object storage', 'jvm'],
    ['stack', 340, 40, 0, 'JVM Stack', 'Per-thread', 'jvm'],
    ['meta', 0, 0, 0, 'Metaspace', 'Class metadata', 'jvm'],
    ['eden', -420, 220, -300, 'Eden', 'New objects', 'heap'],
    ['surv', -190, 220, -300, 'Survivor', 'S0 / S1', 'heap'],
    ['old', 40, 220, -300, 'Old Gen', 'Long-lived', 'heap'],
    ['t1', 260, 220, -300, 'Thread-1', 'Local vars', 'stack'],
    ['t2', 500, 220, -300, 'Thread-2', 'Local vars', 'stack'],
    ['obj', -520, 420, -600, 'Object', 'In Eden', 'eden'],
    ['ref1', 340, 420, -600, 'ref', 'Local variable', 't1'],
    ['ref2', 620, 420, -600, 'ref', 'Local variable', 't2'],
  ].forEach(([key, x, y, z, title, body, parent]) => {
    ids[key] = createNode(x, y, z, title, body, parent ? ids[parent] : null);
  });
  [
    ['jvm', 'heap', 'manages'], ['jvm', 'stack', 'manages'], ['jvm', 'meta', 'manages'],
    ['heap', 'eden', 'contains'], ['heap', 'surv', 'contains'], ['heap', 'old', 'contains'],
    ['stack', 't1', 'frame'], ['stack', 't2', 'frame'], ['eden', 'obj', 'allocates'],
    ['t1', 'ref1', 'holds'], ['t2', 'ref2', 'holds'],
    ['ref1', 'obj', 'points to'], ['ref2', 'obj', 'points to'],
  ].forEach(([from, to, label]) => createEdge(ids[from], ids[to], label));
  Context.selectedId = ids.jvm;
}

window.ECSGraphApp = {
  Context, world, bus, buildJMM, createNode, createEdge, isVisible, stopDemo,
  scheduleRender, renderNow: render, worldToScreen,
};
