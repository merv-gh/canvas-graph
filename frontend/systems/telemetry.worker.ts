/// <reference lib="webworker" />
import { createAggregator, type SpanBatch, type TelemetryConfig } from '../core/telemetry-core';

/** Thin shell around the aggregator: everything expensive about telemetry runs
 *  here, one thread away from the interaction the editor is measuring. The
 *  logic lives in `core/telemetry-core.ts` so it is testable without a worker
 *  and reusable as the in-process fallback. */

type Incoming =
  | { t: 'config'; config: Partial<TelemetryConfig> }
  | { t: 'restore'; json: string }
  | { t: 'batch'; batch: SpanBatch }
  | { t: 'summary'; id: number; limit?: number }
  | { t: 'spans'; id: number }
  | { t: 'otlp'; id: number }
  | { t: 'clear' };

const scope = self as unknown as DedicatedWorkerGlobalScope;

const aggregator = createAggregator({
  fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
  timeOrigin: performance.timeOrigin,
  onPersist: json => scope.postMessage({ t: 'persist', json }),
});

scope.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  switch (message.t) {
    case 'config': aggregator.setConfig(message.config); break;
    case 'restore': aggregator.restore(message.json); break;
    case 'batch':
      aggregator.ingest(message.batch);
      scope.postMessage({ t: 'summary', summary: aggregator.summary() });
      break;
    case 'summary': scope.postMessage({ t: 'reply', id: message.id, value: aggregator.summary(message.limit) }); break;
    case 'spans': scope.postMessage({ t: 'reply', id: message.id, value: aggregator.spans() }); break;
    case 'otlp': scope.postMessage({ t: 'reply', id: message.id, value: aggregator.otlp() }); break;
    case 'clear':
      aggregator.clear();
      scope.postMessage({ t: 'summary', summary: aggregator.summary() });
      break;
  }
};
