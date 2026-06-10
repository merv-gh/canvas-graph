import { appendRenderable, type Registry } from '../core';
import { Places } from '../types';
import type { AppEvents, Renderable } from '../types';

export function registerModal(system: Registry) {
  system('modal', ({ on, emit, contexts, contribute, origin }) => {
    let open = false;
    contribute({ surface: 'top', command: 'modal.open', kind: 'button', text: 'Modal', order: 50 });
    contexts.commands.register([
      {
        id: 'modal.open',
        label: 'Open modal',
        group: 'modal',
        payload: ({ target }) => ({ title: (target as HTMLElement)?.dataset.title, visual: (target as HTMLElement)?.dataset.visual as AppEvents['modal.open']['visual'] }),
      },
      // No own Escape binding — modal registers a Cancellable below. The
      // command stays callable from backdrop click and the Close button.
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
