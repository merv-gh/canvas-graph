import { isStageSurface, type Registry } from '../core';
import { Places } from '../types';

/** Owns the two app-wide cancellation triggers. Both fire `app.cancel`, which
 *  the cancellation context routes to the topmost active Cancellable. Systems
 *  that want to opt into Esc / background-click cancellation only have to
 *  register a Cancellable via `contexts.cancellation.register(...)` — they
 *  never wire their own Escape binding. */
export function registerCancellation(system: Registry) {
  system('cancellation', ({ contexts }) => {
    contexts.commands.register([
      {
        id: 'app.cancel.escape',
        label: 'Cancel current action',
        event: 'app.cancel',
        group: 'app',
        shortcut: 'Esc',
        // global: true so the binding still fires while a text input or the
        // keyboard.capture input is focused. prevent: true so picker/jump's
        // captured input doesn't swallow it.
        input: { on: 'keydown', key: 'Escape', global: true, prevent: true },
      },
      {
        id: 'app.cancel.background',
        label: 'Cancel on canvas background click',
        event: 'app.cancel',
        group: 'app',
        hidden: true,
        input: { on: 'pointerdown', selector: `[data-place="${Places.Stage}"]`, when: isStageSurface },
      },
    ]);
  });
}
