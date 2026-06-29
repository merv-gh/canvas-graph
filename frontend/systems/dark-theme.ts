import type { Registry } from '../core';

declare module '../types' {
  interface CustomEvents {
    'theme.toggle': void;
  }
}

const KEY = 'theme';
type Theme = 'light' | 'dark' | 'system';

/** Dark mode toggle. Persisted via IoApi; falls back to OS preference when set to
 *  'system'. Applies `data-theme` on `.shell` so CSS custom properties cascade
 *  without touching the flag/plugin machinery. Theme is UI state, not a feature
 *  toggle — it doesn't go through the registry flag system. */
export function registerDarkTheme(system: Registry) {
  system('dark.theme', ({ io, contexts, on, contribute }) => {

    const shellEl = () =>
      contexts.places.el('top')?.parentElement as HTMLElement | null;

    const prefersDark = (): boolean =>
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;

    const resolveTheme = (stored: Theme): 'light' | 'dark' => {
      if (stored === 'light' || stored === 'dark') return stored;
      return prefersDark() ? 'dark' : 'light';
    };

    const applyTheme = () => {
      const shell = shellEl();
      if (!shell) return;
      const stored = io.get<Theme>(KEY, 'system');
      const resolved = resolveTheme(stored);
      shell.setAttribute('data-theme', resolved);
      // Expose resolved value so snapshot can read a stable string.
      shell.dataset.colorscheme = resolved;
    };

    // Listen for OS preference changes (only matters when stored === 'system').
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', () => {
        if (io.get<Theme>(KEY, 'system') === 'system') applyTheme();
      });
    }

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
      const stored = io.get<Theme>(KEY, 'system');
      const resolved = resolveTheme(stored);
      const next: Theme = resolved === 'dark' ? 'light' : 'dark';
      io.set(KEY, next);
      applyTheme();
    });

    on('app.start', () => { applyTheme(); });

    contribute({
      origin: 'dark.theme',
      surface: 'top',
      command: 'theme.toggle',
      kind: 'button',
      text: '☀',
      label: 'Toggle theme',
      slot: 'end',
      order: 78,
    });
  }, { requires: ['render'] });
}
