import type { AnyEvent, Bus, EventName } from '../types';

/** A single emitted event captured by the recorder. */
export type TraceEvent = { name: EventName; data: unknown; at: number };
export type Trace = TraceEvent[];

export type Recorder = {
  /** Start collecting events. Idempotent — re-calling resets the buffer. */
  start(): void;
  /** Stop collecting and return the accumulated trace. */
  stop(): Trace;
  /** Read the current trace without stopping. */
  current(): Trace;
  /** Filter helper for assertions. */
  byName(name: EventName): TraceEvent[];
};

export type SimApi = {
  /** Begin recording every event that flows through the bus. */
  record(): Recorder;
  /** Replay a trace by re-firing each event in order. Used for golden tests and
   *  for plugging recorded user sessions back into a fresh boot. */
  replay(trace: Trace): void;
  /** Convenience: fire a sequence of events synchronously. */
  emitMany(events: { name: EventName; data?: unknown }[]): void;
  /** Event names emitted at least once but with zero subscribers — likely dead code. */
  orphanEmits(): string[];
  /** Event names subscribed to but never emitted in this session — likely dead listener. */
  silentListeners(): string[];
};

type InstrumentedBus = Bus & { _subscribed: Set<string>; _emitted: Set<string> };

/** Build a sim harness for a running AppCtx-bus. The harness piggy-backs on bus.onAny
 *  and bus.forward — no event-loop hacking. Safe to leave on in dev; opt-in in prod. */
export function createSim(bus: Bus): SimApi {
  const instrumented = bus as InstrumentedBus;
  return {
    record(): Recorder {
      let buffer: Trace = [];
      let active = false;
      const off = bus.onAny((event: AnyEvent) => { if (active) buffer.push({ name: event.name, data: event.data, at: event.at }); });
      void off;
      return {
        start() { buffer = []; active = true; },
        stop() { active = false; return buffer; },
        current() { return buffer.slice(); },
        byName(name) { return buffer.filter(event => event.name === name); },
      };
    },
    replay(trace) { trace.forEach(event => bus.forward(event.name, event.data)); },
    emitMany(events) { events.forEach(event => bus.forward(event.name, event.data)); },
    orphanEmits: () => [...instrumented._emitted].filter(name => !instrumented._subscribed.has(name)),
    silentListeners: () => [...instrumented._subscribed].filter(name => !instrumented._emitted.has(name)),
  };
}
