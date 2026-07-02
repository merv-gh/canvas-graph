import { Graph, type GraphStore } from '../model/graph';
import type { FeatureFlags } from '../types';

export type PerfTimingRow = {
  label: string;
  calls: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
};

export type PerfCountRow = {
  label: string;
  count: number;
};

export type PerfSampleRow = {
  label: string;
  samples: number;
  min: number;
  max: number;
  avg: number;
  last: number;
};

export type PerfTimelineRow = {
  id: number;
  label: string;
  start: number;
  end: number;
  duration: number;
  parentId?: number;
};

export type PerfCallEdge = {
  from: string;
  to: string;
  calls: number;
  totalMs: number;
  maxMs: number;
};

export type PerfInputRow = {
  id: number;
  source: 'router' | 'event-timing';
  name: string;
  target: string;
  startTime: number;
  processingStart: number;
  processingEnd: number;
  duration: number;
  inputDelay: number;
  processingDuration: number;
  presentationDelay: number;
  interactionId?: number;
  path?: string[];
  candidates?: string[];
  matched?: string[];
};

export type PerfLongTaskRow = {
  id: number;
  name: string;
  start: number;
  duration: number;
};

export type PerfSnapshot = {
  enabled: boolean;
  timings: PerfTimingRow[];
  counts: PerfCountRow[];
  samples: PerfSampleRow[];
  marks: { label: string; at: number }[];
  timeline: PerfTimelineRow[];
  callGraph: PerfCallEdge[];
  inputs: PerfInputRow[];
  longTasks: PerfLongTaskRow[];
};

export type PerfInputTrace = {
  end(trace?: { candidates?: string[]; matched?: string[] }): void;
};

export type PerfApi = {
  enabled(): boolean;
  setEnabled(on: boolean): void;
  reset(): void;
  count(label: string, by?: number): void;
  sample(label: string, value: number): void;
  mark(label: string): void;
  measure<T>(label: string, fn: () => T): T;
  beginInput(name: string, event?: Event, target?: Element | null): PerfInputTrace | undefined;
  recordInput(row: Omit<PerfInputRow, 'id'>): void;
  recordLongTask(row: Omit<PerfLongTaskRow, 'id'>): void;
  snapshot(): PerfSnapshot;
};

type Timing = { calls: number; totalMs: number; maxMs: number };
type Sample = { samples: number; total: number; min: number; max: number; last: number };
type StackFrame = { id: number; label: string };

const now = () => performance.now();
const MAX_TIMELINE = 2000;
const MAX_INPUTS = 500;
const MAX_LONG_TASKS = 200;

const pushCapped = <T>(rows: T[], row: T, max: number) => {
  rows.push(row);
  if (rows.length > max) rows.splice(0, rows.length - max);
};

const labelFor = (el: Element) => {
  const id = el.id ? `#${el.id}` : '';
  const cls = [...el.classList].slice(0, 3).map(name => `.${name}`).join('');
  const item = el instanceof HTMLElement && el.dataset.itemKind && el.dataset.itemId
    ? `[${el.dataset.itemKind}:${el.dataset.itemId}]`
    : '';
  return `${el.localName}${id}${cls}${item}`;
};

const selectorPathFor = (target?: Element | null, limit = 4) => {
  if (!target) return [];
  const parts: string[] = [];
  let el: Element | null = target;
  while (el && parts.length < limit) {
    parts.unshift(labelFor(el));
    el = el.parentElement;
  }
  return parts;
};

const selectorFor = (target?: Element | null) => selectorPathFor(target).join(' > ');

const eventPathFor = (event?: Event, target?: Element | null) => {
  const path = typeof event?.composedPath === 'function' ? event.composedPath() : [];
  const labels = path.filter((entry): entry is Element => entry instanceof Element).slice(0, 8).map(labelFor);
  return labels.length ? labels : selectorPathFor(target, 8).reverse();
};

