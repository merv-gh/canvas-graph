/** Telemetry aggregation — pure, DOM-free, and deliberately off the main thread.
 *
 *  The interaction path only ever *writes columns*: an interned name id, a
 *  depth, two timestamps and a sequence number, into preallocated typed arrays.
 *  Everything that costs real money — grouping, causality counting, OTLP
 *  serialisation, JSON for persistence, the HTTP POST — happens here, behind a
 *  batch boundary, in a worker when the platform has one.
 *
 *  Ids are derived from sequence numbers, not stored: a span's 128-bit trace id
 *  is `<session prefix><trace seq>` and its 64-bit span id `<prefix><span seq>`.
 *  So the hot path never formats a string, and the wire format still gets real
 *  OTLP ids.
 */

/** Columns for a run of spans. Typed arrays so a batch can be transferred to a
 *  worker instead of copied, and so capture allocates nothing per event. */
export type SpanBatch = {
  /** Names interned since the last batch; `names[i]` has id `nameBase + i`. */
  names: string[];
  nameBase: number;
  count: number;
  nameId: Uint32Array;
  depth: Uint8Array;
  start: Float64Array;
  end: Float64Array;
  /** Span sequence of the parent dispatch, 0 for a root. */
  parentSeq: Uint32Array;
  traceSeq: Uint32Array;
  seq: Uint32Array;
  /** One scalar worth naming the subject (item id, place, message). */
  subject: (string | undefined)[];
};

export type TelemetryConfig = {
  /** POST spans to `endpoint`. Off by default — the deployed build is frontend-only. */
  export: boolean;
  endpoint: string;
  serviceName: string;
  /** Spans per OTLP POST. */
  batch: number;
};

/** What the UI needs, and nothing else: small, and posted at most a few times a
 *  second rather than once per event. */
export type TelemetrySummary = {
  /** `[name, count, depth, lastStart]`, most frequent first. */
  nodes: [string, number, number, number][];
  /** `[parentName, childName, count]`. */
  links: [string, string, number][];
  total: number;
  last: string;
};

/** A span, materialised. Only built when something actually asks — a panel
 *  drawing 26 boxes or an OTLP export, never per event. */
export type TelemetrySpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** `performance.now()` milliseconds. Epoch nanos are an OTLP-time concern. */
  start: number;
  end: number;
  attributes: Record<string, string | number | boolean>;
};

export const DEFAULT_CONFIG: TelemetryConfig = {
  export: false,
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'ecs-canvas-graph',
  batch: 64,
};

/** Spans kept in the persisted ring. */
export const KEEP = 100;

const hexPrefix = (bytes: number) => {
  const buffer = new Uint8Array(bytes);
  const source = globalThis.crypto;
  if (source?.getRandomValues) source.getRandomValues(buffer);
  else for (let i = 0; i < bytes; i++) buffer[i] = Math.floor(Math.random() * 256);
  return [...buffer].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const idCodec = (prefix = hexPrefix(12)) => ({
  prefix,
  trace: (seq: number) => prefix + seq.toString(16).padStart(8, '0'),
  span: (seq: number) => prefix.slice(0, 8) + seq.toString(16).padStart(8, '0'),
});

/** Facts are past-tense, requests imperative (PRINCIPLES 15). Derived once per
 *  distinct name, not once per event. */
export const kindOf = (name: string) =>
  /\.(created|updated|deleted|switched|selected|focused|changed|moved|imported|started|opened|closed|recorded)$/.test(name) ? 'fact' : 'request';
export const channelOf = (name: string) => name.split('.')[0] || 'app';

const otlpValue = (value: string | number | boolean) =>
  typeof value === 'number' ? (Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value })
    : typeof value === 'boolean' ? { boolValue: value }
    : { stringValue: value };

const nanosAt = (relativeMs: number, timeOrigin: number) =>
  String(Math.round((timeOrigin + relativeMs) * 1e6));

export const toOtlp = (spans: TelemetrySpan[], serviceName: string, timeOrigin: number) => ({
  resourceSpans: [{
    resource: {
      attributes: [
        { key: 'service.name', value: { stringValue: serviceName } },
        { key: 'telemetry.sdk.language', value: { stringValue: 'webjs' } },
        { key: 'telemetry.sdk.name', value: { stringValue: 'ecs-canvas-graph-bus' } },
      ],
    },
    scopeSpans: [{
      scope: { name: 'frontend.bus' },
      spans: spans.map(span => ({
        traceId: span.traceId,
        spanId: span.spanId,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        name: span.name,
        kind: 1,
        startTimeUnixNano: nanosAt(span.start, timeOrigin),
        endTimeUnixNano: nanosAt(span.end, timeOrigin),
        attributes: Object.entries(span.attributes).map(([key, value]) => ({ key, value: otlpValue(value) })),
      })),
    }],
  }],
});

