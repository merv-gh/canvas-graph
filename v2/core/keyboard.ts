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
  const remove = (capture: KeyboardCapture | null) => capture?.input.remove();
  return {
    active: () => active?.id ?? null,
    capture(id: string) {
      remove(active);
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.dataset.keyboardMode = id;
      input.setAttribute('aria-hidden', 'true');
      input.className = 'keyboard-capture';
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
      active = capture;
      capture.focus();
      return capture;
    },
    release(id?: string) {
      if (id && active?.id !== id) return;
      remove(active);
      active = null;
    },
  };
}

