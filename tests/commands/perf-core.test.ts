import { describe, expect, it } from 'vitest';
import { graphStore } from '../../frontend/model';
import { bindPerfTarget, createAppPerf, createPerfApi, installGraphPerf, installMethodPerf } from '../../frontend/core/perf';

describe('perf core', () => {
  it('records counts, samples, marks, and timings only when enabled', () => {
    const perf = createPerfApi(false);
    perf.count('cold');
    perf.sample('size', 3);
    perf.mark('cold-mark');

    expect(perf.snapshot().counts).toEqual([]);

    perf.setEnabled(true);
    const value = perf.measure('work', () => 42);
    perf.count('items', 2);
    perf.count('items');
    perf.sample('size', 4);
    perf.sample('size', 8);
    perf.sample('bad', Number.POSITIVE_INFINITY);
    perf.mark('ready');

    const snap = perf.snapshot();
    expect(value).toBe(42);
    expect(snap.enabled).toBe(true);
    expect(snap.timings.find(row => row.label === 'work')?.calls).toBe(1);
    expect(snap.timeline.find(row => row.label === 'work')).toBeTruthy();
    expect(snap.counts).toContainEqual({ label: 'items', count: 3 });
    expect(snap.samples).toContainEqual({ label: 'size', samples: 2, min: 4, max: 8, avg: 6, last: 8 });
    expect(snap.samples.some(row => row.label === 'bad')).toBe(false);
    expect(snap.marks[0]?.label).toBe('ready');

    perf.reset();
    expect(perf.snapshot()).toMatchObject({ timings: [], counts: [], samples: [], marks: [], timeline: [], inputs: [], longTasks: [] });
  });

  it('records nested call graph spans and input-delay rows', () => {
    const perf = createPerfApi(true);
    const button = document.createElement('button');
    button.className = 'node-action';
    button.dataset.itemKind = 'node';
    button.dataset.itemId = 'e1';
    document.body.append(button);

    perf.measure('outer', () => perf.measure('inner', () => undefined));
    const event = new Event('pointerdown');
    const trace = perf.beginInput('pointerdown', event, button);
    trace?.end({ candidates: ['drag.item.move', 'drag.item.end'], matched: ['drag.item.move'] });
    perf.recordInput({
      source: 'event-timing',
      name: 'pointerup',
      target: 'button.node-action',
      startTime: 1,
      processingStart: 3,
      processingEnd: 4,
      duration: 8,
      inputDelay: 2,
      processingDuration: 1,
      presentationDelay: 5,
      interactionId: 7,
    });
    perf.recordLongTask({ name: 'self', start: 10, duration: 60 });

    const snap = perf.snapshot();
    expect(snap.callGraph).toContainEqual(expect.objectContaining({ from: 'outer', to: 'inner', calls: 1 }));
    expect(snap.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'router',
        name: 'pointerdown',
        target: expect.stringContaining('button.node-action'),
        candidates: ['drag.item.move', 'drag.item.end'],
        matched: ['drag.item.move'],
        path: expect.arrayContaining([expect.stringContaining('button.node-action')]),
      }),
      expect.objectContaining({ source: 'event-timing', inputDelay: 2, presentationDelay: 5, interactionId: 7 }),
    ]));
    expect(snap.longTasks).toContainEqual(expect.objectContaining({ name: 'self', duration: 60 }));
    button.remove();
  });

  it('records measured failures via finally', () => {
    const perf = createPerfApi(true);
    expect(() => perf.measure('throws', () => {
      throw new Error('boom');
    })).toThrow('boom');

    expect(perf.snapshot().timings.find(row => row.label === 'throws')?.calls).toBe(1);
  });

  it('wraps bound object methods once', () => {
    class Counter {
      value = 0;
      add(by: number) {
        this.value += by;
        return this.value;
      }
    }

    installMethodPerf(Counter.prototype, 'Counter', ['add', 'missing']);
    installMethodPerf(Counter.prototype, 'Counter', ['add']);

    const counter = new Counter();
    const perf = createPerfApi(true);
    bindPerfTarget(counter, perf);

    expect(counter.add(2)).toBe(2);
    expect(counter.add(3)).toBe(5);

    const row = perf.snapshot().timings.find(item => item.label === 'Counter.add');
    expect(row?.calls).toBe(2);
  });

  it('enables app perf from flags and instruments graph stores', () => {
    const perf = createAppPerf({ perf: true });
    const graphs = graphStore();

    installGraphPerf(graphs, perf);
    const first = graphs.current.createNode({ Label: { text: 'A' } });
    const second = graphs.current.createNode({ Label: { text: 'B' } });
    graphs.current.createEdge({ From: first.id, To: second.id });
    graphs.current.edgesOf(first.id);
    graphs.create('extra').nodes();
    graphs.switch('switched').nodes();

    const labels = perf.snapshot().timings.map(row => row.label);
    expect(labels).toContain('Graph.createNode');
    expect(labels).toContain('Graph.createEdge');
    expect(labels).toContain('Graph.edgesOf');
    expect(labels).toContain('Graph.nodes');
  });
});
