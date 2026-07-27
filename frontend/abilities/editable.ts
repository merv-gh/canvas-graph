import { itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { CommandSource, ItemRef } from '../types';
import { ability, action } from './shared';
import type { Labeled } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'item.title.edit': { ref: ItemRef };
    'item.title.commit': { ref: ItemRef; text: string; finish?: boolean };
    'item.description.edit': { ref: ItemRef };
    'item.description.commit': { ref: ItemRef; text: string; finish?: boolean };
  }
}

type Described = Labeled & { Description?: string };

/** Editable title — any item with a `Label.text` can use this.
 *  Convention: the entity's renderer must surface its title in an element
 *  carrying `[data-editable-title]`. Single click is selection; double-click
 *  (or Enter while selected) enters edit mode. */
export const editable = <T extends Labeled>() => ability<T>('editable', [action<T>({
  id: 'item.title.edit',
  label: 'Rename item',
  paletteCommand: 'item.title.edit',
  // Explicit Rename prevents the generic Edit-details inspector from becoming
  // the accidental title-editing path. Item toolbar and touch action wheel both
  // derive from this same affordance.
  ui: [{
    surface: 'entity',
    command: 'item.title.edit',
    kind: 'button',
    slot: Slots.HeaderEnd,
    className: 'node-config node-rename',
    text: 'Rename',
    label: 'Rename item',
  }],
})]);

export function registerEditable(system: Registry) {
  system('ability.editable', ({ on, emit, contexts, graphs, selection, origin, frameLoop }) => {
    const finishFocusTask = 'editable.title.finish.focus';
    /** Find the title element belonging to a given ref. Generic over kind via the
     *  data-item-* tagging — works for node, container, or any future kind that
     *  marks its title with [data-editable-title]. */
    const itemEl = (ref: ItemRef): Element | undefined => {
      const stage = contexts.places.el(Places.Stage);
      return [...(stage?.querySelectorAll(`[data-item-kind="${ref.kind}"][data-item-id="${ref.id}"]`) ?? [])]
        .find(candidate => !candidate.closest('.tool-panel, .item-toolbar'));
    };
    const editableEl = (ref: ItemRef, selector: string): HTMLElement | null => {
      const el = itemEl(ref)?.querySelector(selector) ?? null;
      return el instanceof HTMLElement ? el : null;
    };
    const titleEl = (ref: ItemRef) => editableEl(ref, '[data-editable-title]');
    const descriptionEl = (ref: ItemRef) => editableEl(ref, '[data-editable-description]');
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
    let editingDescriptionRef: ItemRef | null = null;
    const renderedDescriptions = new WeakMap<HTMLElement, Node[]>();

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
    const enterDescriptionMode = (el: HTMLElement, raw: string) => {
      renderedDescriptions.set(el, [...el.childNodes].map(node => node.cloneNode(true)));
      el.replaceChildren(document.createTextNode(raw));
      enterEditMode(el);
      el.setAttribute('aria-label', 'Markdown description');
    };
    const restoreDescription = (el: HTMLElement) => {
      const rendered = renderedDescriptions.get(el);
      if (rendered) el.replaceChildren(...rendered.map(node => node.cloneNode(true)));
      renderedDescriptions.delete(el);
    };

    contexts.commands.register([
      {
        id: 'item.title.edit',
        label: 'Rename item',
        group: 'item',
        shortcut: 'Enter',
        // Plain Enter while an item is selected. The selector-based commit
        // commands below take precedence inside an active editing element so
        // Enter-to-commit still works. Inside a modal, Enter stays the
        // browser's button activation (the prevented binding would otherwise
        // swallow it before the focused button can click). The same gate covers
        // contextual command buttons outside modals.
        input: {
          on: 'keydown', key: 'Enter', prevent: true,
          when: event => !(event.target as Element).closest('.modal-layer, button, [role="menuitem"]'),
        },
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
      {
        id: 'item.description.edit',
        label: 'Edit item description',
        group: 'item',
        shortcut: 'Shift+Enter',
        input: {
          on: 'keydown', key: 'Enter', shift: true, prevent: true,
          when: event => !(event.target as Element).closest('.modal-layer, button, [role="menuitem"]'),
        },
        available: source => {
          const ref = refFromSource(source ?? {});
          return !!ref && !!descriptionEl(ref);
        },
        payload: source => {
          const ref = refFromSource(source);
          return ref ? { ref } : undefined;
        },
      },
      {
        id: 'item.description.edit.dblclick',
        label: 'Edit description on double-click',
        event: 'item.description.edit',
        group: 'item',
        hidden: true,
        input: { on: 'dblclick', selector: '[data-editable-description]', prevent: true },
        payload: ({ target }) => {
          const ref = itemRefFrom(target);
          return ref ? { ref } : undefined;
        },
      },
      {
        id: 'item.description.commit.ctrl-enter',
        label: 'Commit description (Ctrl+Enter)',
        event: 'item.description.commit',
        group: 'item',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', ctrl: true, selector: '[data-editable-description].editing', prevent: true, stop: true },
        payload: ({ target }) => titleCommit(target, true),
      },
      {
        id: 'item.description.commit.meta-enter',
        label: 'Commit description (Command+Enter)',
        event: 'item.description.commit',
        group: 'item',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', meta: true, selector: '[data-editable-description].editing', prevent: true, stop: true },
        payload: ({ target }) => titleCommit(target, true),
      },
      {
        id: 'item.description.commit.focusout',
        label: 'Commit description on focusout',
        event: 'item.description.commit',
        group: 'item',
        hidden: true,
        input: { on: 'focusout', selector: '[data-editable-description].editing' },
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
    on('item.description.edit', ({ ref }) => {
      frameLoop.cancel(finishFocusTask);
      queueMicrotask(() => {
        const el = descriptionEl(ref);
        const current = graphs.current.getItem(ref) as Described | undefined;
        if (!el || !current) return;
        editingDescriptionRef = ref;
        enterDescriptionMode(el, current.Description ?? '');
      });
    });
    on('item.description.commit', ({ ref, text, finish }) => {
      const current = graphs.current.getItem(ref) as Described | undefined;
      const el = descriptionEl(ref);
      if (!current || !el) return;
      const next = text.trim();
      if (next !== (current.Description ?? '')) emit('item.update', { ref, patch: { Description: next } });
      else restoreDescription(el);
      exitEditMode(el);
      if (finish) frameLoop.schedule(finishFocusTask, () => queueMicrotask(() => {
        const item = itemEl(ref) as HTMLElement | undefined;
        descriptionEl(ref)?.blur();
        item?.focus({ preventScroll: true });
      }), 30);
      if (editingDescriptionRef && editingDescriptionRef.kind === ref.kind && editingDescriptionRef.id === ref.id) editingDescriptionRef = null;
    });

    contexts.cancellation.register({
      origin,
      active: () => !!editingRef || !!editingDescriptionRef,
      // Cancel = synthesise a commit with finish:true so the same code path
      // runs as Enter. No revert-to-original in v1.
      cancel: () => {
        const ref = editingDescriptionRef ?? editingRef;
        if (!ref) return;
        const description = !!editingDescriptionRef;
        const el = description ? descriptionEl(ref) : titleEl(ref);
        if (!el) return;
        if (description) emit('item.description.commit', { ref, text: el.textContent ?? '', finish: true });
        else emit('item.title.commit', { ref, text: el.textContent?.trim() ?? '', finish: true });
      },
    });
  }, { requires: ['ability.selectable'] });
}
