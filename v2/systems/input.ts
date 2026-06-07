import type { Registry } from '../core';

export function registerInput(system: Registry) {
  system('input', ({ on, contexts }) => {
    on('app.start', () => contexts.input.start());
  });
}
