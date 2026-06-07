import { itemIdFrom, type Registry } from '../core';
import type { CommandSource, Id, NodeEntity } from '../types';
import { ability, action } from './shared';

export const editable = <T extends NodeEntity>() => ability<T>('editable', [action<T>({
  id: 'node.title.edit',
  label: 'Edit node title',
  paletteCommand: 'node.title.edit',
  ui: [{
    surface: 'entity',
    command: 'node.title.edit',
    kind: 'handler',
    slot: 'title',
    className: 'editable-inline',
    attrs: { contenteditable: 'plaintext-only', 'data-command': 'node.title.edit' },
  }],
})]);

export function registerEditable(system: Registry) {
  system('ability.editable', ({ on, emit, contexts, graphs, selection }) => {
    const titleEl = (id: Id) => document.querySelector(`.node[data-node-id="${id}"] .node-title`);
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || selection.selected() || '';
    const titleCommit = (target?: Element | null, finish = false) => ({
      id: itemIdFrom(target),
      text: target?.textContent?.trim() ?? '',
      finish,
    });

    contexts.commands.register([
      {
        id: 'node.title.edit',
        label: 'Edit node title',
        event: 'node.title.edit',
        group: 'node',
        shortcut: 'Enter',
        input: { on: 'keydown', key: 'Enter', prevent: true },
        available: source => !!nodeId(source ?? {}) || !!selection.selectedNode(),
        payload: source => ({ id: nodeId(source) || selection.selected() || '' }),
      },
      {
        id: 'node.title.commit.enter',
        label: 'Commit node title',
        event: 'node.title.commit',
        group: 'node',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '.node-title', prevent: true },
        payload: ({ target }) => titleCommit(target, true),
      },
      {
        id: 'node.title.commit.focusout',
        label: 'Commit node title focusout',
        event: 'node.title.commit',
        group: 'node',
        hidden: true,
        input: { on: 'focusout', selector: '.node-title' },
        payload: ({ target }) => titleCommit(target),
      },
    ]);

    on('node.title.edit', ({ id }) => queueMicrotask(() => {
      const title = titleEl(id);
      if (!(title instanceof HTMLElement)) return;
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }));
    on('node.title.commit', ({ id, text, finish }) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      if (text && text !== node.Label.text) emit('graph.node.update', { id, patch: { Label: { text } } });
      if (!text) {
        const title = titleEl(id);
        if (title) title.textContent = node.Label.text;
      }
      if (finish) queueMicrotask(() => {
        const title = titleEl(id);
        if (title instanceof HTMLElement) title.blur();
      });
    });
  });
}
