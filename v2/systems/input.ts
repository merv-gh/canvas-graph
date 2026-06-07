import type { Registry } from '../core';

export function registerInput(system: Registry) {
  system('input', ({ on, contexts }) => {
    let stopInput: (() => void) | undefined;
    on('app.start', () => {
      stopInput?.();
      stopInput = contexts.input.start();
    });
    return () => stopInput?.();
  });
}
