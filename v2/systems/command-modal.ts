import { grouped, shortcutOf, systemOf, type Registry } from '../core';
import { Places, type CommandSpec } from '../types';

type CommandModalDef = {
  id: 'palette' | 'help';
  title: string;
  event: 'palette.open' | 'help.open';
  label: string;
  shortcut: string;
  key: string;
  editableHotkeys: boolean;
  availableOnly: boolean;
  placeholder: string;
};

const commandModals: Record<CommandModalDef['id'], CommandModalDef> = {
  palette: { id: 'palette', title: 'Palette', event: 'palette.open', label: 'Open palette', shortcut: 'P', key: 'p', editableHotkeys: false, availableOnly: true, placeholder: 'Search commands' },
  help: { id: 'help', title: 'Help', event: 'help.open', label: 'Open help', shortcut: '?', key: '?', editableHotkeys: true, availableOnly: false, placeholder: 'Search shortcuts' },
};
const NUMBERED_ROWS = 5;

export function registerCommandModal(system: Registry) {
  system('commandModal', ({ on, emit, contexts, contribute, flags }) => {
    contribute({ surface: 'top', command: 'palette.open', kind: 'button', text: 'Palette', order: 30 });
    contribute({ surface: 'top', command: 'help.open', kind: 'button', text: 'Help', order: 40 });
    const queries = new Map<CommandModalDef['id'], string>();
    const modalEl = () => contexts.places.el(Places.Modal);
    const activePalette = () => !!modalEl()?.querySelector('[data-command-modal="palette"]');
    const queryOf = (modalId: CommandModalDef['id']) => {
      const input = modalEl()?.querySelector(`[data-command-modal="${modalId}"] .palette-search`);
      return input instanceof HTMLInputElement ? input.value : queries.get(modalId) ?? '';
    };
    const syncShortcutConflict = (input: HTMLInputElement) => {
      const conflict = contexts.commands.shortcutConflict(input.dataset.shortcutCommand!, input.value);
      input.classList.toggle('is-conflict', !!conflict);
      input.toggleAttribute('aria-invalid', !!conflict);
      input.title = conflict ? `Already used by ${conflict.label}` : '';
      input.closest('.help-row')?.classList.toggle('has-conflict', !!conflict);
      return !conflict;
    };
    const visibleCommands = (modal: CommandModalDef, query = '') => {
      const q = query.trim().toLowerCase();
      return contexts.commands.all()
        .filter(command => !command.hidden)
        .filter(command => !modal.availableOnly || !!q || command.available?.() !== false)
        .filter(command => !q || `${command.id} ${command.label} ${command.group ?? ''} ${shortcutOf(command)}`.toLowerCase().includes(q));
    };
    const orderedCommands = (modal: CommandModalDef, query = '') => {
      const ordered: CommandSpec[] = [];
      grouped(visibleCommands(modal, query), command => command.group ?? systemOf(command.id))
        .forEach(([, commands]) => ordered.push(...commands));
      return ordered;
    };
    const numberedCommandId = (index: number) =>
      orderedCommands(commandModals.palette, queryOf('palette'))[index]?.id ?? '';
    const commandSection = (modal: CommandModalDef, group: string, commands: CommandSpec[], nextNumber?: () => number | null) => {
      const section = contexts.templates.clone('command-section');
      const rows = contexts.templates.slot(section, 'rows');
      contexts.templates.text(section, 'group', group);
      commands.forEach(command => {
        const shortcut = shortcutOf(command);
        const number = nextNumber?.() ?? null;
        const row = contexts.templates.clone<HTMLElement>(modal.editableHotkeys ? 'help-row' : 'command-row');
        if (!modal.editableHotkeys) {
          row.dataset.command = 'commandModal.run';
          row.dataset.commandId = command.id;
        }
        contexts.templates.text(row, 'label', command.label);
        contexts.templates.text(row, 'id', command.id);
        if (modal.editableHotkeys) {
          const input = row.querySelector('input');
          if (input) {
            input.dataset.shortcutCommand = command.id;
            input.value = shortcut;
            input.setAttribute('aria-label', `${command.label} shortcut`);
            syncShortcutConflict(input);
          }
        } else if (number || shortcut) contexts.templates.text(row, 'shortcut', [number, shortcut].filter(Boolean).join(' · '));
        else row.querySelector('kbd')?.remove();
        rows.append(row);
      });
      return section;
    };
    const renderList = (modal: CommandModalDef, query = '') => {
      const fragment = document.createDocumentFragment();
      let row = 0;
      const nextNumber = () => modal.id === 'palette' && row < NUMBERED_ROWS ? ++row : null;
      grouped(orderedCommands(modal, query), command => command.group ?? systemOf(command.id))
        .forEach(([group, commands]) => fragment.append(commandSection(modal, group, commands, nextNumber)));
      return fragment;
    };
    /** Flag toggle rows shown at the top of Help. Flags are grouped by kind
     *  (system / ability / feature); flipping a checkbox emits `flag.toggle`,
     *  which calls flags.set and persists via the io adapter. The single Help
     *  panel becomes the place a user goes to disable any non-core piece. */
    const renderFlagsSection = () => {
      const section = contexts.templates.clone('command-section');
      const rows = contexts.templates.slot(section, 'rows');
      contexts.templates.text(section, 'group', 'Feature flags');
      ([
        { kind: 'system' as const, label: 'System' },
        { kind: 'ability' as const, label: 'Ability' },
        { kind: 'feature' as const, label: 'Feature' },
      ]).forEach(g => flags.declared(g.kind).forEach(name => {
        const row = document.createElement('label');
        row.className = 'help-row flag-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'flag-toggle';
        checkbox.dataset.flag = name;
        checkbox.checked = flags.isOn(name);
        const meta = document.createElement('span');
        const title = document.createElement('b');
        title.textContent = name;
        const subtitle = document.createElement('small');
        subtitle.textContent = g.label;
        meta.append(title, subtitle);
        row.append(checkbox, meta);
        rows.append(row);
      }));
      return section;
    };
    const renderCommandModal = (modal: CommandModalDef) => {
      const palette = contexts.templates.clone('palette');
      palette.dataset.commandModal = modal.id;
      const input = palette.querySelector('.palette-search');
      if (input instanceof HTMLInputElement) input.placeholder = modal.placeholder;
      const slot = contexts.templates.slot(palette, 'commands');
      if (modal.id === 'help') slot.append(renderFlagsSection());
      slot.append(renderList(modal));
      return palette;
    };
    contexts.commands.register([
      ...Object.values(commandModals).map(modal => ({
        id: modal.event,
        label: modal.label,
        event: modal.event,
        group: 'modal',
        shortcut: modal.shortcut,
        input: { on: 'keydown', key: modal.key, prevent: true },
      }) satisfies CommandSpec),
      {
        id: 'commandModal.run',
        label: 'Run command modal item',
        event: 'commandModal.run',
        group: 'modal',
        hidden: true,
        payload: ({ target }) => ({ commandId: target?.closest('[data-command-id]')?.getAttribute('data-command-id') ?? '' }),
      },
      ...Array.from({ length: NUMBERED_ROWS }, (_, i) => ({
        id: `commandModal.run.${i + 1}`,
        label: `Run palette item ${i + 1}`,
        event: 'commandModal.run' as const,
        group: 'modal',
        hidden: true,
        input: { on: 'keydown' as const, key: String(i + 1), global: true, prevent: true, stop: true, when: activePalette },
        available: () => !!numberedCommandId(i),
        payload: () => ({ commandId: numberedCommandId(i) }),
      })),
      {
        id: 'commandModal.search.change',
        label: 'Search command modal',
        event: 'commandModal.search.changed',
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.palette-search' },
        payload: ({ target }) => {
          const root = target?.closest('[data-command-modal]');
          return {
            modalId: root instanceof HTMLElement ? root.dataset.commandModal ?? '' : '',
            query: (target as HTMLInputElement).value,
          };
        },
      },
      {
        id: 'shortcut.edit.preview',
        label: 'Preview shortcut edit',
        event: 'shortcut.edit.preview',
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.shortcut-edit' },
        payload: ({ target }) => ({ id: (target as HTMLElement).dataset.shortcutCommand!, shortcut: (target as HTMLInputElement).value }),
      },
      {
        id: 'shortcut.edit.commit',
        label: 'Commit shortcut edit',
        event: 'shortcut.edit.commit',
        group: 'modal',
        hidden: true,
        input: { on: 'change', selector: '.shortcut-edit' },
        payload: ({ target }) => ({ id: (target as HTMLElement).dataset.shortcutCommand!, shortcut: (target as HTMLInputElement).value }),
      },
      {
        id: 'flag.toggle',
        label: 'Toggle feature flag',
        event: 'flag.toggle',
        group: 'modal',
        hidden: true,
        input: { on: 'change', selector: '.flag-toggle' },
        payload: ({ target }) => ({
          name: (target as HTMLElement).dataset.flag ?? '',
          on: (target as HTMLInputElement).checked,
        }),
      },
    ]);
    const open = (modal: CommandModalDef) => emit('modal.open', {
      title: modal.title,
      visual: 'command',
      body: () => renderCommandModal(modal),
    });
    const shortcutInput = (id: string) =>
      modalEl()?.querySelector(`.shortcut-edit[data-shortcut-command="${id}"]`) ?? null;
    on('palette.open', () => { queries.set('palette', ''); open(commandModals.palette); });
    on('help.open', () => { queries.set('help', ''); open(commandModals.help); });
    on('commandModal.run', ({ commandId }) => {
      if (!contexts.commands.get(commandId)) return;
      emit('modal.close');
      contexts.commands.run(commandId, { origin: 'palette' });
    });
    on('commandModal.search.changed', ({ modalId, query }) => {
      const modal = commandModals[modalId as CommandModalDef['id']];
      if (modal) queries.set(modal.id, query);
      const root = modalEl()?.querySelector(`[data-command-modal="${modalId}"]`);
      const list = root?.querySelector('[data-slot="commands"]');
      if (modal && list) list.replaceChildren(renderList(modal, query));
    });
    on('shortcut.edit.preview', ({ id }) => {
      const input = shortcutInput(id);
      if (input instanceof HTMLInputElement) syncShortcutConflict(input);
    });
    on('shortcut.edit.commit', ({ id }) => {
      const input = shortcutInput(id);
      if (!(input instanceof HTMLInputElement) || !syncShortcutConflict(input)) return;
      contexts.commands.setShortcut(id, input.value);
    });
    on('flag.toggle', ({ name, on: enabled }) => { if (name) flags.set(name, enabled); });
  });
}
