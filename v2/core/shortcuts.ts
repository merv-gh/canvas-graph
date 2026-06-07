import type { CommandSpec } from '../types';

/** Parsed shape of a shortcut string — used by both keystroke matching and the
 *  override-conflict check. */
export type ParsedShortcut = { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

/** Parse a shortcut string into key + modifier requirements.
 *  Format: `Mod+Mod+Key` e.g. `Ctrl+Shift+P`, `Cmd+K`, `Alt+ArrowRight`, `?`. */
export const parseShortcut = (shortcut: string): ParsedShortcut => {
  const parts = shortcut.split('+').map(p => p.trim()).filter(Boolean);
  const result: ParsedShortcut = { key: '', ctrl: false, shift: false, alt: false, meta: false };
  const rawKey = parts.pop() ?? '';
  result.key = rawKey.toLowerCase() === 'esc' ? 'Escape' : rawKey;
  for (const part of parts) {
    const m = part.toLowerCase();
    if (m === 'ctrl' || m === 'control') result.ctrl = true;
    else if (m === 'shift') result.shift = true;
    else if (m === 'alt' || m === 'option') result.alt = true;
    else if (m === 'meta' || m === 'cmd' || m === 'command') result.meta = true;
  }
  return result;
};

/** Render a CommandSpec.input back to a Ctrl+Shift+K style label. */
export const shortcutLabel = (input: NonNullable<CommandSpec['input']>) => {
  const parts = [
    input.ctrl ? 'Ctrl' : null,
    input.meta ? 'Cmd' : null,
    input.alt ? 'Alt' : null,
    input.shift ? 'Shift' : null,
    input.key,
  ].filter(Boolean);
  return parts.join('+');
};

export const shortcutOf = (command: CommandSpec) =>
  command.shortcut ?? (command.input?.key ? shortcutLabel(command.input) : '');

/** Does this DOM event match the parsed shortcut? Letter keys require shift to
 *  match exactly; non-letter keys trust event.key (so '?' matches Shift+/). */
export const keyMatchesEvent = (event: Event, parsed: ParsedShortcut) => {
  if (!(event instanceof KeyboardEvent)) return false;
  if (event.ctrlKey !== parsed.ctrl) return false;
  if (event.altKey !== parsed.alt) return false;
  if (event.metaKey !== parsed.meta) return false;
  const isLetter = /^[a-z]$/i.test(parsed.key);
  const isNamedKey = parsed.key.length > 1;
  if (isLetter && event.shiftKey !== parsed.shift) return false;
  if (isNamedKey && event.shiftKey !== parsed.shift) return false;
  if (!isLetter && parsed.shift && !event.shiftKey) return false;
  return event.key.toLowerCase() === parsed.key.toLowerCase();
};

export const bindingParsed = (input: NonNullable<CommandSpec['input']>): ParsedShortcut => ({
  key: input.key ?? '',
  ctrl: !!input.ctrl, shift: !!input.shift, alt: !!input.alt, meta: !!input.meta,
});
