export type FrameCallback = (timestamp: DOMHighResTimeStamp) => void;

export type FrameLoop = {
  schedule(id: string, callback: FrameCallback, priority?: number): void;
  cancel(id: string): void;
  hasPending(): boolean;
  /** Run the pending queue NOW instead of waiting for rAF. For tests, tools,
   *  and throttled/hidden pages where rAF may be frozen for seconds. */
  flushNow(): void;
};

type QueueItem = { callback: FrameCallback; priority: number };

export function createFrameLoop(debugLog: () => boolean = () => false): FrameLoop {
  const queue = new Map<string, QueueItem>();
  let scheduled = false;
  let lastFlush = 0;

  const flush = (timestamp: DOMHighResTimeStamp) => {
    const batch = [...queue.entries()]
      .sort(([, a], [, b]) => a.priority - b.priority || 0)
      .map(([id, item]) => ({ id, ...item }));
    queue.clear();
    scheduled = false;
    const gap = lastFlush ? timestamp - lastFlush : 0;
    lastFlush = timestamp;
    // Gated: background tabs legitimately gap for minutes (rAF throttling) —
    // unconditional logging turned that into console spam for every user.
    if (gap > 50 && debugLog())
      console.debug(`[frameLoop] gap=${gap.toFixed(1)}ms queue=${batch.length} [${batch.map(b => b.id).join(',')}]`);
    for (const { id, callback } of batch) {
      try { callback(timestamp); } catch (e) {
        console.error(`[frameLoop] ${id} threw:`, e);
      }
    }
    if (queue.size > 0) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };

  return {
    schedule(id, callback, priority = 0) {
      queue.set(id, { callback, priority });
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    },
    cancel(id) {
      queue.delete(id);
    },
    hasPending() {
      return queue.size > 0;
    },
    flushNow() {
      if (!queue.size) return;
      scheduled = false; // a frozen rAF firing later just runs an empty pass
      flush(performance.now());
    },
  };
}
