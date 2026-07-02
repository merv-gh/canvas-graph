import type { PerfInputRow, PerfSnapshot, Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'perf.show': void;
    'perf.reset': void;
    'perf.copy': void;
  }
}

type BrowserEventTiming = PerformanceEntry & {
  processingStart?: number;
  processingEnd?: number;
  interactionId?: number;
  target?: EventTarget | null;
};

const ms = (value: number | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value < 1 ? value.toFixed(2) : value.toFixed(0);

const selectorFor = (target?: EventTarget | null) => {
  if (!(target instanceof Element)) return '';
  const parts: string[] = [];
  let el: Element | null = target;
  while (el && parts.length < 4) {
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList].slice(0, 3).map(name => `.${name}`).join('');
    const item = el instanceof HTMLElement && el.dataset.itemKind && el.dataset.itemId
      ? `[${el.dataset.itemKind}:${el.dataset.itemId}]`
      : '';
    parts.unshift(`${el.localName}${id}${cls}${item}`);
    el = el.parentElement;
  }
  return parts.join(' > ');
};

const topInput = (inputs: PerfInputRow[]) =>
  [...inputs].sort((a, b) => b.inputDelay - a.inputDelay).slice(0, 40);

const list = (values: string[] | undefined, sep = ', ') => values?.length ? values.join(sep) : '-';

const sortKey = (text: string) => {
  const numeric = Number(text.replace(/,/g, '').match(/^-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(numeric) ? numeric : text.toLowerCase();
};

const makeSortable = (t: HTMLTableElement) => {
  const headers = Array.from(t.tHead?.rows[0]?.cells ?? []);
  headers.forEach((th, index) => {
    th.tabIndex = 0;
    th.title = 'Sort';
    const sort = () => {
      const dir = th.dataset.dir === 'desc' ? 'asc' : 'desc';
      headers.forEach(item => {
        item.classList.remove('is-sorted');
        delete (item as HTMLElement).dataset.dir;
      });
      th.classList.add('is-sorted');
      th.dataset.dir = dir;
      const sign = dir === 'asc' ? 1 : -1;
      const rows = Array.from(t.tBodies[0]?.rows ?? []);
      rows.sort((a, b) => {
        const av = sortKey(a.cells[index]?.textContent ?? '');
        const bv = sortKey(b.cells[index]?.textContent ?? '');
        if (typeof av === 'number' && typeof bv === 'number') return sign * (av - bv);
        return sign * String(av).localeCompare(String(bv));
      });
      t.tBodies[0]?.append(...rows);
    };
    th.onclick = sort;
    th.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      sort();
    };
  });
};

const appendRow = (parent: HTMLElement, cells: (string | HTMLElement)[]) => {
  const row = document.createElement('tr');
  cells.forEach(cell => {
    const td = document.createElement('td');
    if (typeof cell === 'string') td.textContent = cell;
    else td.append(cell);
    row.append(td);
  });
  parent.append(row);
};

const table = (headers: string[], rows: (string | HTMLElement)[][]) => {
  const wrap = document.createElement('div');
  wrap.className = 'perf-table-wrap';
  const t = document.createElement('table');
  t.className = 'perf-table';
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  headers.forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    hr.append(th);
  });
  head.append(hr);
  const body = document.createElement('tbody');
  rows.forEach(row => appendRow(body, row));
  t.append(head, body);
  makeSortable(t);
  wrap.append(t);
  return wrap;
};

const bar = (value: number, max: number) => {
  const outer = document.createElement('span');
  outer.className = 'perf-bar';
  const inner = document.createElement('span');
  inner.style.width = `${Math.max(2, Math.min(100, max > 0 ? (value / max) * 100 : 0))}%`;
  outer.append(inner);
  return outer;
};

const renderSummary = (snap: PerfSnapshot) => {
  const inputs = snap.inputs;
  const maxInput = Math.max(0, ...inputs.map(row => row.inputDelay));
  const maxDuration = Math.max(0, ...inputs.map(row => row.duration));
  const maxSpan = Math.max(0, ...snap.timeline.map(row => row.duration));
  const grid = document.createElement('div');
  grid.className = 'perf-summary';
  [
    ['Input delay', `${ms(maxInput)} ms`],
    ['Event duration', `${ms(maxDuration)} ms`],
    ['Timeline spans', snap.timeline.length.toLocaleString()],
    ['Max span', `${ms(maxSpan)} ms`],
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'perf-summary-item';
    item.innerHTML = `<span></span><b></b>`;
    item.querySelector('span')!.textContent = label;
    item.querySelector('b')!.textContent = value;
    grid.append(item);
  });
  return grid;
};

