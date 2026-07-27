import { STORAGE_KEYS, clamp, type Registry } from '../core';
import { channelOf, type TelemetrySummary } from '../core/telemetry-core';
import { Slots } from '../types';
import type { Position, Size } from '../types';

/** The portal: a resizable minimap of the app's own event flow.
 *
 *  `telemetry` records spans off-thread and posts back a small summary; this
 *  system draws it. Nodes are event names, columns are bus dispatch depth (root
 *  emits on the left, the facts and features they cascade into to the right),
 *  links are parent→child pairs the bus actually produced. A node lights when
 *  its event fires and fades over `HOT_MS`.
 *
 *  Two update paths, because an observer that rebuilds itself per event is a
 *  load generator, not an instrument:
 *   - **structural** (new event name, filter, resize) → a real panel redraw,
 *     rate-limited to `STRUCTURE_MS`;
 *   - **heat** (the same nodes, newly lit) → attribute writes on the live SVG,
 *     no DOM construction and no bus traffic at all.
 */

declare module '../types' {
  interface CustomEvents {
    'telemetry.portal.toggle': void;
    'telemetry.portal.filter': { channel: string };
    'telemetry.portal.resize.start': { x: number; y: number };
    'telemetry.portal.resize.move': { x: number; y: number };
    'telemetry.portal.resize.end': void;
  }
}

const PANEL_ID = 'telemetry';
const FOLD_ID = 'panel.telemetry';
const SIZE_KEY = `${STORAGE_KEYS.telemetryConfig}.portal`;
const DEFAULT_SIZE: Size = { w: 380, h: 280 };
const MIN: Size = { w: 240, h: 170 };
const MAX: Size = { w: 760, h: 620 };
/** Head + filter row + footer. The rest of the panel is map. */
const CHROME_H = 76;
/** Roughly the advance width of the 8.5px monospace label face. */
const CHAR_W = 4.8;
/** How long a node stays lit after its event fired. */
const HOT_MS = 1400;
/** Heat repaint cadence — fast enough to read as live, slow enough to be free. */
const HEAT_MS = 100;
/** Floor between full panel rebuilds. */
const STRUCTURE_MS = 400;
/** Most-frequent event names to draw. Beyond this the map stops being a map. */
const MAX_NODES = 26;
const COLUMNS = 5;
const SVG_NS = 'http://www.w3.org/2000/svg';

const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
};

/** `graph.node.updated` → `node.updated`: the namespace is the column, the tail
 *  is what the reader needs. */
const shortName = (name: string) => {
  const parts = name.split('.');
  return parts.length > 2 ? parts.slice(1).join('.') : name;
};

