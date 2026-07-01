import type { Bus } from '../types';

/** A registrant of the cancellation stack. `active()` decides whether the
 *  cancellable currently has something to back out of; `cancel()` does the
 *  backing out. `priority` lets "transient" modes (modal, picker, jump,
 *  edit) override ambient ones (a passive selection) on the same Escape
 *  press. Higher priority wins. Default 0; selection uses -10 to act as the
 *  base layer that only fires when nothing else is active. */
export type Cancellable = {
  origin: string;
  priority?: number;
  active: () => boolean;
  cancel: () => void;
  /** When false, a stage background-click does NOT cancel this (only Escape
   *  does). Zen mode uses this so it persists until an explicit exit. */
  background?: boolean;
};

/** First-class cancellation. Any system that has an "active mode" (modal open,
 *  picker running, edit-in-place, selection set, jump letters showing) registers
 *  a Cancellable. The cancellation system fires `app.cancel` on Escape or stage
 *  background click; this context picks the highest-priority active handler
 *  (ties broken by most-recently-registered) and runs its cancel.
 *
 *  One handler per Escape: peel one layer at a time. Press Escape again to peel
 *  the next. Predictable and easy to test. */
export function cancellationContext(bus: Bus) {
  const handlers: Cancellable[] = [];
  bus.on('app.cancel', (payload) => {
    const fromBackground = payload?.source === 'background';
    let chosen: Cancellable | null = null;
    for (let i = handlers.length - 1; i >= 0; i--) {
      const handler = handlers[i];
      if (!handler.active()) continue;
      if (fromBackground && handler.background === false) continue;
      if (!chosen || (handler.priority ?? 0) > (chosen.priority ?? 0)) chosen = handler;
    }
    chosen?.cancel();
  });
  return {
    register(handler: Cancellable) {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    unregisterOrigin(origin: string) {
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i].origin === origin) handlers.splice(i, 1);
      }
    },
    /** Devtools/test surface — which cancellables claim to be active right now. */
    active: () => handlers.filter(handler => handler.active()).map(handler => handler.origin),
    /** Devtools/test surface — every registered cancellable's origin. */
    all: () => handlers.map(handler => handler.origin),
  };
}
