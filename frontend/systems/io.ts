import { STORAGE_KEYS, type Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'flag.changed': void;
    'command.shortcut.changed': { id: string; shortcut: string };
    'command.enabled.changed': { id: string; enabled: boolean };
  }
}

/** io — persist flag / command / fold state to the IoApi adapter.
 *  Reads happen at boot (core contexts hydrate from io.get); writes go through
 *  events so core contexts never call io.set directly (Principle 9).
 *  The io system owns the persistence boundary — all other systems just emit
 *  facts that end in `.changed` and this system writes them to storage. */
export function registerIo(system: Registry) {
  system('io', ({ on, io, flags, contexts }) => {
    on('flag.changed', () => io.set(STORAGE_KEYS.flags, flags.all()));
    on('command.shortcut.changed', ({ id, shortcut }) => {
      const overrides = io.get<Record<string, string>>(STORAGE_KEYS.shortcuts, {});
      overrides[id] = shortcut;
      io.set(STORAGE_KEYS.shortcuts, overrides);
    });
    on('command.enabled.changed', ({ id, enabled }) => {
      const disabled = new Set(io.get<string[]>(STORAGE_KEYS.disabledCommands, []));
      if (enabled) disabled.delete(id); else disabled.add(id);
      io.set(STORAGE_KEYS.disabledCommands, [...disabled]);
    });
    on('fold.changed', () => io.set('frontend.fold', contexts.fold.all()));
  });
}