/** The persisted shape: names once, spans as number tuples. ~6× smaller than an
 *  array of span objects, which matters when it goes through JSON twice (write
 *  and read) inside a 5MB localStorage budget. */
export type PersistedSpans = {
  v: 1;
  prefix: string;
  origin: number;
  n: string[];
  s: [number, number, number, number, number, number, number, string | null][];
};

/** One ring of columns. Fixed capacity, wraps, never allocates while writing. */
export class SpanRing {
  readonly nameId: Uint32Array;
  readonly depth: Uint8Array;
  readonly start: Float64Array;
  readonly end: Float64Array;
  readonly parentSeq: Uint32Array;
  readonly traceSeq: Uint32Array;
  readonly seq: Uint32Array;
  readonly subject: (string | undefined)[];
  /** Total spans ever written; `size` and the read order come from it. */
  written = 0;

  constructor(readonly capacity: number) {
    this.nameId = new Uint32Array(capacity);
    this.depth = new Uint8Array(capacity);
    this.start = new Float64Array(capacity);
    this.end = new Float64Array(capacity);
    this.parentSeq = new Uint32Array(capacity);
    this.traceSeq = new Uint32Array(capacity);
    this.seq = new Uint32Array(capacity);
    this.subject = new Array(capacity);
  }

  /** Index of the slot the next write lands in. */
  get head() { return this.written % this.capacity; }
  get size() { return Math.min(this.written, this.capacity); }

  push(nameId: number, depth: number, start: number, parentSeq: number, traceSeq: number, seq: number, subject?: string) {
    const at = this.head;
    this.nameId[at] = nameId;
    this.depth[at] = depth;
    this.start[at] = start;
    this.end[at] = start;
    this.parentSeq[at] = parentSeq;
    this.traceSeq[at] = traceSeq;
    this.seq[at] = seq;
    this.subject[at] = subject;
    this.written++;
    return at;
  }

  /** Oldest-first slot indices. */
  order() {
    const size = this.size;
    const first = this.written <= this.capacity ? 0 : this.head;
    const out = new Array<number>(size);
    for (let i = 0; i < size; i++) out[i] = (first + i) % this.capacity;
    return out;
  }
}

export type AggregatorOptions = {
  fetchImpl?: typeof fetch;
  timeOrigin?: number;
  /** Called with the JSON to persist; the host owns storage (workers have none). */
  onPersist?: (json: string) => void;
};

/** Everything expensive about telemetry, in one object that can live anywhere:
 *  a worker (normal), or the main thread behind a macrotask (fallback). */
