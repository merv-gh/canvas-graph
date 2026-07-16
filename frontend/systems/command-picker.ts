import { itemRefFrom, refKey, type Registry } from '../core';
import { Places, type CommandSource, type CommandSpec, type ItemRef, type PickerSpec, type PickerStep } from '../types';

declare module '../types' {
  interface CustomEvents {
    'commandPicker.open': { commandId: string; source?: CommandSource };
    'commandPicker.step': { commandId: string; step: string; ref: ItemRef };
    'commandPicker.pick': { ref: ItemRef };
    'commandPicker.cancel': void;
    'commandPicker.submit': { commandId: string; values: Record<string, ItemRef> };
  }
}

/** Letter pool. Order matches a US keyboard home-row reach, so the first few
 *  letters are the easiest to hit (matches jump.ts on purpose). */
const LETTERS = 'asdfghjklqwertyuiopzxcvbnm';
const compactViewport = () => globalThis.innerWidth <= 680
  || globalThis.matchMedia?.('(pointer: coarse)').matches === true;

/** Driver for CommandSpec.picker. Walks each PickerStep in order:
 *
 *    seed → if it returns a ref, fill and advance (one-keystroke fast paths)
 *    otherwise → letter overlays for filtered refs + keyboard.capture
 *
 *  On the final step the picked values are run through `validate`, packed by
 *  `payload`, and forwarded to the command's event. The whole thing lives
 *  next to commandForm so any single-file system can opt into either UI by
 *  declaring `form` or `picker` on its CommandSpec — no system-level glue. */