const renderInputs = (snap: PerfSnapshot) =>
  table(
    ['Event', 'Target', 'Delay', 'Processing', 'Presentation', 'Duration', 'Source', 'Matched', 'Candidates'],
    topInput(snap.inputs).map(row => [
      row.name,
      row.target || '-',
      `${ms(row.inputDelay)} ms`,
      `${ms(row.processingDuration)} ms`,
      `${ms(row.presentationDelay)} ms`,
      `${ms(row.duration)} ms`,
      row.source,
      list(row.matched),
      list(row.candidates),
    ]),
  );

const renderInputPaths = (snap: PerfSnapshot) =>
  table(
    ['Event', 'Delay', 'Source', 'Path'],
    topInput(snap.inputs).map(row => {
      const domPath = row.path?.length ? row.path.join(' -> ') : row.target || '-';
      const commandPath = row.matched?.length ? ` -> ${row.matched.map(id => `Command.run.${id}`).join(' -> ')}` : '';
      return [
        row.name,
        `${ms(row.inputDelay)} ms`,
        row.source,
        `${domPath}${commandPath}`,
      ];
    }),
  );

const renderLongTasks = (snap: PerfSnapshot) =>
  table(
    ['Name', 'When', 'Duration'],
    [...snap.longTasks]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 80)
      .map(row => [row.name || 'longtask', `${ms(row.start)} ms`, `${ms(row.duration)} ms`]),
  );

const renderTimeline = (snap: PerfSnapshot) => {
  const rows = snap.timeline.slice(-250);
  const max = Math.max(1, ...rows.map(row => row.duration));
  const labels = new Map(snap.timeline.map(row => [row.id, row.label]));
  return table(
    ['Span', 'When', 'Duration', 'Parent', 'Bar'],
    rows.map(row => [
      row.label,
      `${ms(row.start)} ms`,
      `${ms(row.duration)} ms`,
      row.parentId ? labels.get(row.parentId) ?? String(row.parentId) : '',
      bar(row.duration, max),
    ]),
  );
};

const renderCallGraph = (snap: PerfSnapshot) =>
  table(
    ['From', 'To', 'Calls', 'Total', 'Max'],
    snap.callGraph.slice(0, 80).map(edge => [
      edge.from,
      edge.to,
      edge.calls.toLocaleString(),
      `${ms(edge.totalMs)} ms`,
      `${ms(edge.maxMs)} ms`,
    ]),
  );

const renderTimings = (snap: PerfSnapshot) =>
  table(
    ['Label', 'Calls', 'Total', 'Avg', 'Max'],
    snap.timings.slice(0, 80).map(row => [
      row.label,
      row.calls.toLocaleString(),
      `${ms(row.totalMs)} ms`,
      `${ms(row.avgMs)} ms`,
      `${ms(row.maxMs)} ms`,
    ]),
  );

const shortText = (snap: PerfSnapshot) => {
  const topInputs = topInput(snap.inputs).slice(0, 8);
  const topLongTasks = [...snap.longTasks].sort((a, b) => b.duration - a.duration).slice(0, 8);
  const maxInput = Math.max(0, ...snap.inputs.map(row => row.inputDelay));
  const maxDuration = Math.max(0, ...snap.inputs.map(row => row.duration));
  const maxSpan = Math.max(0, ...snap.timeline.map(row => row.duration));
  return [
    `PERF ${new Date().toISOString()}`,
    `summary inputDelay=${ms(maxInput)}ms eventDuration=${ms(maxDuration)}ms spans=${snap.timeline.length} maxSpan=${ms(maxSpan)}ms longTasks=${snap.longTasks.length}`,
    'inputs:',
    ...topInputs.map(row => `- ${row.name} delay=${ms(row.inputDelay)}ms dur=${ms(row.duration)}ms proc=${ms(row.processingDuration)}ms pres=${ms(row.presentationDelay)}ms src=${row.source} target=${row.target || '-'} matched=${list(row.matched)} candidates=${list(row.candidates)}`),
    'paths:',
    ...topInputs.map(row => `- ${row.name}: ${(row.path?.length ? row.path.join(' -> ') : row.target || '-')}${row.matched?.length ? ` -> ${row.matched.join(' -> ')}` : ''}`),
    'timings:',
    ...snap.timings.slice(0, 10).map(row => `- ${row.label} calls=${row.calls} total=${ms(row.totalMs)}ms max=${ms(row.maxMs)}ms avg=${ms(row.avgMs)}ms`),
    'callGraph:',
    ...snap.callGraph.slice(0, 10).map(row => `- ${row.from} -> ${row.to} calls=${row.calls} total=${ms(row.totalMs)}ms max=${ms(row.maxMs)}ms`),
    'longTasks:',
    ...(topLongTasks.length ? topLongTasks.map(row => `- ${row.name || 'longtask'} at=${ms(row.start)}ms dur=${ms(row.duration)}ms`) : ['- none']),
  ].join('\n');
};

