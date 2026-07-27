import { STORAGE_KEYS, type Registry } from '../core';
import {
  createAggregator, DEFAULT_CONFIG,
  type Aggregator, type SpanBatch, type TelemetryConfig, type TelemetrySpan, type TelemetrySummary,
} from '../core/telemetry-core';
import type { AnyEvent } from '../types';

export type { TelemetryConfig, TelemetrySpan, TelemetrySummary } from '../core/telemetry-core';

/** OpenTelemetry for the event bus.
 *
 *  Every bus dispatch becomes a span. The bus reports its nested-dispatch depth,
 *  so a root emit opens a trace and everything its handlers emit nests under it
 *  — the request → fact → feature chain arrives as a real parent/child tree, not
 *  a flat log.
 *
 *  **The interaction path does almost nothing.** Capture is a Map lookup for the
 *  event name plus seven typed-array stores; it allocates nothing and formats no
 *  strings. Batches leave on a microtask *after* the dispatch chain unwinds (so
 *  every span's end time is already final) and land in a worker, where grouping,
 *  causality, OTLP serialisation, the persistence JSON and the HTTP POST all
 *  happen off-thread. Without `Worker` — jsdom, old browsers — the same
 *  aggregator runs in-process behind a macrotask, so it is still never inline
 *  with a keystroke.
 *
 *  Two sinks, deliberately asymmetric:
 *   - **local, on by default** — the newest 100 spans live in `IoApi`, so a
 *     reload still shows what the app just did. This is the sink that works on
 *     GitHub Pages, where there is no backend at all.
 *   - **OTLP/HTTP export, off by default** — a real collector endpoint, opt-in
 *     per browser (`telemetry.export.toggle`). Nothing leaves the page until a
 *     human turns it on.
 *
 *  No `@opentelemetry/*` dependency: the wire format is the contract, and a
 *  ~200KB browser SDK to serialise 100 spans would cost every visitor more than
 *  it buys. Swapping in the real SDK later only replaces the aggregator.
 */

/** Spans buffered before a flush is forced. One frame of heavy interaction is
 *  low hundreds; 4096 only trips during a synchronous burst (import, replay). */
const BUFFER = 4096;
/** Bus names that would record their own recording. */
const SELF = 'telemetry.';

export type TelemetryApi = {
  /** The persisted ring, materialised. Cheap to call, not cheap enough to call per event. */
  spans(): TelemetrySpan[];
  /** What the portal draws: top event names, observed links, totals. */
  summary(): TelemetrySummary;
  config(): TelemetryConfig;
  setConfig(patch: Partial<TelemetryConfig>): void;
  /** OTLP `ResourceSpans` for the persisted ring. Async — it is built off-thread. */
  otlp(): Promise<unknown>;
  clear(): void;
  /** Called when a batch has been aggregated, not once per event. */
  onSummary(fn: (summary: TelemetrySummary) => void): () => void;
  /** True when aggregation really is on another thread. */
  parallel(): boolean;
};

declare module '../types' {
  interface CustomEvents {
    'telemetry.clear': void;
    'telemetry.export.toggle': void;
    'telemetry.copy': void;
  }
  /** Optional: absent when the `telemetry` flag is off. */
  interface CustomExposable { telemetry?: TelemetryApi }
}

/** One scalar worth naming the subject of an event. Four property reads, no
 *  object built — the full attribute set is derived at OTLP time instead. */
const subjectOf = (data: unknown): string | undefined => {
  if (data === null || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  const ref = record.ref as { id?: unknown } | undefined;
  const value = (ref && typeof ref === 'object' ? ref.id : undefined) ?? record.id ?? record.key ?? record.message;
  return typeof value === 'string' ? value : undefined;
};

/** The far side of the batch boundary: a worker when the platform has one, the
 *  same aggregator behind a macrotask when it doesn't. */
type Sink = {
  send(message: unknown, transfer?: Transferable[]): void;
  ask<T>(kind: 'summary' | 'spans' | 'otlp'): Promise<T>;
  parallel: boolean;
  stop(): void;
};

const workerSink = (onSummary: (s: TelemetrySummary) => void, onPersist: (json: string) => void): Sink | null => {
  if (typeof Worker !== 'function') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./telemetry.worker.ts', import.meta.url), { type: 'module' });
  } catch { return null; }
  const pending = new Map<number, (value: unknown) => void>();
  let nextId = 0;
  worker.onmessage = (event: MessageEvent<{ t: string; summary?: TelemetrySummary; json?: string; id?: number; value?: unknown }>) => {
    const message = event.data;
    if (message.t === 'summary' && message.summary) onSummary(message.summary);
    else if (message.t === 'persist' && message.json !== undefined) onPersist(message.json);
    else if (message.t === 'reply' && message.id !== undefined) {
      pending.get(message.id)?.(message.value);
      pending.delete(message.id);
    }
  };
  // A worker that fails to boot (CSP, bundler edge) must not take telemetry —
  // let alone the editor — down with it.
  worker.onerror = () => { pending.forEach(resolve => resolve(undefined)); pending.clear(); };
  return {
    parallel: true,
    send: (message, transfer) => worker.postMessage(message, transfer ?? []),
    ask<T>(kind: 'summary' | 'spans' | 'otlp') {
      const id = ++nextId;
      return new Promise<T>(resolve => {
        pending.set(id, value => resolve(value as T));
        worker.postMessage({ t: kind, id });
      });
    },
    stop: () => worker.terminate(),
  };
};

