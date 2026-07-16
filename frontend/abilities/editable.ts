import { itemRefFrom, type Registry } from '../core';
import { Places } from '../types';
import type { CommandSource, ItemRef } from '../types';
import { ability, action } from './shared';
import type { Labeled } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'item.title.edit': { ref: ItemRef };
    'item.title.commit': { ref: ItemRef; text: string; finish?: boolean };
  }
}

/** Editable title — any item with a `Label.text` can use this.
 *  Convention: the entity's renderer must surface its title in an element
 *  carrying `[data-editable-title]`. Single click is selection; double-click
 *  (or Enter while selected) enters edit mode. */
export const editable = <T extends Labeled>() => ability<T>('editable', [action<T>({
  id: 'item.title.edit',
  label: 'Edit title',
  paletteCommand: 'item.title.edit',
  // No per-entity UI — the title slot is plain text by default. The action is
  // still reachable because paletteCommand `item.title.edit` carries Enter as
  // its keyboard binding (DX treats input-bound palette commands as a valid
  // keyboard affordance).
  ui: [],
})]);

export function registerEditable(system: Registry) {
  system('ability.editable', ({ on, emit, contexts, graphs, selection, origin, frameLoop }) => {
    const finishFocusTask = 'editable.title.finish.focus';
    /** Find the title element belonging to a given ref. Generic over kind via the
     *  data-item-* tagging — works for node, container, or any future kind that
     *  marks its title with [data-editable-title]. */
    const titleEl = (ref: ItemRef): HTMLElement | null => {
      const stage = contexts.places.el(Places.Stage);
      const item = stage?.querySelector(`[data-item-kind="${ref.kind}"][data-item-id="${ref.id}"]`);
      const el = item?.querySelector('[data-editable-title]') ?? null;
      return el instanceof HTMLElement ? el : null;
    };
    const refFromSource = (source: CommandSource): ItemRef | null =>
      itemRefFrom(source.target) ?? selection.selected();
    const titleCommit = (target?: Element | null, finish = false) => {
      const ref = itemRefFrom(target);
      return ref ? {
        ref,
        text: target?.textContent?.trim() ?? '',
        finish,
      } : undefined;
    };
    /** Ref currently being edited (or null when no edit in progress). Powers
     *  the Cancellable + the focusout/Enter commit guard. */
    let editingRef: ItemRef | null = null;

    const enterEditMode = (el: HTMLElement) => {
      el.contentEditable = 'plaintext-only';
      el.setAttribute('role', 'textbox');
      el.setAttribute('aria-label', 'Item title');
      // Firefox/Chromium treat contenteditable as focusable, but jsdom and a
      // few assistive-browser paths do not. Make that contract explicit while
      // editing and restore the renderer's original tab behavior afterwards.
      if (!el.hasAttribute('tabindex')) {
        el.dataset.editableManagedTabindex = 'true';
        el.tabIndex = -1;
      }
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
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      if (el.dataset.editableManagedTabindex) {
        delete el.dataset.editableManagedTabindex;
        el.removeAttribute('tabindex');
      }
      el.classList.remove('editing');
    };

    contexts.commands.register([
      {
        id: 'item.title.edit',
        label: 'Edit title',
        group: 'item',
        shortcut: 'Enter',
        // Plain Enter while an item is selected. The selector-based commit
        // commands below take precedence inside an active editing element so
        // Enter-to-commit still works.
        input: { on: 'keydown', key: 'Enter', prevent: true },
        available: source => !!refFromSource(source ?? {}),
        payload: source => {
          const ref = refFromSource(source);
          return ref ? { ref } : undefined;
        },
      },
      {
        // Double-click to enter edit. Single click stays as a pure selection
        // gesture so accidental edits don't happen.
        id: 'item.title.edit.dblclick',
        label: 'Edit title on double-click',
        event: 'item.title.edit',
        group: 'item',
        hidden: true,
        // A folded item owns double-click as “unfold”. Its title becomes
        // editable again after expansion, avoiding two gestures firing at once.
        input: {
          on: 'dblclick',
          selector: '[data-editable-title]',
          when: event => !(event.target instanceof Element && event.target.closest('.collapsed')),
          prevent: true,
        },
        payload: ({ target }) => {
          const ref = itemRefFrom(target);
          return ref ? { ref } : undefined;
        },
      },
      {
        id: 'item.title.commit.enter',
        label: 'Commit title (Enter)',
        event: 'item.title.commit',
        group: 'item',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '[data-editable-title].editing', prevent: true, stop: true },
        payload: ({ target }) => titleCommit(target, true),
      },
      {
        id: 'item.title.commit.focusout',
        label: 'Commit title on focusout',
        event: 'item.title.commit',
        group: 'item',
        hidden: true,
        input: { on: 'focusout', selector: '[data-editable-title].editing' },
        payload: ({ target }) => titleCommit(target),
      },
    ]);

    on('item.title.edit', ({ ref }) => {
      frameLoop.cancel(finishFocusTask);
      queueMicrotask(() => {
        const el = titleEl(ref);
        if (!el) return;
        editingRef = ref;
        enterEditMode(el);
      });
    });
    on('item.title.commit', ({ ref, text, finish }) => {
      const item = graphs.current.getItem(ref) as Labeled | undefined;
      if (!item) return;
      if (text && text !== item.Label.text) emit('item.update', { ref, patch: { Label: { text } } });
      if (!text) {
        const el = titleEl(ref);
        if (el) el.textContent = item.Label.text;
      }
      const el = titleEl(ref);
      if (el) exitEditMode(el);
      if (finish) frameLoop.schedule(finishFocusTask, () => queueMicrotask(() => {
          // Label commits redraw their item. Reacquire it after render rather
          // than focusing the soon-to-be-replaced pre-commit element.
          const title = titleEl(ref);
          const item = title?.closest<HTMLElement>('[data-item-kind][data-item-id]');
          title?.blur();
          // Return keyboard ownership to the selected item, not its text editor.
          // Global shortcuts (A, Tab, X, …) can continue after the second Enter.
          item?.focus({ preventScroll: true });
        }), 30);
      if (editingRef && editingRef.kind === ref.kind && editingRef.id === ref.id) editingRef = null;
    });

    contexts.cancellation.register({
      origin,
      active: () => !!editingRef,
      // Cancel = synthesise a commit with finish:true so the same code path
      // runs as Enter. No revert-to-original in v1.
      cancel: () => {
        const ref = editingRef;
        if (!ref) return;
        const el = titleEl(ref);
        if (!el) return;
        emit('item.title.commit', { ref, text: el.textContent?.trim() ?? '', finish: true });
      },
    });
  }, { requires: ['ability.selectable'] });
}