const renderExport = (snap: PerfSnapshot) => {
  const wrap = document.createElement('div');
  wrap.className = 'perf-export-wrap';
  const text = document.createElement('textarea');
  text.className = 'perf-export';
  text.readOnly = true;
  text.value = shortText(snap);
  wrap.append(text);
  return wrap;
};

export function registerPerfPanel(system: Registry) {
  system('perf.panel', ctx => {
    const { on, emit, contexts, contribute, perf } = ctx;
    let eventObserverStarted = false;
    let longTaskObserverStarted = false;

    const installEventTiming = () => {
      if (eventObserverStarted || !perf.enabled()) return;
      eventObserverStarted = true;
      if (typeof PerformanceObserver === 'undefined') return;
      if (!(PerformanceObserver.supportedEntryTypes ?? []).includes('event')) return;
      try {
        new PerformanceObserver(list => {
          list.getEntries().forEach(entry => {
            const e = entry as BrowserEventTiming;
            const processingStart = e.processingStart ?? e.startTime;
            const processingEnd = e.processingEnd ?? processingStart;
            const inputDelay = Math.max(0, processingStart - e.startTime);
            const processingDuration = Math.max(0, processingEnd - processingStart);
            const presentationDelay = Math.max(0, e.duration - inputDelay - processingDuration);
            perf.recordInput({
              source: 'event-timing',
              name: e.name,
              target: selectorFor(e.target),
              startTime: e.startTime,
              processingStart,
              processingEnd,
              duration: e.duration,
              inputDelay,
              processingDuration,
              presentationDelay,
              interactionId: e.interactionId,
            });
          });
        }).observe({ type: 'event', buffered: true, durationThreshold: 0 } as PerformanceObserverInit);
      } catch {
        // Some browsers expose the entry type but reject durationThreshold.
      }
    };

    const installLongTasks = () => {
      if (longTaskObserverStarted || !perf.enabled()) return;
      longTaskObserverStarted = true;
      if (typeof PerformanceObserver === 'undefined') return;
      if (!(PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')) return;
      try {
        new PerformanceObserver(list => {
          list.getEntries().forEach(entry => {
            perf.recordLongTask({
              name: entry.name,
              start: entry.startTime,
              duration: entry.duration,
            });
          });
        }).observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
      } catch {
        // Some browser builds keep longtask hidden behind flags.
      }
    };

    const installObservers = () => {
      installEventTiming();
      installLongTasks();
    };

    const renderPanel = () => {
      installObservers();
      const snap = perf.snapshot();
      const root = document.createElement('section');
      root.className = 'perf-panel';

      const actions = document.createElement('div');
      actions.className = 'perf-actions';
      const refresh = document.createElement('button');
      refresh.dataset.command = 'perf.show';
      refresh.textContent = 'Refresh';
      const copy = document.createElement('button');
      copy.dataset.command = 'perf.copy';
      copy.textContent = 'Copy Short';
      const reset = document.createElement('button');
      reset.dataset.command = 'perf.reset';
      reset.textContent = 'Reset';
      actions.append(refresh, copy, reset);

      root.append(actions, renderSummary(snap));
      const sections: [string, HTMLElement][] = [
        ['Input Events', renderInputs(snap)],
        ['Input Paths', renderInputPaths(snap)],
        ['Long Tasks', renderLongTasks(snap)],
        ['Timeline', renderTimeline(snap)],
        ['Call Graph', renderCallGraph(snap)],
        ['Timing Totals', renderTimings(snap)],
        ['Share Text', renderExport(snap)],
      ];
      sections.forEach(([title, body], i) => {
        const details = document.createElement('details');
        details.open = i < 4;
        const summary = document.createElement('summary');
        summary.textContent = title;
        details.append(summary, body);
        root.append(details);
      });
      return root;
    };

    contexts.commands.register([
      {
        id: 'perf.show',
        label: 'Show: Perf',
        group: 'dx',
        available: () => perf.enabled(),
      },
      {
        id: 'perf.reset',
        label: 'Reset perf recorder',
        group: 'dx',
        hidden: true,
        available: () => perf.enabled(),
      },
      {
        id: 'perf.copy',
        label: 'Copy perf summary',
        group: 'dx',
        hidden: true,
        available: () => perf.enabled(),
      },
    ]);
    if (perf.enabled()) {
      contribute({ surface: 'top', command: 'perf.show', kind: 'button', text: 'Perf', label: 'Show perf recorder', order: 120 });
    }
    on('app.start', installObservers);
    on('perf.show', () => emit('modal.open', { title: 'Perf', visual: 'perf', body: renderPanel }));
    on('perf.copy', () => {
      const text = shortText(perf.snapshot());
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      console.info(text);
    });
    on('perf.reset', () => {
      perf.reset();
      emit('perf.show');
    });
  }, { requires: ['modal'] });
}
