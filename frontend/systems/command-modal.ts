import { grouped, shortcutOf, systemOf, type Registry } from '../core';
import { Places, Slots, type CommandSpec, type CommandSpecInput, type ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'palette.open': void;
    'help.open': void;
    'commandModal.run': { commandId: string };
    'commandModal.search.changed': { query: string };
    'commandModal.search.clear': void;
    'shortcut.edit.preview': { id: string; shortcut?: string };
    'shortcut.edit.commit': { id: string; shortcut?: string };
    'palette.nav': { delta: number };
    'palette.activate': void;
    'palette.alt': { char: string };
    // Universal search: a non-command palette result that navigates to an item.
    'palette.goto': ItemRef;
  }
}

const PLACEHOLDER = 'Search commands and graph items';
const ALT_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

type Row =
  | { kind: 'command'; id: string; label: string; group: string; shortcut: string }
  | { kind: 'goto'; ref: ItemRef; label: string; group: string; shortcut: '' };

/** The palette is the single command+search surface (⌘K / `?`). Navigate with
 *  arrow keys (Enter runs the highlighted row); each search result also gets an
 *  `Alt+<key>` accelerator, where <key> is the first character (unique across
 *  results) that follows the typed query in the result's label — so typing
 *  "kaf" turns "kafka" into Alt+K and "kafkian" into Alt+I. */