export function registerTelemetryPortal(system: Registry) {
  system('telemetry.portal', ctx => {
    const { on, emit, contexts, io, declarePanel, contribute, telemetry, frameLoop } = ctx;
    if (!telemetry) return;

    let open = false;
    let size: Size = { ...DEFAULT_SIZE, ...io.get<Partial<Size>>(SIZE_KEY, {}) };
    let resize: { pointer: Position; start: Size } | null = null;
    let channel = 'all';
    let summary: TelemetrySummary = telemetry.summary();
    /** `performance.now()` per event name — the only thing heat needs. */
    const lastSeen = new Map<string, number>();
    /** Live SVG groups by event name, so heat is an attribute write. */
    const nodeEls = new Map<string, SVGGElement>();
    let structureKey = '';
    let lastStructureAt = 0;
    let heatQueued = false;

    const visibleNodes = () => {
      const rows = summary.nodes
        .filter(([name]) => channel === 'all' || channelOf(name) === channel)
        .slice(0, MAX_NODES);
      // Frequency picks *which* nodes; name order keeps them from swapping
      // places every time a counter ticks over.
      return [...rows].sort((a, b) => a[0].localeCompare(b[0]));
    };
    const keyOfStructure = () => `${channel}|${size.w}x${size.h}|${visibleNodes().map(node => node[0]).join(',')}`;

    const paintHeat = () => {
      heatQueued = false;
      if (!open || !nodeEls.size) return;
      const now = performance.now();
      let stillHot = false;
      nodeEls.forEach((group, name) => {
        const age = now - (lastSeen.get(name) ?? -Infinity);
        const heat = age < HOT_MS ? 1 - age / HOT_MS : 0;
        if (heat > 0) { group.dataset.hot = heat.toFixed(2); stillHot = true; }
        else if (group.dataset.hot) delete group.dataset.hot;
        const bg = group.firstElementChild;
        if (bg) bg.setAttribute('opacity', (0.25 + heat * 0.75).toFixed(2));
      });
      if (stillHot) scheduleHeat();
    };
    const scheduleHeat = () => {
      if (!open || heatQueued) return;
      heatQueued = true;
      frameLoop.schedule('telemetry.portal.heat', paintHeat, 90);
    };

    const redraw = () => {
      if (!open) return;
      lastStructureAt = performance.now();
      structureKey = keyOfStructure();
      emit('tool.panel.redraw', { id: PANEL_ID });
      paintHeat();
    };
    /** Rebuild only when the *shape* changed, and never more often than
     *  STRUCTURE_MS — otherwise the panel becomes the app's busiest system. */
    const scheduleStructure = () => {
      if (!open || keyOfStructure() === structureKey) return;
      const wait = Math.max(0, STRUCTURE_MS - (performance.now() - lastStructureAt));
      frameLoop.schedule('telemetry.portal.draw', redraw, 60);
      if (wait > 0) setTimeout(() => frameLoop.schedule('telemetry.portal.draw', redraw, 60), wait);
    };

    const onSummary = (next: TelemetrySummary) => {
      summary = next;
      if (!open) return;
      // `lastStart` is the capturing thread's `performance.now()` — same clock,
      // so it can be compared to `now` directly.
      next.nodes.forEach(([name, , , lastStart]) => { if (lastStart) lastSeen.set(name, lastStart); });
      scheduleStructure();
      scheduleHeat();
    };

    const channels = () => {
      const seen = new Set<string>(['all']);
      summary.nodes.forEach(([name]) => seen.add(channelOf(name)));
      return [...seen];
    };

    const drawMap = (width: number, height: number) => {
      const names = visibleNodes();
      nodeEls.clear();
      const root = svg('svg', { class: 'telemetry-map', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });
      root.setAttribute('aria-label', `Event flow: ${names.length} event types`);
      if (!names.length) {
        const empty = svg('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'telemetry-empty' });
        empty.textContent = 'No events yet — touch the canvas.';
        root.append(empty);
        return root;
      }
      const columns: string[][] = Array.from({ length: COLUMNS }, () => []);
      names.forEach(([name, , depth]) => columns[clamp(depth - 1, 0, COLUMNS - 1)].push(name));
      const usedColumns = columns.filter(column => column.length).length || 1;
      const columnWidth = width / usedColumns;
      const boxW = Math.max(36, Math.min(columnWidth - 10, 108));
      const boxH = 15;
      const maxChars = Math.max(4, Math.floor((boxW - 6) / CHAR_W));
      const at = new Map<string, { x: number; y: number }>();
      let slot = 0;
      columns.forEach(column => {
        if (!column.length) return;
        const x = slot * columnWidth + (columnWidth - boxW) / 2;
        // Last row must land inside the box, not one gap past it.
        const gap = Math.min(24, (height - boxH - 12) / Math.max(column.length - 1, 1));
        column.forEach((name, index) => at.set(name, { x, y: 6 + index * gap }));
        slot++;
      });

      const links = svg('g', { class: 'telemetry-links' });
      summary.links.forEach(([from, to, count]) => {
        const a = at.get(from), b = at.get(to);
        if (!a || !b) return;
        const x1 = a.x + boxW, y1 = a.y + boxH / 2;
        const x2 = b.x, y2 = b.y + boxH / 2;
        const mid = (x1 + x2) / 2;
        links.append(svg('path', {
          d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
          class: 'telemetry-link',
          'stroke-width': Math.min(2.4, 0.5 + Math.log10(count + 1)),
        }));
      });
      root.append(links);

      const nodes = svg('g', { class: 'telemetry-nodes' });
      names.forEach(([name, count]) => {
        const point = at.get(name);
        if (!point) return;
        const group = svg('g', { class: 'telemetry-node', transform: `translate(${point.x}, ${point.y})` });
        group.dataset.channel = channelOf(name);
        group.append(svg('rect', { x: 0, y: 0, width: boxW, height: boxH, rx: 3, class: 'telemetry-node-bg', opacity: '0.25' }));
        const text = svg('text', { x: 3, y: boxH - 4.5, class: 'telemetry-node-label' });
        const short = shortName(name);
        text.textContent = short.length > maxChars ? `${short.slice(0, maxChars - 1)}…` : short;
        const title = svg('title');
        title.textContent = `${name} · ${count}×`;
        group.append(text, title);
        nodes.append(group);
        nodeEls.set(name, group);
      });
      root.append(nodes);
      return root;
    };

    const render = () => {
      const body = document.createElement('div');
      body.className = 'telemetry-portal';
      // Width is fixed, height is the map's height plus chrome — so the panel
      // never disagrees with the viewBox the map was drawn against.
      body.style.width = `${size.w}px`;
      const mapW = size.w - 18;
      const mapH = Math.max(60, size.h - CHROME_H);

      const head = document.createElement('div');
      head.className = 'telemetry-portal-head';
      const title = document.createElement('span');
      title.className = 'telemetry-portal-title';
      title.textContent = `Event flow · ${summary.total} spans`;
      const exporting = telemetry.config().export;
      const state = document.createElement('button');
      state.type = 'button';
      state.className = `telemetry-portal-export${exporting ? ' is-on' : ''}`;
      state.dataset.command = 'telemetry.export.toggle';
      state.textContent = exporting ? 'OTLP on' : 'OTLP off';
      state.title = exporting
        ? `Streaming spans to ${telemetry.config().endpoint}`
        : 'Spans stay in this browser. Turn on to POST them to a collector.';
      head.append(title, state);

      const filter = document.createElement('div');
      filter.className = 'telemetry-portal-filter';
      channels().forEach(name => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'telemetry.portal.filter';
        button.dataset.channel = name;
        button.className = name === channel ? 'is-active' : '';
        button.setAttribute('aria-pressed', name === channel ? 'true' : 'false');
        button.textContent = name;
        filter.append(button);
      });

      const map = document.createElement('div');
      map.className = 'telemetry-portal-map';
      map.style.height = `${mapH}px`;
      map.append(drawMap(mapW, mapH));

      const foot = document.createElement('div');
      foot.className = 'telemetry-portal-foot';
      const last = document.createElement('span');
      last.className = 'telemetry-portal-last';
      last.textContent = summary.last ? `last: ${summary.last}` : 'idle';
      const where = document.createElement('span');
      where.className = 'telemetry-portal-where';
      where.textContent = telemetry.parallel() ? 'worker' : 'inline';
      where.title = telemetry.parallel()
        ? 'Aggregation runs in a worker — off the interaction thread.'
        : 'No Worker on this platform; aggregation runs deferred on the main thread.';
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'telemetry-portal-resize';
      grip.dataset.telemetryResize = '';
      grip.setAttribute('aria-label', 'Resize event flow panel');
      grip.textContent = '⌟';
      foot.append(last, where, grip);

      body.append(head, filter, map, foot);
      return body;
    };

    declarePanel({
      // top-right is the one free anchor (layout owns bottom-left, zoom
      // bottom-right, context middle-right) — and it's movable anyway.
      id: PANEL_ID, anchor: 'top-right', movable: true, foldId: FOLD_ID,
      layout: 'custom', render, order: 30, mountWhen: () => open,
    });
    contribute({
      surface: 'top', command: 'telemetry.portal.toggle', kind: 'button', icon: 'pulse',
      text: 'Event flow', label: 'Show the live event-flow map', slot: Slots.End, order: 80,
      group: 'overflow', active: () => open,
    });

    contexts.commands.register([
      {
        id: 'telemetry.portal.toggle',
        label: 'Toggle the live event-flow map',
        group: 'telemetry',
        shortcut: 'Ctrl+Shift+E',
        input: { on: 'keydown', key: 'e', ctrl: true, shift: true, prevent: true },
      },
      { id: 'telemetry.portal.filter', label: 'Filter event flow by channel', group: 'telemetry', hidden: true,
        payload: ({ target }) => ({ channel: (target as HTMLElement | null)?.dataset.channel ?? 'all' }) },
      {
        id: 'telemetry.portal.resize.start', label: 'Start resizing event flow', group: 'telemetry', hidden: true,
        input: { on: 'pointerdown', selector: '[data-telemetry-resize]', prevent: true, stop: true, priority: -20 },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'telemetry.portal.resize.move', label: 'Resize event flow', group: 'telemetry', hidden: true,
        input: { on: 'pointermove', when: () => !!resize, prevent: true, stop: true, priority: -20 },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      { id: 'telemetry.portal.resize.end', label: 'Stop resizing event flow', group: 'telemetry', hidden: true,
        input: { on: 'pointerup', when: () => !!resize, stop: true, priority: -20 } },
    ]);

    on('telemetry.portal.toggle', () => {
      open = !open;
      summary = telemetry.summary();
      structureKey = '';
      if (open) redraw();
      // mountWhen flipped — the panel registry re-evaluates on affordance news.
      emit('affordance.contributed', { surface: 'top' });
    });
    on('telemetry.portal.filter', ({ channel: next }) => { channel = next; redraw(); });
    on('telemetry.portal.resize.start', ({ x, y }) => { resize = { pointer: { x, y }, start: { ...size } }; });
    on('telemetry.portal.resize.move', ({ x, y }) => {
      if (!resize) return;
      size = {
        w: clamp(resize.start.w + x - resize.pointer.x, MIN.w, MAX.w),
        h: clamp(resize.start.h + y - resize.pointer.y, MIN.h, MAX.h),
      };
      redraw();
    });
    on('telemetry.portal.resize.end', () => {
      resize = null;
      io.set(SIZE_KEY, size);
    });

    const off = telemetry.onSummary(onSummary);
    return () => {
      off();
      frameLoop.cancel('telemetry.portal.draw');
      frameLoop.cancel('telemetry.portal.heat');
    };
  }, { requires: ['telemetry', 'tool.panel'] });
}
