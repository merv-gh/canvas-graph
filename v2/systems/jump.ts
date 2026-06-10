import type { Registry } from '../core';
import type { ItemRef } from '../types';

/** A single-file vimium-style jump mode.
 *
 *  Flow: `g` (or whatever the shortcut is rebound to) → unique letter overlays
 *  appear on every focusable item → pressing the matching letter focuses+fits
 *  the item → Enter or Escape cancels. Lives entirely in one file by leaning
 *  on:
 *
 *    - `contexts.itemTargets.all()`   → the canonical "what can I jump to" list
 *    - `contexts.itemOverlays.set()`  → renders the letter chips in screen-space
 *    - `contexts.keyboard.capture(id, {onKey})` → consumes keys without
 *      synthesising a DOM listener outside the input router
 *    - `view.fit.item: ItemRef`       → gently reveals the chosen item (any kind)
 *    - `focus.item.focus`             → standard focus event
 *
 *  Module augmentation declares the two events below so the typed bus accepts
 *  them; nothing in core.ts has to know "jump" exists. */
declare module '../types' {
  interface CustomEvents {
    'jump.start': void;
    'jump.cancel': void;
  }
}

const LETTERS = 'asdfghjklqwertyuiopzxcvbnm';

export function registerJump(system: Registry) {
  system('jump', ({ on, emit, contexts, origin }) => {
    let letterToRef: Map<string, ItemRef> | null = null;

    const cancel = () => {
      if (!letterToRef) return;
      letterToRef = null;
      contexts.itemOverlays.unregisterOrigin('jump');
      contexts.keyboard.unregisterOrigin('jump');
    };

    const start = () => {
      const targets = contexts.itemTargets.all().slice(0, LETTERS.length);
      if (!targets.length) return;
      const next = new Map<string, ItemRef>();
      const overlays = targets.map((target, i) => {
        const letter = LETTERS[i];
        next.set(letter, target.ref);
        return {
          ref: target.ref,
          text: letter.toUpperCase(),
          className: 'jump-letter',
          id: `jump-${letter}`,
        };
      });
      letterToRef = next;
      contexts.itemOverlays.set('jump', overlays);
      // Escape is handled by the global cancellation system; the Cancellable
      // registered below fires jump.cancel for us. Enter still cancels here
      // because we treat it as "I'm done, don't pick" — it's a positive intent
      // distinct from the global cancel signal.
      contexts.keyboard.capture('jump', {
        onKey(event) {
          if (event.key === 'Escape') return;  // global Esc handles it
          if (event.key === 'Enter') {
            event.preventDefault();
            emit('jump.cancel');
            return;
          }
          const letter = event.key.toLowerCase();
          if (!/^[a-z]$/.test(letter)) return;
          event.preventDefault();
          const ref = letterToRef?.get(letter);
          if (!ref) { emit('jump.cancel'); return; }
          emit('focus.item.focus', ref);
          emit('view.fit.item', ref);
          emit('jump.cancel');
        },
      });
    };

    contexts.commands.register([
      {
        id: 'jump.start',
        label: 'Jump to item',
        group: 'jump',
        shortcut: 'g',
        // `stop: true` so the same `g` keystroke doesn't also fall through to
        // `graph.switch.next`. DX will still emit `binding.duplicate` so the
        // conflict is visible — rebind either side from Help to silence it.
        input: { on: 'keydown', key: 'g', prevent: true, stop: true },
        available: () => contexts.itemTargets.all().length > 0,
      },
      {
        id: 'jump.cancel',
        label: 'Cancel jump',
        group: 'jump',
        hidden: true,
      },
    ]);

    on('jump.start', start);
    on('jump.cancel', cancel);
    contexts.cancellation.register({
      origin,
      active: () => !!letterToRef,
      cancel: () => emit('jump.cancel'),
    });

    return cancel;
  }, { requires: ['render.stage', 'graph', 'focus', 'view.zoom'] });
}