export function registerCommandPicker(system: Registry) {
  system('commandPicker', ({ on, emit, forward, contexts, origin, frameLoop }) => {
    type Active = {
      commandId: string;
      command: CommandSpec;
      picker: PickerSpec;
      source: CommandSource;
      values: Record<string, ItemRef>;
      stepIndex: number;
      candidates: Set<string>;
      restoreFocus: HTMLElement | null;
      restoreCommand: string;
    };
    let active: Active | null = null;

    const clearStageOverlay = (restoreFocus: HTMLElement | null = null, restoreCommand = '') => {
      contexts.decorations.unregisterOrigin('commandPicker');
      contexts.keyboard.unregisterOrigin('commandPicker');
      emit('render.view.clear', { place: Places.Stage, key: 'picker-prompt' });
      frameLoop.schedule('commandPicker.restoreFocus.prepare', () => {
        // Render flushes may enqueue follow-up patches. Restore in the next
        // frame so focus lands on the final live command button, never a node
        // about to be replaced.
        frameLoop.schedule('commandPicker.restoreFocus.commit', () => {
          const command = restoreCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const shell = contexts.places.el(Places.Top)?.parentElement;
          const fallback = command
            ? shell?.querySelector<HTMLElement>(`[data-command="${command}"]`) ?? null
            : null;
          const target = restoreFocus?.isConnected ? restoreFocus : fallback;
          target?.focus({ preventScroll: true });
        }, 40);
      }, 40);
    };

    const cancel = () => {
      if (!active) return;
      const restoreFocus = active.restoreFocus;
      const restoreCommand = active.restoreCommand;
      active = null;
      clearStageOverlay(restoreFocus, restoreCommand);
    };

    const finish = () => {
      if (!active) return;
      const a = active;
      active = null;
      clearStageOverlay(a.restoreFocus, a.restoreCommand);
      const error = a.picker.validate?.(a.values, a.source);
      if (error) {
        emit('app.notice', { message: error, level: 'warn' });
        return;
      }
      const payload = a.picker.payload(a.values, a.source);
      if (payload == null) return;
      emit('commandPicker.submit', { commandId: a.commandId, values: a.values });
      forward(a.command.event, payload);
    };

    const promptBanner = (step: PickerStep, index: number, total: number) => {
      const el = document.createElement('div');
      el.className = 'picker-prompt';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      const title = document.createElement('strong');
      title.textContent = step.prompt ?? `Pick ${step.id}`;
      const meta = document.createElement('span');
      meta.textContent = total > 1 ? ` (${index + 1}/${total})` : '';
      const hint = document.createElement('em');
      hint.textContent = compactViewport()
        ? ' · Tap a highlighted item'
        : ' · Click a highlighted item or press its letter · Esc to cancel';
      el.append(title, meta, hint);
      return el;
    };

    const runStep = () => {
      if (!active) return;
      const step = active.picker.steps[active.stepIndex];
      if (!step) { finish(); return; }
      const seed = step.seed?.(active.values, active.source);
      if (seed) {
        active.values[step.id] = seed;
        active.stepIndex++;
        runStep();
        return;
      }
      const filterFn = step.filter?.(active.values, active.source) ?? (() => true);
      const targets = contexts.hierarchy.items().filter(target => filterFn(target.ref)).slice(0, LETTERS.length);
      if (!targets.length) {
        emit('app.notice', { message: `Nothing to pick for ${step.prompt ?? step.id}`, level: 'warn' });
        cancel();
        return;
      }
      const letterMap = new Map<string, ItemRef>();
      const overlays = targets.map((target, i) => {
        const letter = LETTERS[i];
        letterMap.set(letter, target.ref);
        return {
          ref: target.ref,
          text: letter.toUpperCase(),
          className: 'picker-letter',
          id: `picker-${letter}`,
        };
      });
      contexts.decorations.overlays.set('commandPicker', overlays);
      active.candidates = new Set(targets.map(target => refKey(target.ref)));
      emit('render.view.set', {
        place: Places.Stage,
        key: 'picker-prompt',
        view: () => promptBanner(step, active!.stepIndex, active!.picker.steps.length),
      });
      // No Escape handling here — the global cancellation system fires
      // app.cancel → cancellationContext routes to our Cancellable below.
      contexts.keyboard.capture('commandPicker', {
        onKey(event) {
          if (event.key === 'Escape') return;  // let the global Esc binding fire
          const letter = event.key.toLowerCase();
          if (!/^[a-z]$/.test(letter)) return;
          event.preventDefault();
          const ref = letterMap.get(letter);
          if (!ref || !active) { emit('commandPicker.cancel'); return; }
          emit('commandPicker.pick', { ref });
        },
      });
    };

    const pick = (ref: ItemRef) => {
      if (!active || !active.candidates.has(refKey(ref))) return;
      const step = active.picker.steps[active.stepIndex];
      if (!step) return;
      active.values[step.id] = ref;
      active.stepIndex++;
      emit('commandPicker.step', { commandId: active.commandId, step: step.id, ref });
      contexts.keyboard.unregisterOrigin('commandPicker');
      contexts.decorations.unregisterOrigin('commandPicker');
      runStep();
    };

    contexts.commands.register([{
      id: 'commandPicker.pick.pointer',
      label: 'Pick item with pointer',
      event: 'commandPicker.pick',
      group: 'modal',
      hidden: true,
      input: {
        on: 'pointerdown',
        selector: '[data-item-kind][data-item-id]',
        when: (_event, target) => {
          const ref = itemRefFrom(target);
          return !!active && !!ref && active.candidates.has(refKey(ref));
        },
        prevent: true,
        stop: true,
      },
      payload: ({ target }) => {
        const ref = itemRefFrom(target);
        return ref ? { ref } : undefined;
      },
    }]);

    on('commandPicker.open', ({ commandId, source }) => {
      const command = contexts.commands.get(commandId);
      if (!command?.picker) return;
      const pickerSource: CommandSource = source ?? { origin: 'keyboard' };
      cancel();
      frameLoop.cancel('commandPicker.restoreFocus.prepare');
      frameLoop.cancel('commandPicker.restoreFocus.commit');
      const sourceTarget = pickerSource.target instanceof HTMLElement ? pickerSource.target : null;
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const restoreFocus = sourceTarget ?? focused;
      active = {
        commandId,
        command,
        picker: command.picker,
        source: pickerSource,
        values: {},
        stepIndex: 0,
        candidates: new Set(),
        restoreFocus,
        restoreCommand: restoreFocus?.closest<HTMLElement>('[data-command]')?.dataset.command ?? '',
      };
      runStep();
    });
    on('commandPicker.pick', ({ ref }) => pick(ref));
    on('commandPicker.cancel', cancel);
    // A picker is scoped to the graph and canvas context where it started.
    // Switching documents or opening an unrelated modal must never leave a
    // stale step/candidate set waiting behind the new surface.
    on('graph.switched', cancel);
    on('modal.open', cancel);
    contexts.cancellation.register({
      origin,
      active: () => !!active,
      cancel: () => emit('commandPicker.cancel'),
    });

    return () => {
      frameLoop.cancel('commandPicker.restoreFocus.prepare');
      frameLoop.cancel('commandPicker.restoreFocus.commit');
      cancel();
      frameLoop.cancel('commandPicker.restoreFocus.prepare');
      frameLoop.cancel('commandPicker.restoreFocus.commit');
    };
  }, { requires: ['render.stage', 'graph'] });
}