const eventStartTime = (event: Event | undefined, processingStart: number) => {
  const start = event?.timeStamp ?? processingStart;
  const delay = processingStart - start;
  return Number.isFinite(delay) && delay >= -1 && delay < 60_000 ? start : processingStart;
};

export function createPerfApi(initialEnabled = false): PerfApi {
  let on = initialEnabled;
  const timings = new Map<string, Timing>();
  const counts = new Map<string, number>();
  const samples = new Map<string, Sample>();
  const marks: { label: string; at: number }[] = [];
  const timeline: PerfTimelineRow[] = [];
  const inputs: PerfInputRow[] = [];
  const longTasks: PerfLongTaskRow[] = [];
  const stack: StackFrame[] = [];
  const callEdges = new Map<string, PerfCallEdge>();
  let nextId = 1;

  const recordTiming = (label: string, ms: number) => {
    const row = timings.get(label) ?? timings.set(label, { calls: 0, totalMs: 0, maxMs: 0 }).get(label)!;
    row.calls++;
    row.totalMs += ms;
    row.maxMs = Math.max(row.maxMs, ms);
  };
  const recordSpan = (span: PerfTimelineRow, parent?: StackFrame) => {
    pushCapped(timeline, span, MAX_TIMELINE);
    if (!parent) return;
    const key = `${parent.label}=>${span.label}`;
    const edge = callEdges.get(key) ?? callEdges.set(key, {
      from: parent.label,
      to: span.label,
      calls: 0,
      totalMs: 0,
      maxMs: 0,
    }).get(key)!;
    edge.calls++;
    edge.totalMs += span.duration;
    edge.maxMs = Math.max(edge.maxMs, span.duration);
  };

  return {
    enabled: () => on,
    setEnabled(next) { on = next; },
    reset() {
      timings.clear();
      counts.clear();
      samples.clear();
      marks.length = 0;
      timeline.length = 0;
      inputs.length = 0;
      longTasks.length = 0;
      stack.length = 0;
      callEdges.clear();
    },
    count(label, by = 1) {
      if (!on) return;
      counts.set(label, (counts.get(label) ?? 0) + by);
    },
    sample(label, value) {
      if (!on || !Number.isFinite(value)) return;
      const row = samples.get(label) ?? samples.set(label, {
        samples: 0,
        total: 0,
        min: Infinity,
        max: -Infinity,
        last: value,
      }).get(label)!;
      row.samples++;
      row.total += value;
      row.min = Math.min(row.min, value);
      row.max = Math.max(row.max, value);
      row.last = value;
    },
    mark(label) {
      if (!on) return;
      marks.push({ label, at: now() });
    },
    measure(label, fn) {
      if (!on) return fn();
      const start = now();
      const parent = stack[stack.length - 1];
      const frame = { id: nextId++, label };
      stack.push(frame);
      try {
        return fn();
      } finally {
        const end = now();
        const duration = end - start;
        stack.pop();
        recordTiming(label, duration);
        recordSpan({ id: frame.id, label, start, end, duration, parentId: parent?.id }, parent);
      }
    },
    beginInput(name, event, target) {
      if (!on) return undefined;
      const processingStart = now();
      const startTime = eventStartTime(event, processingStart);
      const inputDelay = Math.max(0, processingStart - startTime);
      const parent = stack[stack.length - 1];
      const frame = { id: nextId++, label: `Input.${name}` };
      stack.push(frame);
      let done = false;
      return { end(trace = {}) {
        if (done) return;
        done = true;
        const processingEnd = now();
        const processingDuration = Math.max(0, processingEnd - processingStart);
        if (stack[stack.length - 1]?.id === frame.id) stack.pop();
        recordSpan({
          id: frame.id,
          label: frame.label,
          start: processingStart,
          end: processingEnd,
          duration: processingDuration,
          parentId: parent?.id,
        }, parent);
        pushCapped(inputs, {
          id: nextId++,
          source: 'router',
          name,
          target: selectorFor(target),
          startTime,
          processingStart,
          processingEnd,
          duration: inputDelay + processingDuration,
          inputDelay,
          processingDuration,
          presentationDelay: 0,
          path: eventPathFor(event, target),
          candidates: trace.candidates,
          matched: trace.matched,
        }, MAX_INPUTS);
      } };
    },
    recordInput(row) {
      if (!on) return;
      pushCapped(inputs, { id: nextId++, ...row }, MAX_INPUTS);
    },
    recordLongTask(row) {
      if (!on) return;
      pushCapped(longTasks, { id: nextId++, ...row }, MAX_LONG_TASKS);
    },
    snapshot() {
      const timingRows = [...timings.entries()]
        .map(([label, row]) => ({
          label,
          calls: row.calls,
          totalMs: row.totalMs,
          avgMs: row.totalMs / Math.max(1, row.calls),
          maxMs: row.maxMs,
        }))
        .sort((a, b) => b.totalMs - a.totalMs);
      const countRows = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
      const sampleRows = [...samples.entries()]
        .map(([label, row]) => ({
          label,
          samples: row.samples,
          min: row.min,
          max: row.max,
          avg: row.total / Math.max(1, row.samples),
          last: row.last,
        }))
        .sort((a, b) => b.max - a.max);
      const graphRows = [...callEdges.values()]
        .map(row => ({ ...row }))
        .sort((a, b) => b.totalMs - a.totalMs);
      return {
        enabled: on,
        timings: timingRows,
        counts: countRows,
        samples: sampleRows,
        marks: [...marks],
        timeline: [...timeline],
        callGraph: graphRows,
        inputs: [...inputs],
        longTasks: [...longTasks],
      };
    },
  };
}