const inlineSink = (onSummary: (s: TelemetrySummary) => void, onPersist: (json: string) => void): Sink => {
  const aggregator: Aggregator = createAggregator({
    fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
    timeOrigin: performance.timeOrigin,
    onPersist,
  });
  const queue: unknown[] = [];
  let scheduled = false;
  const apply = (message: Record<string, unknown>) => {
    switch (message.t) {
      case 'config': aggregator.setConfig(message.config as Partial<TelemetryConfig>); break;
      case 'restore': aggregator.restore(message.json as string); break;
      case 'batch':
        aggregator.ingest(message.batch as SpanBatch);
        onSummary(aggregator.summary());
        break;
      case 'clear': aggregator.clear(); onSummary(aggregator.summary()); break;
    }
  };
  const drain = () => {
    scheduled = false;
    const batch = queue.splice(0, queue.length);
    batch.forEach(message => apply(message as Record<string, unknown>));
  };
  return {
    parallel: false,
    send(message) {
      queue.push(message);
      if (scheduled) return;
      scheduled = true;
      // A macrotask, not a microtask: the aggregation still lands after the
      // gesture that produced it, even without a second thread.
      setTimeout(drain, 0);
    },
    ask<T>(kind: 'summary' | 'spans' | 'otlp') {
      drain();
      const value = kind === 'summary' ? aggregator.summary() : kind === 'spans' ? aggregator.spans() : aggregator.otlp();
      return Promise.resolve(value as T);
    },
    stop: () => { queue.length = 0; },
  };
};

