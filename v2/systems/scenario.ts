import { parseShortcut, type Registry } from '../core';
import { Places } from '../types';

/**
 * scenario — replay a keystroke macro, for shareable reproductions and fix demos.
 *
 * A scenario is the exact keyboard sequence a user would type, encoded as a
 * small string and (optionally) carried in the URL: `?scenario=A;A;E;a;b`.
 * Opening that URL replays it visibly — each keystroke synthesized as a real
 * keydown on the focused element, so commands, pickers, jump, and inline edit
 * all replay through the app's own routing. A floating HUD shows progress.
 *
 * Token grammar (`;`-separated; URL-encode the whole value):
 *   - a key / shortcut written as Help shows it: `A` `E` `Z` `\` `Tab` `Enter`
 *     `Escape` `Shift+A` `Ctrl+A` `?` `0`..`9`. Case-insensitive letters.
 *   - `"some text"` / `'some text'` → typed into the focused inline editor.
 *   - `wait` → pause one extra beat (let an animation settle).
 *
 * This is presentation + reproduction infrastructure: inert unless `?scenario=`
 * is present or `window.v2.scenario.play(...)` is called (tests/devtools).
 */

declare module '../types' {
  interface CustomEvents {
    'scenario.play': { script: string; speed?: number };
    'scenario.step': { index: number; total: number; token: string };
    'scenario.done': void;
  }
  interface CustomExposable {
    scenario?: { play(script: string, opts?: { speed?: number }): void };
  }
}

type Token = { kind: 'key'; value: string } | { kind: 'type'; value: string } | { kind: 'wait' };

/** Quote-aware tokenizer: `;`-separated, but quoted text may contain `;`/spaces. */
export function parseScenario(script: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = script.trim();
  while (i < s.length) {
    const ch = s[i];
    if (ch === ';' || ch === ' ') { i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1, text = '';
      while (j < s.length && s[j] !== ch) { text += s[j]; j++; }
      tokens.push({ kind: 'type', value: text });
      i = j + 1;
    } else {
      let j = i, raw = '';
      while (j < s.length && s[j] !== ';') { raw += s[j]; j++; }
      raw = raw.trim();
      if (raw) tokens.push(raw.toLowerCase() === 'wait' ? { kind: 'wait' } : { kind: 'key', value: raw });
      i = j + 1;
    }
  }
  return tokens;
}

const KEY_ALIASES: Record<string, string> = { space: ' ', enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete' };

export function registerScenario(system: Registry) {
  system('scenario', ({ on, emit, contexts, expose, origin }) => {
    let hud: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const shell = () => contexts.places.el(Places.Top)?.parentElement ?? null;
    const ensureHud = () => {
      if (hud && hud.isConnected) return hud;
      const el = document.createElement('div');
      el.className = 'scenario-hud';
      el.dataset.scenario = origin;
      shell()?.append(el);
      hud = el;
      return el;
    };
    const setHud = (text: string, done = false) => {
      const el = ensureHud();
      el.textContent = text;
      el.classList.toggle('done', done);
    };
    const clearHud = () => { hud?.remove(); hud = null; };

    /** Synthesize one keydown on the focused element (falls back to document) so
     *  the keystroke flows through the real input router / active capture. */
    const pressKey = (token: string) => {
      const p = parseShortcut(token);
      const key = KEY_ALIASES[p.key.toLowerCase()] ?? p.key;
      // Dispatch on an Element, never the Document — the input router reads
      // `event.target` and skips non-Element targets. Focused element when one
      // is active (pickers / inline edit capture their keys); body otherwise.
      const active = document.activeElement;
      const target: Element = (active instanceof Element && active.isConnected && active !== document.body)
        ? active : document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key, shiftKey: p.shift, ctrlKey: p.ctrl, altKey: p.alt, metaKey: p.meta, bubbles: true, cancelable: true,
      }));
    };

    /** Type text into the focused inline editor (contenteditable or input). */
    const typeText = (text: string) => {
      const el = document.activeElement as (HTMLElement & { value?: string }) | null;
      if (!el || el === document.body) return;
      if (el.isContentEditable) { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
      else if ('value' in el) { (el as HTMLInputElement).value = text; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    };

    const play = (script: string, speed = 650) => {
      const tokens = parseScenario(script);
      if (!tokens.length) return;
      let index = 0;
      const human = (t: Token) => t.kind === 'type' ? `"${t.value}"` : t.kind === 'wait' ? '⏸' : t.value;
      const tick = () => {
        if (index >= tokens.length) {
          setHud(`✓ scenario complete · ${tokens.length} steps`, true);
          emit('scenario.done');
          timer = setTimeout(clearHud, 4000);
          return;
        }
        const token = tokens[index];
        setHud(`▶ step ${index + 1}/${tokens.length} · ${human(token)}`);
        emit('scenario.step', { index, total: tokens.length, token: human(token) });
        if (token.kind === 'key') pressKey(token.value);
        else if (token.kind === 'type') typeText(token.value);
        index++;
        timer = setTimeout(tick, token.kind === 'wait' ? speed * 2 : speed);
      };
      // Let boot settle (first render + DX microtask) before the first keystroke.
      setHud(`▶ scenario · ${tokens.length} steps`);
      timer = setTimeout(tick, speed);
    };

    contexts.commands.register([{
      id: 'scenario.play', label: 'Play scenario', group: 'scenario', hidden: true,
      payload: () => ({ script: '' }),
    }]);
    on('scenario.play', ({ script, speed }) => { if (script) play(script, speed); });
    expose('scenario', { play: (script, opts) => play(script, opts?.speed) });

    // Autoplay from the URL once everything has started.
    on('app.start', () => {
      const param = new URLSearchParams(location.search).get('scenario');
      if (param) play(param);
    });

    return () => { if (timer) clearTimeout(timer); clearHud(); };
  }, { requires: ['input', 'render'] });
}
