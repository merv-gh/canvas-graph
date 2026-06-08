import { clientPoint, isStageSurface, type Registry } from '../core';
import { Places } from '../types';
import type { Position, ViewState } from '../types';

declare module '../types' {
  interface CustomEvents {
    'view.pan.start': Position;
    'view.pan.move': Position;
    'view.pan.end': void;
  }
}

export function registerViewPan(system: Registry) {
  system('view.pan', ({ on, emit, contexts }) => {
    let pan: { pointer: { x: number; y: number }; view: ViewState } | null = null;
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());

    contexts.commands.register([
      {
        id: 'view.pan.start',
        label: 'Start canvas pan',
        event: 'view.pan.start',
        group: 'view',
        hidden: true,
        input: { on: 'pointerdown', selector: stageSelector, when: isStageSurface, prevent: true },
        payload: ({ event }) => clientPoint(event!),
      },
      {
        id: 'view.pan.move',
        label: 'Pan canvas',
        event: 'view.pan.move',
        group: 'view',
        hidden: true,
        input: { on: 'pointermove', when: () => !!pan, prevent: true },
        payload: ({ event }) => clientPoint(event!),
      },
      { id: 'view.pan.end', label: 'End canvas pan', event: 'view.pan.end', group: 'view', hidden: true, input: { on: 'pointerup', when: () => !!pan } },
    ]);

    on('view.pan.start', pointer => {
      pan = { pointer, view: contexts.view.get() };
      contexts.places.el(Places.Stage)?.classList.add('panning');
    });
    on('view.pan.move', pointer => {
      if (!pan) return;
      contexts.view.set({
        x: pan.view.x - (pointer.x - pan.pointer.x) / pan.view.scale,
        y: pan.view.y - (pointer.y - pan.pointer.y) / pan.view.scale,
      });
      commit();
    });
    on('view.pan.end', () => {
      pan = null;
      contexts.places.el(Places.Stage)?.classList.remove('panning');
    });
  });
}
