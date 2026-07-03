export type FrameCallback = (timestamp: DOMHighResTimeStamp) => void;

export type FrameLoop = {
  schedule(id: string, callback: FrameCallback, priority?: number): void;
  cancel(id: string): void;
  hasPending(): boolean;
};

type QueueItem = { callback: FrameCallback; priority: number };

export function createFrameLoop(): FrameLoop {
  const queue = new Map<string, QueueItem>();
  let scheduled = false;

  const flush = (timestamp: DOMHighResTimeStamp) => {
    const batch = [...queue.entries()]
      .sort(([, a], [, b]) => a.priority - b.priority || 0)
      .map(([id, item]) => ({ id, ...item }));
    queue.clear();
    scheduled = false;
    for (const { callback } of batch) {
      callback(timestamp);
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
  };
}
