import { grouped, shortcutOf, systemOf, type Registry } from '../core';
import { Places, type CommandSpec, type CommandSpecInput, type ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'palette.open': void;
    'help.open': void;
    'commandModal.run': { commandId: string };
    'commandModal.search.changed': { modalId: string; query: string };
    'shortcut.edit.preview': { id: string; shortcut: string };
    'shortcut.edit.commit': { id: string; shortcut: string };
    'flag.toggle': { name: string; on: boolean };
    // Universal search: a non-command palette result that navigates to an item.
    'palette.goto': ItemRef;
  }
}

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
  system('commandModal', (ctx) => {
    const { on, emit, contexts, contribute, flags } = ctx;
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
    // Context-ranked palette: when something is chosen, groups that act on the
    // current target (item / selection / choose / editing / edge / container)
    // sort first — so the numbered hot-rows and top sections are what's relevant
    // to "this". With nothing chosen, create/navigate groups lead instead.
    const TARGET_GROUPS = new Set(['item', 'selection', 'choose', 'editing', 'edge', 'container']);
    const groupRank = (group: string) =>
      (TARGET_GROUPS.has(group) === (ctx.selection.selectedAll().length > 0)) ? 0 : 1;
    const orderedCommands = (modal: CommandModalDef, query = '') => {
      const ordered: CommandSpec[] = [];
      [...grouped(visibleCommands(modal, query), command => command.group ?? systemOf(command.id))]
        .sort((a, b) => groupRank(a[0]) - groupRank(b[0]))
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
    // Universal search: match graph items by title against the hierarchy — the
    // canonical "what exists" list jump/picker already use. A hit navigates via the
    // generic select + fit events, so this is a thin source over data the app owns,
    // not a parallel index.
    const itemResults = (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return contexts.hierarchy.targets()
        .filter(item => item.label.toLowerCase().includes(q))
        .slice(0, NUMBERED_ROWS);
    };
    const gotoSection = (items: { ref: ItemRef; label: string }[]) => {
      const section = contexts.templates.clone('command-section');
      const rows = contexts.templates.slot(section, 'rows');
      contexts.templates.text(section, 'group', 'go to');
      items.forEach(item => {
        const row = contexts.templates.clone<HTMLElement>('command-row');
        row.dataset.command = 'palette.goto';
        row.dataset.gotoKind = item.ref.kind;
        row.dataset.gotoId = item.ref.id;
        contexts.templates.text(row, 'label', item.label);
        contexts.templates.text(row, 'id', item.ref.kind);
        row.querySelector('kbd')?.remove();
        rows.append(row);
      });
      return section;
    };
    const renderList = (modal: CommandModalDef, query = '') => {
      const fragment = document.createDocumentFragment();
      if (modal.id === 'palette' && query.trim()) {
        const items = itemResults(query);
        if (items.length) fragment.append(gotoSection(items));
      }
      let row = 0;
      const nextNumber = () => modal.id === 'palette' && row < NUMBERED_ROWS ? ++row : null;
      grouped(orderedCommands(modal, query), command => command.group ?? systemOf(command.id))
        .forEach(([group, commands]) => fragment.append(commandSection(modal, group, commands, nextNumber)));
      return fragment;
    };
    /** Flag toggle rows shown at the top of Help. Flags are grouped by kind
     *  (system / ability / feature); flipping a checkbox emits `flag.toggle`,
     *  which the runtime feature manager applies to the owning registry. The single Help
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
        row.append(meta, checkbox);
        rows.append(row);
      }));
      return section;
    };
    /** Doctor section: surfaces DX issues at the top of Help so contract drift
     *  is visible to the user, not only to a developer tailing the console.
     *  Re-reads `contexts.dx.issues()` every render (no caching) — the latest
     *  flag toggle / runtime.refresh feeds straight in. */
    const renderDoctorSection = () => {
      // contexts.dx is created at boot (stable) and the dx system installs the
      // live runner — works regardless of registration order.
      const issues = contexts.dx.run();
      const section = contexts.templates.clone('command-section');
      const rows = contexts.templates.slot(section, 'rows');
      const counts = { error: issues.filter(i => i.level === 'error').length, warn: issues.filter(i => i.level === 'warn').length };
      contexts.templates.text(section, 'group', `Doctor — ${counts.error} error · ${counts.warn} warn`);
      if (!issues.length) {
        const ok = document.createElement('div');
        ok.className = 'help-row';
        ok.textContent = 'All checks passed.';
        rows.append(ok);
        return section;
      }
      issues.forEach(issue => {
        const row = document.createElement('div');
        row.className = `help-row dx-row dx-${issue.level}`;
        const lead = document.createElement('b');
        lead.textContent = `[${issue.level}] ${issue.rule}`;
        const detail = document.createElement('small');
        detail.textContent = issue.message;
        const wrapper = document.createElement('span');
        wrapper.append(lead, detail);
        row.append(wrapper);
        rows.append(row);
      });
      return section;
    };
    const renderCommandModal = (modal: CommandModalDef) => {
      const palette = contexts.templates.clone('palette');
      palette.dataset.commandModal = modal.id;
      const input = palette.querySelector('.palette-search');
      if (input instanceof HTMLInputElement) input.placeholder = modal.placeholder;
      const slot = contexts.templates.slot(palette, 'commands');
      if (modal.id === 'help') {
        slot.append(renderDoctorSection());
        slot.append(renderFlagsSection());
      }
      slot.append(renderList(modal));
      return palette;
    };
    contexts.commands.register([
      ...Object.values(commandModals).map(modal => ({
        id: modal.event,
        label: modal.label,
        group: 'modal',
        shortcut: modal.shortcut,
        input: { on: 'keydown', key: modal.key, prevent: true },
      }) satisfies CommandSpecInput),
      {
        id: 'commandModal.run',
        label: 'Run command modal item',
        group: 'modal',
        hidden: true,
        payload: ({ target }) => ({ commandId: target?.closest('[data-command-id]')?.getAttribute('data-command-id') ?? '' }),
      },
      {
        id: 'palette.goto',
        label: 'Go to item',
        group: 'modal',
        hidden: true,
        payload: ({ target }) => {
          const el = target?.closest('[data-goto-id]') ?? null;
          return el ? { kind: el.getAttribute('data-goto-kind') as ItemRef['kind'], id: el.getAttribute('data-goto-id')! } : undefined;
        },
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
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.shortcut-edit' },
        payload: ({ target }) => ({ id: (target as HTMLElement).dataset.shortcutCommand!, shortcut: (target as HTMLInputElement).value }),
      },
      {
        id: 'shortcut.edit.commit',
        label: 'Commit shortcut edit',
        group: 'modal',
        hidden: true,
        input: { on: 'change', selector: '.shortcut-edit' },
        payload: ({ target }) => ({ id: (target as HTMLElement).dataset.shortcutCommand!, shortcut: (target as HTMLInputElement).value }),
      },
      {
        id: 'flag.toggle',
        label: 'Toggle feature flag',
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
    on('palette.goto', (ref) => {
      if (!ref?.id) return;
      emit('modal.close');
      emit('selection.item.select', ref);
      emit('view.fit.item', ref);
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
  }, { requires: ['modal'] });
}
