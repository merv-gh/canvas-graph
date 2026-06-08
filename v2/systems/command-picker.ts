import type { Registry } from '../core';
import { Places, type CommandSource, type CommandSpec, type ItemRef, type PickerSpec, type PickerStep } from '../types';

/** Letter pool. Order matches a US keyboard home-row reach, so the first few
 *  letters are the easiest to hit (matches jump.ts on purpose). */
const LETTERS = 'asdfghjklqwertyuiopzxcvbnm';

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
  system('commandPicker', ({ on, emit, forward, contexts, origin }) => {
    type Active = {
      commandId: string;
      command: CommandSpec;
      picker: PickerSpec;
      source: CommandSource;
      values: Record<string, ItemRef>;
      stepIndex: number;
    };
    let active: Active | null = null;

    const clearStageOverlay = () => {
      contexts.itemOverlays.unregisterOrigin('commandPicker');
      contexts.keyboard.unregisterOrigin('commandPicker');
      emit('render.view.clear', { place: Places.Stage, key: 'picker-prompt' });
    };

    const cancel = () => {
      if (!active) return;
      active = null;
      clearStageOverlay();
    };

    const finish = () => {
      if (!active) return;
      const a = active;
      active = null;
      clearStageOverlay();
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
      const title = document.createElement('strong');
      title.textContent = step.prompt ?? `Pick ${step.id}`;
      const meta = document.createElement('span');
      meta.textContent = total > 1 ? ` (${index + 1}/${total})` : '';
      const hint = document.createElement('em');
      hint.textContent = ' · Esc to cancel';
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
      const targets = contexts.itemTargets.all().filter(target => filterFn(target.ref)).slice(0, LETTERS.length);
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
      contexts.itemOverlays.set('commandPicker', overlays);
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
          active.values[step.id] = ref;
          active.stepIndex++;
          emit('commandPicker.step', { commandId: active.commandId, step: step.id, ref });
          contexts.keyboard.unregisterOrigin('commandPicker');
          contexts.itemOverlays.unregisterOrigin('commandPicker');
          runStep();
        },
      });
    };

    on('commandPicker.open', ({ commandId, source }) => {
      const command = contexts.commands.get(commandId);
      if (!command?.picker) return;
      const pickerSource: CommandSource = source ?? { origin: 'keyboard' };
      cancel();
      active = {
        commandId,
        command,
        picker: command.picker,
        source: pickerSource,
        values: {},
        stepIndex: 0,
      };
      runStep();
    });
    on('commandPicker.cancel', cancel);
    contexts.cancellation.register({
      origin,
      active: () => !!active,
      cancel: () => emit('commandPicker.cancel'),
    });

    return cancel;
  });
}
