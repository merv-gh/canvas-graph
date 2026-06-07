import type { Registry } from '../core';
import { Places } from '../types';

export function registerMain(system: Registry) {
  system('main', ({ on, emit, contexts }) => {
    const drawToolbar = () => emit('render.view.set', {
      place: Places.Top,
      key: 'toolbar',
      view: () => {
        const root = contexts.templates.clone('toolbar');
        const start = contexts.templates.slot(root, 'start');
        const end = contexts.templates.slot(root, 'end');
        contexts.affordances.for('top').forEach(aff => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.command = aff.command;
          button.textContent = aff.text ?? aff.command;
          if (aff.label) button.setAttribute('aria-label', aff.label);
          if (aff.className) button.classList.add(...aff.className.split(/\s+/).filter(Boolean));
          (aff.slot === 'end' ? end : start).append(button);
        });
        return root;
      },
    });
    on('app.start', () => { emit('render.shell'); drawToolbar(); });
    on('affordance.contributed', ({ surface }) => { if (surface === 'top') drawToolbar(); });
  });
}
