import { appendRenderable, type Registry } from '../core';
import { Places } from '../types';
import type { Renderable } from '../types';

export function registerModal(system: Registry) {
  system('modal', ({ on, emit, contexts, origin }) => {
    let open = false;
    // `modal.open` is an event other systems emit (commandForm, configurable,
    // debug) — not a user command, so it has no toolbar button. Only `modal.close`
    // is a real command (backdrop / Close button / Escape via the Cancellable).
    contexts.commands.register([
      { id: 'modal.close', label: 'Close modal', group: 'modal' },
    ]);
    contexts.cancellation.register({
      origin,
      active: () => open,
      cancel: () => emit('modal.close'),
    });

    on('modal.close', () => {
      open = false;
      emit('render.view.clear', { place: Places.Modal, key: 'modal' });
    });
    on('modal.open', ({ title = 'Modal', body, visual = 'panel' }) => {
      open = true;
      const bodyRenderable: Renderable | undefined = body;
      emit('render.view.set', {
        place: Places.Modal,
        key: 'modal',
        view: () => {
          const modal = contexts.templates.clone('modal');
          modal.dataset.visual = visual;
          contexts.templates.text(modal, 'title', title);
          if (bodyRenderable) appendRenderable(contexts.templates.slot(modal, 'body'), bodyRenderable);
          return modal;
        },
      });
      // Focus the first field on open so every modal is keyboard-ready without
      // a mouse click. Prefer an explicit [autofocus], else the first focusable
      // control (any modal with fields is safe; a button-only modal stays put).
      queueMicrotask(() => {
        const root = contexts.places.el(Places.Modal);
        const target = root?.querySelector('[autofocus]')
          ?? root?.querySelector('input:not([type="hidden"]):not([disabled]), textarea, select');
        (target as HTMLElement | null)?.focus();
      });
    });
  }, { requires: ['render'] });
}
