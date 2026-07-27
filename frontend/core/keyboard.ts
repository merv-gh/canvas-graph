/** Optional hooks for keyboard.capture — lets a system react to keys without
 *  reaching for document.addEventListener (which would bypass the input router).
 *  onKey fires for every keydown on the captured input; onInput for value
 *  changes (useful for live-search captures). */
export type KeyboardCaptureOptions = {
  onKey?: (event: KeyboardEvent, capture: KeyboardCapture) => void;
  onInput?: (event: Event, capture: KeyboardCapture) => void;
  className?: string;
};

export type KeyboardCapture = {
  id: string;
  input: HTMLInputElement;
  focus(): void;
  clear(): void;
  value(): string;
  stop(): void;
};

export function keyboardCaptureContext() {
  let active: KeyboardCapture | null = null;
  const teardowns = new WeakMap<KeyboardCapture, () => void>();
  const remove = (capture: KeyboardCapture | null) => {
    if (!capture) return;
    teardowns.get(capture)?.();
    teardowns.delete(capture);
    capture.input.remove();
  };
  return {
    active: () => active?.id ?? null,
    capture(id: string, options: KeyboardCaptureOptions = {}) {
      remove(active);
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.dataset.keyboardMode = id;
      input.setAttribute('aria-hidden', 'true');
      input.className = ['keyboard-capture', options.className].filter(Boolean).join(' ');
      document.body.append(input);
      const capture: KeyboardCapture = {
        id,
        input,
        focus: () => input.focus({ preventScroll: true }),
        clear: () => { input.value = ''; },
        value: () => input.value,
        stop: () => {
          if (active === capture) active = null;
          remove(capture);
        },
      };
      const keyHandler = options.onKey ? (event: KeyboardEvent) => options.onKey!(event, capture) : null;
      const inputHandler = options.onInput ? (event: Event) => options.onInput!(event, capture) : null;
      // Exclusive capture must survive focus theft: a modal closing right
      // after the capture starts (palette → picker) restores focus elsewhere,
      // which would silently disconnect the keyboard. Re-take focus while the
      // capture is still the active one.
      const blurHandler = () => {
        setTimeout(() => { if (active === capture) capture.focus(); }, 0);
      };
      if (keyHandler) input.addEventListener('keydown', keyHandler);
      if (inputHandler) input.addEventListener('input', inputHandler);
      input.addEventListener('blur', blurHandler);
      teardowns.set(capture, () => {
        if (keyHandler) input.removeEventListener('keydown', keyHandler);
        if (inputHandler) input.removeEventListener('input', inputHandler);
        input.removeEventListener('blur', blurHandler);
      });
      active = capture;
      capture.focus();
      return capture;
    },
    unregisterOrigin(origin: string) {
      if (active?.id !== origin) return;
      remove(active);
      active = null;
    },
  };
}