export function createAggregator(options: AggregatorOptions = {}) {
  const timeOrigin = options.timeOrigin ?? 0;
  const doFetch = options.fetchImpl;
  let config: TelemetryConfig = { ...DEFAULT_CONFIG };
  let codec = idCodec();
  const names: string[] = [];
  const counts: number[] = [];
  const kinds: string[] = [];
  const lastStart: number[] = [];
  const lastDepth: number[] = [];
  /** `parentNameId * 65536 + childNameId` → count. Numeric key, no strings. */
  const links = new Map<number, number>();
  const ring = new SpanRing(KEEP);
  /** Span seq → name id, for the last few thousand, so a child can name its
   *  parent without the parent still being in the persisted ring. */
  const parentNames = new Map<number, number>();
  const pendingExport: TelemetrySpan[] = [];
  let total = 0;
  let lastName = '';

  const noteName = (id: number, name: string) => {
    while (names.length <= id) {
      names.push('');
      counts.push(0);
      kinds.push('request');
      lastStart.push(0);
      lastDepth.push(1);
    }
    if (!names[id]) {
      names[id] = name;
      kinds[id] = kindOf(name);
    }
  };

  const spanAt = (slot: number): TelemetrySpan => {
    const id = ring.nameId[slot];
    const name = names[id] ?? '?';
    const parentSeq = ring.parentSeq[slot];
    const subject = ring.subject[slot];
    const attributes: Record<string, string | number | boolean> = {
      'app.event.name': name,
      'app.event.kind': kinds[id] ?? kindOf(name),
      'app.event.channel': channelOf(name),
      'app.event.depth': ring.depth[slot],
    };
    if (subject != null) attributes['app.subject'] = subject;
    return {
      traceId: codec.trace(ring.traceSeq[slot]),
      spanId: codec.span(ring.seq[slot]),
      ...(parentSeq ? { parentSpanId: codec.span(parentSeq) } : {}),
      name,
      start: ring.start[slot],
      end: ring.end[slot],
      attributes,
    };
  };

  const spans = () => ring.order().map(spanAt);

  const persist = () => {
    if (!options.onPersist) return;
    const payload: PersistedSpans = {
      v: 1,
      prefix: codec.prefix,
      origin: timeOrigin,
      n: names,
      s: ring.order().map(slot => [
        ring.nameId[slot], ring.depth[slot],
        Math.round(ring.start[slot]), Math.round(ring.end[slot]),
        ring.parentSeq[slot], ring.traceSeq[slot], ring.seq[slot],
        ring.subject[slot] ?? null,
      ] as PersistedSpans['s'][number]),
    };
    options.onPersist(JSON.stringify(payload));
  };

  const flushExport = async () => {
    if (!config.export || !pendingExport.length || !doFetch) return;
    const batch = pendingExport.splice(0, config.batch);
    try {
      await doFetch(config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toOtlp(batch, config.serviceName, timeOrigin)),
        keepalive: true,
      });
    } catch {
      // A collector that isn't there must never reach the editor. The batch is
      // dropped on purpose: retrying a dead endpoint only grows a queue.
    }
  };

  return {
    setConfig(patch: Partial<TelemetryConfig>) { config = { ...config, ...patch }; },
    config: () => ({ ...config }),

    ingest(batch: SpanBatch) {
      batch.names.forEach((name, index) => noteName(batch.nameBase + index, name));
      for (let i = 0; i < batch.count; i++) {
        const id = batch.nameId[i];
        noteName(id, names[id] || '?');
        counts[id]++;
        lastStart[id] = batch.start[i];
        lastDepth[id] = batch.depth[i];
        const slot = ring.push(id, batch.depth[i], batch.start[i], batch.parentSeq[i], batch.traceSeq[i], batch.seq[i], batch.subject[i]);
        ring.end[slot] = batch.end[i];
        parentNames.set(batch.seq[i], id);
        const parentId = batch.parentSeq[i] ? parentNames.get(batch.parentSeq[i]) : undefined;
        if (parentId !== undefined) {
          const key = parentId * 65536 + id;
          links.set(key, (links.get(key) ?? 0) + 1);
        }
        total++;
        lastName = names[id] ?? lastName;
        if (config.export) pendingExport.push(spanAt(slot));
      }
      // Bound the parent index the same way the ring is bounded.
      if (parentNames.size > KEEP * 8) {
        const cutoff = batch.seq[batch.count - 1] - KEEP * 4;
        for (const seq of parentNames.keys()) if (seq < cutoff) parentNames.delete(seq);
      }
      if (config.export && pendingExport.length >= config.batch) void flushExport();
      persist();
    },

    summary(limit = 40): TelemetrySummary {
      const nodes: [string, number, number, number][] = [];
      for (let id = 0; id < names.length; id++) {
        if (!counts[id]) continue;
        nodes.push([names[id], counts[id], lastDepth[id], lastStart[id]]);
      }
      nodes.sort((a, b) => b[1] - a[1]);
      const top = nodes.slice(0, limit);
      const visible = new Set(top.map(node => node[0]));
      const out: [string, string, number][] = [];
      links.forEach((count, key) => {
        const from = names[Math.floor(key / 65536)];
        const to = names[key % 65536];
        if (from && to && visible.has(from) && visible.has(to)) out.push([from, to, count]);
      });
      return { nodes: top, links: out, total, last: lastName };
    },

    spans,
    otlp: () => toOtlp(spans(), config.serviceName, timeOrigin),
    flushExport,

    /** Rehydrate the persisted ring so a reload still shows the last session. */
    restore(json: string) {
      try {
        const payload = JSON.parse(json) as PersistedSpans;
        if (payload?.v !== 1) return;
        codec = idCodec(payload.prefix);
        payload.n.forEach((name, id) => noteName(id, name));
        payload.s.forEach(([nameId, depth, start, end, parentSeq, traceSeq, seq, subject]) => {
          noteName(nameId, names[nameId] || '?');
          counts[nameId]++;
          lastStart[nameId] = start;
          lastDepth[nameId] = depth;
          const slot = ring.push(nameId, depth, start, parentSeq, traceSeq, seq, subject ?? undefined);
          ring.end[slot] = end;
          total++;
          lastName = names[nameId] ?? lastName;
        });
      } catch { /* a corrupt ring is not worth a broken boot */ }
    },

    clear() {
      names.length = 0;
      counts.length = 0;
      kinds.length = 0;
      lastStart.length = 0;
      lastDepth.length = 0;
      links.clear();
      parentNames.clear();
      pendingExport.length = 0;
      ring.written = 0;
      total = 0;
      lastName = '';
      options.onPersist?.('');
    },
  };
}

export type Aggregator = ReturnType<typeof createAggregator>;