export function registerCommandModal(system: Registry) {
  system('commandModal', (ctx) => {
    const { on, emit, contexts, contribute } = ctx;
    contribute({ surface: 'top', command: 'help.open', kind: 'button', text: 'Help', label: 'Commands and shortcuts', order: 99, group: 'help' });
    contribute({ surface: 'top', command: 'palette.open', kind: 'button', text: 'Search', label: 'Search commands and graph items (P)', slot: Slots.End, order: 100 });

    let query = '';
    let selected = 0;
    let currentRows: Row[] = [];
    let altOfRow = new Map<number, string>();
    let rowOfAlt = new Map<string, number>();

    const modalEl = () => contexts.places.el(Places.Modal);
    const activePalette = () => !!modalEl()?.querySelector('[data-command-modal="palette"]');
    const isInteractionPhase = (command: CommandSpec) => {
      const event = command.input?.on ?? '';
      return event.startsWith('pointer') || event === 'wheel' || event === 'dblclick'
        || /\.(start|move|end)$/.test(command.id);
    };

    const visibleCommands = (q = '') => {
      const needle = q.trim().toLowerCase();
      return contexts.commands.all()
        .filter(command => !command.hidden || (!!needle && isInteractionPhase(command)))
        .filter(command => contexts.commands.isEnabled(command))
        .filter(command => !!needle || command.available?.() !== false)
        .filter(command => !needle || `${command.id} ${command.label} ${command.group ?? ''} ${shortcutOf(command)} ${command.input?.on ?? ''}`.toLowerCase().includes(needle));
    };
    // Context-ranked: when something is chosen, groups acting on the current
    // target sort first; otherwise create/navigate groups lead.
    const TARGET_GROUPS = new Set(['item', 'selection', 'choose', 'editing', 'edge', 'container']);
    const groupRank = (group: string) =>
      (TARGET_GROUPS.has(group) === (ctx.selection.selectedAll().length > 0)) ? 0 : 1;
    const orderedCommands = (q = '') => {
      const ordered: CommandSpec[] = [];
      [...grouped(visibleCommands(q), command => command.group ?? systemOf(command.id))]
        .sort((a, b) => groupRank(a[0]) - groupRank(b[0]))
        .forEach(([, commands]) => ordered.push(...commands));
      return ordered;
    };
    const itemResults = (q: string) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return [];
      return contexts.hierarchy.targets()
        .filter(item => item.label.toLowerCase().includes(needle))
        .slice(0, 8);
    };

    // Build the flat, ordered list of actionable rows (goto items first, then
    // grouped commands) plus the Alt-accelerator assignment for the query.
    const buildRows = (q: string): Row[] => {
      const rows: Row[] = [];
      itemResults(q).forEach(item => rows.push({ kind: 'goto', ref: item.ref, label: item.label, group: 'go to', shortcut: '' }));
      orderedCommands(q).forEach(command => rows.push({
        kind: 'command', id: command.id, label: command.label,
        group: command.group ?? systemOf(command.id), shortcut: shortcutOf(command),
      }));
      return rows;
    };
    const assignAlt = (rows: Row[], q: string) => {
      altOfRow = new Map();
      rowOfAlt = new Map();
      const needle = q.trim().toLowerCase();
      if (!needle) return;
      const used = new Set<string>();
      rows.forEach((row, i) => {
        const label = row.label.toLowerCase();
        const at = label.indexOf(needle);
        const start = at >= 0 ? at + needle.length : 0;
        // Prefer a char after the matched query text; wrap to the front as a
        // fallback so a result at the tail still gets an accelerator.
        const seq = label.slice(start) + label.slice(0, start);
        for (const ch of seq) {
          if (!ALT_CHARS.includes(ch) || used.has(ch)) continue;
          used.add(ch);
          altOfRow.set(i, ch);
          rowOfAlt.set(ch, i);
          break;
        }
      });
    };

    const rowEl = (row: Row, index: number) => {
      const el = contexts.templates.clone<HTMLElement>('command-row');
      el.dataset.index = String(index);
      if (index === selected) el.classList.add('is-selected');
      if (row.kind === 'command') {
        el.dataset.command = 'commandModal.run';
        el.dataset.commandId = row.id;
        contexts.templates.text(el, 'id', row.id);
      } else {
        el.dataset.command = 'palette.goto';
        el.dataset.gotoKind = row.ref.kind;
        el.dataset.gotoId = row.ref.id;
        contexts.templates.text(el, 'id', row.ref.kind);
      }
      contexts.templates.text(el, 'label', row.label);
      const alt = altOfRow.get(index);
      const chip = [alt ? `⌥${alt.toUpperCase()}` : '', row.shortcut].filter(Boolean).join(' · ');
      if (chip) contexts.templates.text(el, 'shortcut', chip);
      else el.querySelector('kbd')?.remove();
      return el;
    };

    const renderList = (q = '') => {
      currentRows = buildRows(q);
      assignAlt(currentRows, q);
      if (selected >= currentRows.length) selected = Math.max(0, currentRows.length - 1);
      const fragment = document.createDocumentFragment();
      let index = 0;
      // Preserve the section headings while threading a continuous row index.
      const sections = new Map<string, HTMLElement>();
      const rowsSlotFor = (group: string) => {
        let section = sections.get(group);
        if (!section) {
          section = contexts.templates.clone('command-section');
          contexts.templates.text(section, 'group', group);
          sections.set(group, section);
          fragment.append(section);
        }
        return contexts.templates.slot(section, 'rows');
      };
      currentRows.forEach(row => rowsSlotFor(row.group).append(rowEl(row, index++)));
      if (!currentRows.length) {
        const empty = document.createElement('section');
        empty.className = 'palette-empty';
        empty.setAttribute('role', 'status');
        const message = document.createElement('p');
        message.textContent = `No commands or graph items match “${q.trim()}”.`;
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.dataset.command = 'commandModal.search.clear';
        clear.textContent = 'Clear search';
        empty.append(message, clear);
        fragment.append(empty);
      }
      return fragment;
    };
    const renderPalette = () => {
      const palette = contexts.templates.clone('palette');
      palette.dataset.commandModal = 'palette';
      const input = palette.querySelector('.palette-search');
      if (input instanceof HTMLInputElement) input.placeholder = PLACEHOLDER;
      contexts.templates.slot(palette, 'commands').append(renderList());
      return palette;
    };
    const renderHelp = () => {
      const fragment = document.createDocumentFragment();
      const commands = contexts.commands.all()
        .filter(command => !command.hidden && contexts.commands.isEnabled(command))
        .filter(command => !!shortcutOf(command))
        .filter(command => !['debug', 'perf', 'scenario', 'dx'].includes(command.group ?? ''))
        .sort((a, b) => a.label.localeCompare(b.label));
      [...grouped(commands, command => command.group ?? systemOf(command.id))]
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([group, rows]) => {
          const section = contexts.templates.clone<HTMLElement>('command-section');
          contexts.templates.text(section, 'group', group);
          const slot = contexts.templates.slot(section, 'rows');
          rows.forEach(command => {
          const row = contexts.templates.clone<HTMLElement>('help-row');
          contexts.templates.text(row, 'label', command.label);
          contexts.templates.text(row, 'id', command.id);
          const input = row.querySelector('.shortcut-edit') as HTMLInputElement | null;
          if (input) {
            input.value = shortcutOf(command);
            input.dataset.shortcutCommand = command.id;
            input.setAttribute('aria-label', `Shortcut for ${command.label}`);
          }
            slot.append(row);
          });
          fragment.append(section);
        });
      const phases = contexts.commands.all()
        .filter(command => command.hidden && contexts.commands.isEnabled(command) && isInteractionPhase(command))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (phases.length) {
        const section = contexts.templates.clone<HTMLElement>('command-section');
        contexts.templates.text(section, 'group', 'Interaction phases');
        const slot = contexts.templates.slot(section, 'rows');
        phases.forEach(command => {
          const row = document.createElement('div');
          row.className = 'help-row help-phase-row';
          const copy = document.createElement('span');
          const label = document.createElement('b');
          label.textContent = command.label;
          const id = document.createElement('small');
          id.textContent = command.id;
          copy.append(label, id);
          const trigger = document.createElement('kbd');
          trigger.textContent = command.input?.on ?? 'internal';
          row.append(copy, trigger);
          slot.append(row);
        });
        fragment.append(section);
      }
      return fragment;
    };
    const rerender = () => {
      const list = modalEl()?.querySelector('[data-command-modal="palette"] [data-slot="commands"]');
      if (!list) return;
      list.replaceChildren(renderList(query));
      const active = list.querySelector('.is-selected') as HTMLElement | null;
      active?.scrollIntoView?.({ block: 'nearest' });
    };
    const runRow = (row: Row | undefined) => {
      if (!row) return;
      emit('modal.close');
      if (row.kind === 'command') {
        if (contexts.commands.get(row.id)) contexts.commands.run(row.id, { origin: 'palette' });
      } else {
        emit('selection.item.select', row.ref);
        emit('view.fit.item', row.ref);
      }
    };

    contexts.commands.register([
      {
        id: 'palette.open',
        label: 'Open palette',
        group: 'modal',
        shortcut: 'P',
        input: { on: 'keydown', key: 'p', prevent: true },
      },
      {
        id: 'help.open',
        label: 'Open help',
        group: 'modal',
        shortcut: '?',
      },
      {
        // `?` still opens the same surface (the old Help hotkey).
        id: 'palette.open.alt',
        label: 'Open palette (?)',
        event: 'palette.open',
        group: 'modal',
        hidden: true,
        shortcut: '?',
        input: { on: 'keydown', key: '?', prevent: true },
      },
      {
        id: 'palette.nav.down',
        label: 'Palette: next row',
        event: 'palette.nav',
        group: 'modal',
        hidden: true,
        input: { on: 'keydown', key: 'ArrowDown', global: true, prevent: true, stop: true, when: activePalette },
        payload: () => ({ delta: 1 }),
      },
      {
        id: 'palette.nav.up',
        label: 'Palette: previous row',
        event: 'palette.nav',
        group: 'modal',
        hidden: true,
        input: { on: 'keydown', key: 'ArrowUp', global: true, prevent: true, stop: true, when: activePalette },
        payload: () => ({ delta: -1 }),
      },
      {
        id: 'palette.activate',
        label: 'Palette: run highlighted',
        group: 'modal',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', global: true, prevent: true, stop: true, when: activePalette },
      },
      // One hidden Alt+<char> command per accelerator key. `when` gates them to
      // an open palette; the handler no-ops for a char not currently assigned.
      ...ALT_CHARS.map(char => ({
        id: `palette.alt.${char}`,
        label: `Palette: Alt+${char}`,
        event: 'palette.alt' as const,
        group: 'modal',
        hidden: true,
        input: { on: 'keydown' as const, key: char, alt: true, global: true, prevent: true, stop: true, when: activePalette },
        payload: () => ({ char }),
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
      {
        id: 'commandModal.search.change',
        label: 'Search command modal',
        event: 'commandModal.search.changed',
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.palette-search' },
        payload: ({ target }) => ({ query: (target as HTMLInputElement).value }),
      },
      { id: 'commandModal.search.clear', label: 'Clear palette search', group: 'modal', hidden: true },
      {
        id: 'shortcut.edit.preview',
        label: 'Preview shortcut edit',
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.shortcut-edit' },
        payload: ({ target }) => ({
          id: (target as HTMLInputElement).dataset.shortcutCommand ?? '',
          shortcut: (target as HTMLInputElement).value,
        }),
      },
      {
        id: 'shortcut.edit.commit',
        label: 'Commit shortcut edit',
        group: 'modal',
        hidden: true,
        input: { on: 'focusout', selector: '.shortcut-edit' },
        payload: ({ target }) => ({
          id: (target as HTMLInputElement).dataset.shortcutCommand ?? '',
          shortcut: (target as HTMLInputElement).value,
        }),
      },
    ]);

    const open = () => emit('modal.open', { title: 'Palette', visual: 'command', body: () => renderPalette() });
    on('palette.open', () => { query = ''; selected = 0; open(); });
    on('help.open', () => emit('modal.open', { title: 'Commands and shortcuts', visual: 'command', body: () => renderHelp() }));
    on('palette.nav', ({ delta }) => {
      if (!currentRows.length) return;
      selected = (selected + delta + currentRows.length) % currentRows.length;
      rerender();
    });
    on('palette.activate', () => runRow(currentRows[selected]));
    on('palette.alt', ({ char }) => {
      const index = rowOfAlt.get(char);
      if (index != null) runRow(currentRows[index]);
    });
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
    on('commandModal.search.changed', ({ query: q }) => {
      query = q;
      selected = 0;
      rerender();
    });
    on('commandModal.search.clear', () => {
      query = '';
      selected = 0;
      const input = modalEl()?.querySelector<HTMLInputElement>('.palette-search');
      if (input) input.value = '';
      rerender();
      input?.focus();
    });
    const shortcutInput = (id: string) =>
      modalEl()?.querySelector(`.shortcut-edit[data-shortcut-command="${CSS.escape(id)}"]`) as HTMLInputElement | null;
    const markShortcutConflict = (id: string, shortcut?: string) => {
      const input = shortcutInput(id);
      if (!input) return false;
      const conflict = !!contexts.commands.shortcutConflict(id, shortcut ?? input.value);
      input.classList.toggle('is-conflict', conflict);
      input.closest('.help-row')?.classList.toggle('has-conflict', conflict);
      return conflict;
    };
    on('shortcut.edit.preview', ({ id, shortcut }) => {
      if (!contexts.commands.get(id)) return;
      markShortcutConflict(id, shortcut);
    });
    on('shortcut.edit.commit', ({ id, shortcut }) => {
      const command = contexts.commands.get(id);
      if (!command) return;
      if (markShortcutConflict(id, shortcut)) {
        const input = shortcutInput(id);
        if (input) input.value = shortcutOf(command);
        return;
      }
      contexts.commands.setShortcut(id, shortcut ?? '');
      const input = shortcutInput(id);
      if (input) input.value = shortcutOf(command);
    });
  }, { requires: ['modal'] });
}
