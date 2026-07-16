import { appendRenderable, type Registry } from '../core';
import { Places } from '../types';
import type { Renderable } from '../types';

export function registerModal(system: Registry) {
  system('modal', ({ on, emit, contexts, origin, frameLoop }) => {
    let open = false;
    let restoreFocus: HTMLElement | null = null;
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingNotice: { message: string; level: 'info' | 'warn' | 'error' } | null = null;
    const setBackgroundInert = (inert: boolean) => {
      const slot = contexts.places.el(Places.Modal);
      const shell = slot?.parentElement;
      [...(shell?.children ?? [])].forEach(child => {
        if (child === slot || !(child instanceof HTMLElement)) return;
        if (inert) {
          child.setAttribute('inert', '');
          child.setAttribute('aria-hidden', 'true');
        } else {
          child.removeAttribute('inert');
          child.removeAttribute('aria-hidden');
        }
      });
    };
    // `modal.open` is an event other systems emit (commandForm, configurable,
    // debug) — not a user command, so it has no toolbar button. Only `modal.close`
    // is a real command (backdrop / Close button / Escape via the Cancellable).
    contexts.commands.register([
      { id: 'modal.close', label: 'Close modal', group: 'modal' },
    ]);
    contexts.cancellation.register({
      origin,
      active: () => open,
      cancel: () => emit('modal.close'),
    });

    on('modal.close', () => {
      open = false;
      setBackgroundInert(false);
      emit('render.view.clear', { place: Places.Modal, key: 'modal' });
      emit('modal.closed');
      const target = restoreFocus;
      restoreFocus = null;
      queueMicrotask(() => target?.focus({ preventScroll: true }));
    });
    on('modal.open', ({ title = 'Modal', titleView, body, visual = 'panel' }) => {
      if (!open) restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      open = true;
      setBackgroundInert(true);
      const bodyRenderable: Renderable | undefined = body;
      emit('render.view.set', {
        place: Places.Modal,
        key: 'modal',
        view: () => {
          const modal = contexts.templates.clone('modal');
          modal.dataset.visual = visual;
          const titleSlot = modal.querySelector<HTMLElement>('[data-text="title"]');
          if (titleView && titleSlot) {
            titleSlot.textContent = '';
            appendRenderable(titleSlot, titleView);
          } else {
            contexts.templates.text(modal, 'title', title);
          }
          if (bodyRenderable) appendRenderable(contexts.templates.slot(modal, 'body'), bodyRenderable);
          return modal;
        },
      });
      // Explicit form autofocus wins. Otherwise focus Close: users hear the
      // dialog title first and never land deep inside long onboarding content.
      queueMicrotask(() => {
        const root = contexts.places.el(Places.Modal);
        const target = root?.querySelector('[autofocus]')
          ?? root?.querySelector('button[data-command="modal.close"]')
          ?? root?.querySelector('input:not([type="hidden"]):not([disabled]), textarea, select');
        (target as HTMLElement | null)?.focus();
      });
    });
    on('app.notice', ({ message, level = 'info' }) => {
      pendingNotice = { message, level };
      // Coalesce bursts: imports and diagnostics may emit many notices in one
      // task. One frame shows the latest without turning bus dispatch into DOM IO.
      frameLoop.schedule('modal.notice', () => {
        const next = pendingNotice;
        pendingNotice = null;
        if (!next) return;
        if (noticeTimer) clearTimeout(noticeTimer);
        const notice = document.createElement('div');
        notice.className = `app-notice app-notice-${next.level}`;
        notice.textContent = next.message;
        notice.setAttribute('role', next.level === 'error' ? 'alert' : 'status');
        notice.setAttribute('aria-live', next.level === 'error' ? 'assertive' : 'polite');
        emit('render.view.set', { place: Places.Modal, key: 'notice', view: notice });
        noticeTimer = setTimeout(() => emit('render.view.clear', { place: Places.Modal, key: 'notice' }), 3200);
      }, 30);
    });
    return () => {
      frameLoop.cancel('modal.notice');
      if (noticeTimer) clearTimeout(noticeTimer);
    };
  }, { requires: ['render'] });
}
