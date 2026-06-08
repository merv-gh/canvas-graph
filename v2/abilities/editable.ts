import { itemIdFrom, type Registry } from '../core';
import { Places } from '../types';
import type { CommandSource, Id, NodeEntity } from '../types';
import { ability, action } from './shared';

/** Editable title. The title slot stays plain by default — clicking it does
 *  NOT start an edit, so single-click selection works cleanly. Edit mode is
 *  entered explicitly:
 *    - `Enter` while the node is selected, OR
 *    - double-click on the title.
 *
 *  In edit mode the title becomes contentEditable; Escape goes through the
 *  global cancellation system (commits + blurs), Enter / focusout commit. */
export const editable = <T extends NodeEntity>() => ability<T>('editable', [action<T>({
  id: 'node.title.edit',
  label: 'Edit node title',
  paletteCommand: 'node.title.edit',
  // No UI affordance: the title slot is plain text by default. The action is
  // still reachable because paletteCommand `node.title.edit` carries the Enter
  // shortcut (DX treats input-bound palette commands as the keyboard affordance).
  ui: [],
})]);

export function registerEditable(system: Registry) {
  system('ability.editable', ({ on, emit, contexts, graphs, selection, origin }) => {
    const titleEl = (id: Id) =>
      contexts.places.el(Places.Stage)?.querySelector(`.node[data-node-id="${id}"] .node-title`) ?? null;
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || selection.selectedNode()?.id || '';
    const titleCommit = (target?: Element | null, finish = false) => ({
      id: itemIdFrom(target),
      text: target?.textContent?.trim() ?? '',
      finish,
    });
    /** ID of the title currently in edit mode (or '' when nothing is being
     *  edited). Powers the Cancellable + scopes the focusout/Enter commit
     *  selector to only fire when we expect it. */
    let editingId = '';

    const enterEditMode = (el: HTMLElement) => {
      el.contentEditable = 'plaintext-only';
      el.classList.add('editing');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    const exitEditMode = (el: HTMLElement) => {
      el.contentEditable = 'inherit';
      el.classList.remove('editing');
    };

    contexts.commands.register([
      {
        id: 'node.title.edit',
        label: 'Edit node title',
        event: 'node.title.edit',
        group: 'node',
        shortcut: 'Enter',
        // Plain Enter while the node is selected — but skip when typing inside
        // any input/textarea/contenteditable (Enter inside the title-being-edited
        // belongs to node.title.commit.enter below).
        input: { on: 'keydown', key: 'Enter', prevent: true },
        available: source => !!nodeId(source ?? {}) || !!selection.selectedNode(),
        payload: source => ({ id: nodeId(source) || selection.selectedNode()?.id || '' }),
      },
      {
        // Double-click the title to enter edit mode. Single click stays as a
        // pure selection gesture so the user can pick a node without
        // accidentally editing it.
        id: 'node.title.edit.dblclick',
        label: 'Edit node title on double-click',
        event: 'node.title.edit',
        group: 'node',
        hidden: true,
        input: { on: 'dblclick', selector: '.node-title', prevent: true },
        payload: ({ target }) => ({ id: itemIdFrom(target) }),
      },
      {
        id: 'node.title.commit.enter',
        label: 'Commit node title',
        event: 'node.title.commit',
        group: 'node',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '.node-title.editing', prevent: true, stop: true },
        payload: ({ target }) => titleCommit(target, true),
      },
      {
        id: 'node.title.commit.focusout',
        label: 'Commit node title focusout',
        event: 'node.title.commit',
        group: 'node',
        hidden: true,
        input: { on: 'focusout', selector: '.node-title.editing' },
        payload: ({ target }) => titleCommit(target),
      },
    ]);

    on('node.title.edit', ({ id }) => queueMicrotask(() => {
      const el = titleEl(id);
      if (!(el instanceof HTMLElement)) return;
      editingId = id;
      enterEditMode(el);
    }));
    on('node.title.commit', ({ id, text, finish }) => {
      const node = graphs.current.getNode(id);
      if (!node) return;
      if (text && text !== node.Label.text) emit('graph.node.update', { id, patch: { Label: { text } } });
      if (!text) {
        const el = titleEl(id);
        if (el) el.textContent = node.Label.text;
      }
      const el = titleEl(id);
      if (el instanceof HTMLElement) exitEditMode(el);
      if (finish) queueMicrotask(() => {
        const refocus = titleEl(id);
        if (refocus instanceof HTMLElement) refocus.blur();
      });
      if (editingId === id) editingId = '';
    });

    contexts.cancellation.register({
      origin,
      active: () => !!editingId,
      // Cancel = synthesise a commit with finish:true so the same code path
      // runs as Enter (persist + exit edit mode). Doesn't rely on blur firing
      // focusout (jsdom is flaky on contenteditable blur events).
      // V1 trade-off: no revert-to-original; add later by capturing original
      // text on enterEditMode and a separate `cancelEdit` event.
      cancel: () => {
        const id = editingId;
        if (!id) return;
        const el = titleEl(id);
        if (!(el instanceof HTMLElement)) return;
        emit('node.title.commit', { id, text: el.textContent?.trim() ?? '', finish: true });
      },
    });
  });
}
