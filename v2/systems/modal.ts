import { appendRenderable, type Registry } from '../core';
import { Places } from '../types';
import type { AppEvents } from '../types';

export function registerModal(system: Registry) {
  system('modal', ({ on, emit, contexts, contribute, origin }) => {
    let open = false;
    contribute({ surface: 'top', command: 'modal.open', kind: 'button', text: 'Modal', order: 50 });
    contexts.commands.register([
      {
        id: 'modal.open',
        label: 'Open modal',
        event: 'modal.open',
        group: 'modal',
        payload: ({ target }) => ({ title: (target as HTMLElement)?.dataset.title, body: (target as HTMLElement)?.dataset.body, visual: (target as HTMLElement)?.dataset.visual as AppEvents['modal.open']['visual'] }),
      },
      // No own Escape binding — modal registers a Cancellable below. The
      // command stays callable from backdrop click and the Close button.
      { id: 'modal.close', label: 'Close modal', event: 'modal.close', group: 'modal' },
    ]);
    contexts.cancellation.register({
      origin,
      active: () => open,
      cancel: () => emit('modal.close'),
    });

    on('modal.close', () => {
      open = false;
      emit('render.view.set', { place: Places.Modal, key: 'modal', view: '' });
    });
    on('modal.open', ({ title = 'Modal', body = '', visual = 'panel' }) => {
      open = true;
      emit('render.view.set', {
        place: Places.Modal,
        key: 'modal',
        view: () => {
          const modal = contexts.templates.clone('modal');
          modal.dataset.visual = visual;
          contexts.templates.text(modal, 'title', title);
          appendRenderable(contexts.templates.slot(modal, 'body'), body);
          return modal;
        },
      });
      queueMicrotask(() => (contexts.places.el(Places.Modal)?.querySelector('[autofocus]') as HTMLElement | null)?.focus());
    });
  });
}