const WRAPPED = Symbol('ecg.perf.wrapped');
const PERF_BY_TARGET = new WeakMap<object, PerfApi>();

type WrappedFn = Function & { [WRAPPED]?: true };

export function bindPerfTarget(target: object, perf: PerfApi) {
  PERF_BY_TARGET.set(target, perf);
}

export function installMethodPerf(proto: object, labelPrefix: string, names: string[]) {
  const target = proto as Record<string, unknown>;
  names.forEach(name => {
    const current = target[name] as WrappedFn | undefined;
    if (typeof current !== 'function' || current[WRAPPED]) return;
    const original = current;
    const wrapped = function (this: object, ...args: unknown[]) {
      const perf = PERF_BY_TARGET.get(this);
      if (!perf?.enabled()) return original.apply(this, args);
      return perf.measure(`${labelPrefix}.${name}`, () => original.apply(this, args));
    } as WrappedFn;
    wrapped[WRAPPED] = true;
    target[name] = wrapped;
  });
}

const perfEnabledFrom = (initialFlags: FeatureFlags) => {
  const search = typeof location === 'undefined' ? '' : location.search;
  const params = new URLSearchParams(search);
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return initialFlags.perf === true || params.get('perf') === '1' || params.has('perf') || env?.PERF === '1';
};

export const createAppPerf = (initialFlags: FeatureFlags) =>
  createPerfApi(perfEnabledFrom(initialFlags));

export function installGraphPerf(graphs: GraphStore, perf: PerfApi) {
  installMethodPerf(Graph.prototype, 'Graph', [
    'itemsOfKind',
    'getItem',
    'nodes',
    'edges',
    'edgesOf',
    'deleteNode',
    'createNode',
    'createEdge',
    'getNode',
    'updateNode',
    'updateEdge',
    'replace',
    'snapshot',
    'nodeIdsInRect',
  ]);
  graphs.all().forEach(graph => bindPerfTarget(graph, perf));
  const create = graphs.create.bind(graphs);
  graphs.create = ((id?: string) => {
    const graph = create(id);
    bindPerfTarget(graph, perf);
    return graph;
  }) as GraphStore['create'];
  const switchGraph = graphs.switch.bind(graphs);
  graphs.switch = ((id: string) => {
    const graph = switchGraph(id);
    bindPerfTarget(graph, perf);
    return graph;
  }) as GraphStore['switch'];
}
