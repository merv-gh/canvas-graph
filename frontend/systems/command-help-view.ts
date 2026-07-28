import { grouped, shortcutOf, systemOf, type AppCtx } from '../core';
import type { CommandSpec } from '../types';

type CommandHelpDependencies = {
  compactViewport: () => boolean;
  contexts: AppCtx['contexts'];
  isInteractionPhase: (command: CommandSpec) => boolean;
};

export const renderCommandHelp = ({
  compactViewport,
  contexts,
  isInteractionPhase,
}: CommandHelpDependencies) => {
    const renderTouchHelp = () => {
      const guide = document.createElement('section');
      guide.className = 'touch-guide';
      const rows = [
        ['Move', 'Drag with two fingers'],
        ['Zoom', 'Pinch anywhere on canvas'],
        ['Item actions', 'Hold an item'],
        ['Connect', 'Hold node → Connect → tap target'],
        ['Rename', 'Hold item → Rename'],
        ['Reframe', 'Tap Fit'],
      ];
      rows.forEach(([title, detail]) => {
        const row = document.createElement('div');
        const label = document.createElement('strong');
        label.textContent = title;
        const description = document.createElement('span');
        description.textContent = detail;
        row.append(label, description);
        guide.append(row);
      });
      return guide;
    };
    const renderShortcutReference = () => {
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
    const renderHelp = () => {
      if (compactViewport()) return renderTouchHelp();
      const guide = document.createElement('section');
      guide.className = 'help-guide';
      const intro = document.createElement('header');
      intro.className = 'help-intro';
      const title = document.createElement('h2');
      title.textContent = 'Make, connect, arrange.';
      const lead = document.createElement('p');
      lead.textContent = 'Most work needs six moves. Everything else can wait.';
      intro.append(title, lead);

      const tasks = document.createElement('div');
      tasks.className = 'help-task-grid';
      const task = (name: string, detail: string, key: string) => {
        const row = document.createElement('div');
        const copy = document.createElement('span');
        const heading = document.createElement('strong');
        heading.textContent = name;
        const description = document.createElement('small');
        description.textContent = detail;
        copy.append(heading, description);
        const shortcut = document.createElement('kbd');
        shortcut.textContent = key;
        row.append(copy, shortcut);
        return row;
      };
      tasks.append(
        task('Add', 'Create a node', 'A'),
        task('Connect', 'Choose two nodes', 'E'),
        task('Move', 'Drag the node itself', 'Drag'),
        task('Edit', 'Rename the selected item', 'Enter'),
        task('Find anything', 'Search commands and items', 'P'),
        task('Undo', 'Reverse the last change', 'Ctrl Z'),
      );

      const startGuide = document.createElement('button');
      startGuide.type = 'button';
      startGuide.className = 'help-start-guide';
      startGuide.dataset.command = 'onboarding.open';
      startGuide.textContent = 'Open getting-started guide';

      const reference = document.createElement('details');
      reference.className = 'help-reference';
      const summary = document.createElement('summary');
      summary.textContent = 'All keyboard shortcuts';
      const rows = document.createElement('div');
      rows.className = 'help-reference-rows';
      rows.append(renderShortcutReference());
      reference.append(summary, rows);
      guide.append(intro, tasks, startGuide, reference);
      return guide;
    };
    return renderHelp();
};

