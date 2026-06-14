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
      queueMicrotask(() => (contexts.places.el(Places.Modal)?.querySelector('[autofocus]') as HTMLElement | null)?.focus());
    });
  }, { requires: ['render'] });
}
