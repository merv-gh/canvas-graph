import type { Bus } from '../types';
import { cancellationFacet, type Cancellable } from './cancellation';
import { keyboardCaptureFacet, type KeyboardCapture, type KeyboardCaptureOptions } from './keyboard';

export type { Cancellable } from './cancellation';
export type { KeyboardCapture, KeyboardCaptureOptions } from './keyboard';

/** Who owns the interaction right now.
 *
 *  Three facets of one question, kept separately typed (PRINCIPLES 19) but
 *  behind one context so nobody has to ask two objects and hope they agree:
 *
 *   - `keys`     — exclusive keyboard capture (jump, letter pickers).
 *   - `editing`  — an inline text edit is in progress *somewhere*; the input
 *                  router and any command guard read this instead of trying to
 *                  infer it from one event's target, which is what let global
 *                  shortcuts fire in the middle of a rename.
 *   - `cancel`   — the Escape / background-click stack.
 *
 *  They travel together because they are the same decision seen from three
 *  sides: what does this keystroke belong to, and what does Escape undo? */
export function interactionContext(bus: Bus) {
  const keys = keyboardCaptureFacet();
  const cancel = cancellationFacet(bus);
  /** origin → is that origin mid-edit. A claim, not a guess: the owner says
   *  when it starts and stops, and stale claims are impossible because the
   *  predicate is re-evaluated, never cached. */
  const claims = new Map<string, () => boolean>();
  const editing = {
    claim(origin: string, isEditing: () => boolean) {
      claims.set(origin, isEditing);
      return () => { if (claims.get(origin) === isEditing) claims.delete(origin); };
    },
    /** True while any registered editor holds a live caret. */
    active: () => {
      for (const isEditing of claims.values()) if (isEditing()) return true;
      return false;
    },
    /** Devtools/test surface — which origins claim an edit right now. */
    owners: () => [...claims].filter(([, isEditing]) => isEditing()).map(([origin]) => origin),
  };
  return {
    keys,
    editing,
    cancel,
    unregisterOrigin(origin: string) {
      keys.unregisterOrigin(origin);
      cancel.unregisterOrigin(origin);
      claims.delete(origin);
    },
  };
}

export type InteractionApi = ReturnType<typeof interactionContext>;
export type { Bus };