export function registerTelemetry(system: Registry) {
  system('telemetry', ({ on, bus, contexts, io, expose }) => {
    const config: TelemetryConfig = { ...DEFAULT_CONFIG, ...io.get(STORAGE_KEYS.telemetryConfig, {}) };
    const summaryListeners = new Set<(summary: TelemetrySummary) => void>();
    let summary: TelemetrySummary = { nodes: [], links: [], total: 0, last: '' };
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    let persistPending: string | null = null;

    const publish = (next: TelemetrySummary) => {
      summary = next;
      summaryListeners.forEach(fn => fn(next));
    };
    const persist = (json: string) => {
      // The JSON is built off-thread; the storage write is coalesced to once a
      // second because localStorage is synchronous and main-thread-only.
      persistPending = json;
      if (persistTimer) return;
      persistTimer = setTimeout(() => {
        persistTimer = null;
        if (persistPending === null) return;
        if (persistPending) io.set(STORAGE_KEYS.telemetry, persistPending);
        else io.del(STORAGE_KEYS.telemetry);
        persistPending = null;
      }, 1000);
    };

    const sink = workerSink(publish, persist) ?? inlineSink(publish, persist);
    sink.send({ t: 'config', config });
    const restored = io.get<string>(STORAGE_KEYS.telemetry, '');
    if (restored) sink.send({ t: 'restore', json: restored });

    // ---- capture: the only part that runs inline with user interaction ----
    const nameIds = new Map<string, number>();
    let nameCount = 0;
    let pendingNames: string[] = [];
    let pendingNameBase = 0;
    const buf = {
      nameId: new Uint32Array(BUFFER),
      depth: new Uint8Array(BUFFER),
      start: new Float64Array(BUFFER),
      end: new Float64Array(BUFFER),
      parentSeq: new Uint32Array(BUFFER),
      traceSeq: new Uint32Array(BUFFER),
      seq: new Uint32Array(BUFFER),
      subject: new Array<string | undefined>(BUFFER),
    };
    let count = 0;
    /** Buffer index of the span open at each depth, so a child can point at its
     *  parent and a returning dispatch can stamp the parent's end. */
    const openAt: number[] = [];
    let spanSeq = 0;
    let traceSeq = 0;
    let flushScheduled = false;

    const flush = () => {
      flushScheduled = false;
      if (!count) return;
      const batch: SpanBatch = {
        names: pendingNames,
        nameBase: pendingNameBase,
        count,
        nameId: buf.nameId.slice(0, count),
        depth: buf.depth.slice(0, count),
        start: buf.start.slice(0, count),
        end: buf.end.slice(0, count),
        parentSeq: buf.parentSeq.slice(0, count),
        traceSeq: buf.traceSeq.slice(0, count),
        seq: buf.seq.slice(0, count),
        subject: buf.subject.slice(0, count),
      };
      pendingNames = [];
      pendingNameBase = nameCount;
      count = 0;
      openAt.length = 0;
      sink.send({ t: 'batch', batch }, [
        batch.nameId.buffer, batch.depth.buffer, batch.start.buffer,
        batch.end.buffer, batch.parentSeq.buffer, batch.traceSeq.buffer, batch.seq.buffer,
      ]);
    };

    const record = (event: AnyEvent) => {
      const name = event.name as string;
      let id = nameIds.get(name);
      if (id === undefined) {
        if (name.charCodeAt(0) === 116 /* t */ && name.startsWith(SELF)) return;
        id = nameCount++;
        nameIds.set(name, id);
        pendingNames.push(name);
      }
      const depth = event.depth ?? 1;
      const at = event.at;
      // A dispatch returning to depth d means everything at or below d finished.
      for (let level = openAt.length; level >= depth; level--) {
        const slot = openAt[level - 1];
        if (slot !== undefined) buf.end[slot] = at;
      }
      openAt.length = depth - 1;
      if (depth === 1) traceSeq++;
      const parent = depth > 1 ? openAt[depth - 2] : undefined;
      const index = count++;
      buf.nameId[index] = id;
      buf.depth[index] = depth;
      buf.start[index] = at;
      buf.end[index] = at;
      buf.parentSeq[index] = parent === undefined ? 0 : buf.seq[parent];
      buf.traceSeq[index] = traceSeq;
      buf.seq[index] = ++spanSeq;
      buf.subject[index] = subjectOf(event.data);
      openAt[depth - 1] = index;
      if (count >= BUFFER) { flush(); return; }
      if (flushScheduled) return;
      flushScheduled = true;
      // The chain is synchronous, so the microtask runs once it has fully
      // unwound — every end time in the batch is final by then.
      queueMicrotask(flush);
    };

    /** The materialised ring, refreshed after each aggregated batch. Keeping it
     *  warm is what lets `spans()` stay synchronous across an async sink. */
    let lastSpans: TelemetrySpan[] = [];
    const api: TelemetryApi = {
      spans: () => lastSpans,
      summary: () => summary,
      config: () => ({ ...config }),
      setConfig(patch) {
        Object.assign(config, patch);
        io.set(STORAGE_KEYS.telemetryConfig, config);
        sink.send({ t: 'config', config });
      },
      async otlp() {
        flush();
        return sink.ask('otlp');
      },
      clear() {
        count = 0;
        openAt.length = 0;
        sink.send({ t: 'clear' });
      },
      onSummary(fn) {
        summaryListeners.add(fn);
        return () => summaryListeners.delete(fn);
      },
      parallel: () => sink.parallel,
    };
    void sink.ask<TelemetrySpan[]>('spans').then(value => { lastSpans = value ?? []; });
    expose('telemetry', api);

    contexts.commands.register([
      { id: 'telemetry.clear', label: 'Telemetry: clear recorded spans', group: 'telemetry' },
      { id: 'telemetry.export.toggle', label: 'Telemetry: toggle OTLP export', group: 'telemetry' },
      { id: 'telemetry.copy', label: 'Telemetry: copy OTLP JSON', group: 'telemetry' },
    ]);

    on('telemetry.clear', () => api.clear());
    on('telemetry.export.toggle', () => {
      api.setConfig({ export: !config.export });
      bus.emit('app.notice', {
        message: config.export ? `OTLP export on → ${config.endpoint}` : 'OTLP export off (spans stay in this browser)',
        level: 'info',
      });
    });
    on('telemetry.copy', () => {
      void api.otlp().then(payload => {
        void globalThis.navigator?.clipboard?.writeText?.(JSON.stringify(payload, null, 2)).catch(() => { /* clipboard denied */ });
        bus.emit('app.notice', { message: `Copied ${summary.total} spans as OTLP JSON`, level: 'info' });
      });
    });

    const offAny = bus.onAny(record);
    // Keep the materialised ring warm for the sync `spans()` accessor.
    const offSummary = api.onSummary(() => {
      void sink.ask<TelemetrySpan[]>('spans').then(value => { lastSpans = value ?? []; });
    });
    return () => {
      offAny();
      offSummary();
      flush();
      if (persistTimer) clearTimeout(persistTimer);
      if (persistPending) io.set(STORAGE_KEYS.telemetry, persistPending);
      summaryListeners.clear();
      sink.stop();
    };
  });
}
