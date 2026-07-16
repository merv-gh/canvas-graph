import type { Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'theme.toggle': void;
  }
}

const KEY = 'theme';
type Theme = 'light' | 'dark' | 'system';

/** Theme toggle. Persisted via IoApi; legacy `system` values resolve to the
 *  product's light default. Applies `data-theme` on `.shell` so CSS custom properties cascade
 *  without touching the flag/plugin machinery. Theme is UI state, not a feature
 *  toggle — it doesn't go through the registry flag system. */
export function registerDarkTheme(system: Registry) {
  system('dark.theme', ({ io, contexts, on, contribute }) => {

    const shellEl = () =>
      contexts.places.el('top')?.parentElement as HTMLElement | null;

    const resolveTheme = (stored: Theme): 'light' | 'dark' => {
      if (stored === 'light' || stored === 'dark') return stored;
      return 'light';
    };

    const applyTheme = () => {
      const shell = shellEl();
      if (!shell) return;
      const stored = io.get<Theme>(KEY, 'light');
      const resolved = resolveTheme(stored);
      shell.setAttribute('data-theme', resolved);
      // Expose resolved value so snapshot can read a stable string.
      shell.dataset.colorscheme = resolved;
    };

    contexts.commands.register([
      {
        id: 'theme.toggle',
        label: 'Toggle dark mode',
        group: 'view',
        event: 'theme.toggle',
        shortcut: 'Shift+D',
        input: { on: 'keydown', key: 'd', shift: true, prevent: true },
        payload: () => undefined,
      },
    ]);

    on('theme.toggle', () => {
      const stored = io.get<Theme>(KEY, 'light');
      const resolved = resolveTheme(stored);
      const next: Theme = resolved === 'dark' ? 'light' : 'dark';
      io.set(KEY, next);
      applyTheme();
    });

    // `main` mounts the shell during the same app.start dispatch. Defer one
    // microtask so theme application is independent of system registration order.
    on('app.start', () => { queueMicrotask(applyTheme); });

    contribute({
      origin: 'dark.theme',
      surface: 'top',
      command: 'theme.toggle',
      kind: 'button',
      text: 'Theme',
      label: 'Toggle theme',
      className: 'theme-toggle',
      slot: 'end',
      order: 78,
    });
  }, { requires: ['render'] });
}
