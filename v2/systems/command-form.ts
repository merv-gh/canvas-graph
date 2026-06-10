import type { Registry } from '../core';
import { Places } from '../types';
import type { CommandFormField } from '../types';

declare module '../types' {
  interface CustomEvents {
    'commandForm.open': { commandId: string; seed?: Record<string, string> };
    'commandForm.submit': { commandId: string; values: Record<string, string> };
  }
}

const fieldId = (commandId: string, field: CommandFormField) =>
  `form-${commandId.replace(/[^a-z0-9_-]/gi, '-')}-${field.id}`;

export function registerCommandForm(system: Registry) {
  system('commandForm', ({ on, emit, forward, contexts }) => {
    const collectValues = (root: HTMLElement) => {
      const values: Record<string, string> = {};
      root.querySelectorAll<HTMLInputElement>('[data-form-field]')
        .forEach(input => { values[input.dataset.formField!] = input.value.trim(); });
      return values;
    };
    const errorEl = (root: HTMLElement) => root.querySelector('[data-form-error]') as HTMLElement | null;
    const showError = (root: HTMLElement | null, message = '') => {
      const el = root ? errorEl(root) : null;
      if (el) el.textContent = message;
    };
    const formField = (commandId: string, field: CommandFormField, value = '') => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.dataset.formField = field.id;
      input.name = field.id;
      input.value = value;
      input.required = field.required !== false;
      input.placeholder = field.placeholder ?? '';
      if (field.autofocus) input.autofocus = true;
      label.append(field.label, input);
      const options = field.options?.() ?? [];
      if (!options.length) return label;
      const list = document.createElement('datalist');
      list.id = fieldId(commandId, field);
      options.forEach(option => {
        const item = document.createElement('option');
        item.value = option.value;
        item.label = option.label;
        list.append(item);
      });
      input.setAttribute('list', list.id);
      label.append(list);
      return label;
    };
    const renderForm = (commandId: string, seed: Record<string, string>, initialError = '') => {
      const command = contexts.commands.get(commandId);
      const form = command?.form;
      if (!command || !form) return document.createDocumentFragment();
      const root = document.createElement('section');
      root.className = 'command-form properties';
      root.dataset.commandForm = commandId;
      const fields = document.createElement('div');
      fields.dataset.slot = 'fields';
      form.fields.forEach(field => fields.append(formField(commandId, field, seed[field.id] ?? '')));
      const error = document.createElement('div');
      error.className = 'form-error';
      error.dataset.formError = '';
      error.textContent = initialError;
      const actions = document.createElement('div');
      actions.className = 'form-actions';
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'primary';
      submit.dataset.command = 'commandForm.submit';
      submit.textContent = form.submitLabel ?? 'Apply';
      actions.append(submit);
      root.append(fields, error, actions);
      return root;
    };

    contexts.commands.register([{
      id: 'commandForm.submit',
      label: 'Submit command form',
      group: 'modal',
      hidden: true,
      input: { on: 'keydown', key: 'Enter', selector: '.command-form input', prevent: true, stop: true },
      payload: ({ target }) => {
        const root = target?.closest('[data-command-form]') as HTMLElement | null;
        return { commandId: root?.dataset.commandForm ?? '', values: root ? collectValues(root) : {} };
      },
    }]);

    on('commandForm.open', ({ commandId, seed = {} }) => {
      const command = contexts.commands.get(commandId);
      if (!command?.form) return;
      const initialError = command.form.validate?.(seed, {}) ?? '';
      emit('modal.open', {
        title: command.form.title ?? command.label,
        visual: 'properties',
        body: () => renderForm(commandId, seed, initialError),
      });
      if (initialError) emit('app.notice', { message: initialError, level: 'warn' });
    });
    on('commandForm.submit', ({ commandId, values }) => {
      const command = contexts.commands.get(commandId);
      const form = command?.form;
      const root = contexts.places.el(Places.Modal)?.querySelector(`[data-command-form="${commandId}"]`) as HTMLElement | null;
      if (!command || !form) return;
      const error = form.validate?.(values, {});
      if (error) {
        showError(root, error);
        emit('app.notice', { message: error, level: 'warn' });
        return;
      }
      const payload = form.payload(values, {});
      if (payload == null) {
        const message = 'Fill the required fields.';
        showError(root, message);
        emit('app.notice', { message, level: 'warn' });
        return;
      }
      forward(command.event, payload);
      emit('modal.close');
    });
  }, { requires: ['modal'] });
}
