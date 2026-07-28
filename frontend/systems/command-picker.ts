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
  system('commandPicker', ({ on, emit, forward, contexts, graphs, origin, frameLoop }) => {
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
      canvasRef: ItemRef | null;
      canvasLetter: string;
    };
    let active: Active | null = null;

    const clearStageOverlay = (restoreFocus: HTMLElement | null = null, restoreCommand = '') => {
      contexts.decorations.unregisterOrigin('commandPicker');
      contexts.interaction.keys.unregisterOrigin('commandPicker');
      emit('render.view.clear', { place: Places.Stage, key: 'picker-prompt' });
      contexts.places.el(Places.Stage)?.classList.remove('picker-canvas-target');
      frameLoop.schedule('commandPicker.restoreFocus.prepare', () => {
        // Render flushes may enqueue follow-up patches. Reconcile for a few
        // frames because a focused command can be replaced by a later patch.
        // Never steal focus when the user already moved somewhere else.
        let remaining = 16;
        const commit = () => {
          const command = restoreCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const shell = contexts.places.el(Places.Top)?.parentElement;
          const replacement = command
            ? shell?.querySelector<HTMLElement>(`[data-command="${command}"]`) ?? null
            : null;
          const stableFallback = shell?.querySelector<HTMLElement>(
            '[aria-label="Current graph name"], [data-place="top"] button, [data-place="top"] input',
          ) ?? null;
          const target = restoreFocus?.isConnected ? restoreFocus : replacement ?? stableFallback;
          const focused = document.activeElement;
          if (!focused || focused === document.body) target?.focus({ preventScroll: true });
          if (--remaining > 0) frameLoop.schedule('commandPicker.restoreFocus.commit', commit, 40);
        };
        frameLoop.schedule('commandPicker.restoreFocus.commit', commit, 40);
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
      if (active?.canvasRef) {
        const canvas = document.createElement('button');
        canvas.type = 'button';
        canvas.className = 'picker-canvas-option';
        canvas.dataset.command = 'commandPicker.pick.canvas';
        canvas.dataset.pickerCanvas = '';
        canvas.textContent = `${active.canvasLetter.toUpperCase()} · ${step.canvasLabel ?? 'Canvas'}`;
        canvas.setAttribute('aria-label', `Move to ${step.canvasLabel ?? 'Canvas'}`);
        el.append(canvas);
      }
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
      const canvasRef: ItemRef | null = step.canvas?.(active.values, active.source)
        ? { kind: 'graph', id: graphs.current.id }
        : null;
      const itemLimit = LETTERS.length - (canvasRef ? 1 : 0);
      const itemTargets = contexts.hierarchy.items().filter(target => filterFn(target.ref)).slice(0, itemLimit);
      const targets = canvasRef
        ? [{ ref: canvasRef, label: step.canvasLabel ?? 'Canvas' }, ...itemTargets]
        : itemTargets;
      if (!targets.length) {
        emit('app.notice', { message: `Nothing to pick for ${step.prompt ?? step.id}`, level: 'warn' });
        cancel();
        return;
      }
      const letterMap = new Map<string, ItemRef>();
      const overlays = targets.map((target, i) => {
        const letter = LETTERS[i];
        letterMap.set(letter, target.ref);
        if (target.ref.kind === 'graph') return null;
        return {
          ref: target.ref,
          text: letter.toUpperCase(),
          className: 'picker-letter',
          id: `picker-${letter}`,
        };
      }).filter((overlay): overlay is NonNullable<typeof overlay> => !!overlay);
      contexts.decorations.overlays.set('commandPicker', overlays);
      contexts.decorations.modes.set('commandPicker', 'candidate', itemTargets.map(target => target.ref), 'picker-candidate');
      active.candidates = new Set(targets.map(target => refKey(target.ref)));
      active.canvasRef = canvasRef;
      active.canvasLetter = canvasRef ? LETTERS[0] : '';
      const stage = contexts.places.el(Places.Stage);
      stage?.classList.toggle('picker-canvas-target', !!canvasRef);
      emit('render.view.set', {
        place: Places.Stage,
        key: 'picker-prompt',
        view: () => promptBanner(step, active!.stepIndex, active!.picker.steps.length),
      });
      // No Escape handling here — the global cancellation system fires
      // app.cancel → cancellationContext routes to our Cancellable below.
      contexts.interaction.keys.capture('commandPicker', {
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
      contexts.interaction.keys.unregisterOrigin('commandPicker');
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
    }, {
      id: 'commandPicker.pick.canvas',
      label: 'Pick canvas destination',
      event: 'commandPicker.pick',
      group: 'modal',
      hidden: true,
      payload: () => active?.canvasRef ? { ref: active.canvasRef } : undefined,
    }, {
      id: 'commandPicker.pick.canvas.pointer',
      label: 'Pick canvas destination with pointer',
      event: 'commandPicker.pick',
      group: 'modal',
      hidden: true,
      input: {
        on: 'pointerdown', selector: '[data-place="stage"]', prevent: true, stop: true,
        when: event => !!active?.canvasRef
          && !(event.target as Element | null)?.closest('[data-item-kind][data-item-id], .tool-panel, .item-toolbar, .picker-prompt, .modal-layer'),
      },
      payload: () => active?.canvasRef ? { ref: active.canvasRef } : undefined,
    }]);

    on('commandPicker.open', ({ commandId, source }) => {
      const command = contexts.commands.get(commandId);
      if (!command?.picker) return;
      const pickerSource: CommandSource = source ?? { origin: 'keyboard' };
      cancel();
      // A picker is itself a pointer interaction. Entering it must replace
      // placement/draw/erase instead of leaving an older mode to intercept the
      // target click underneath the picker overlays.
      contexts.interaction.cancel.cancelPointerModes();
      frameLoop.cancel('commandPicker.restoreFocus.prepare');
      frameLoop.cancel('commandPicker.restoreFocus.commit');
      const sourceElement = pickerSource.target instanceof Element ? pickerSource.target : null;
      // Pointer events often originate on an icon/span inside the command.
      // Restore to the actual focusable command owner, not that inert child.
      const sourceTarget = sourceElement?.closest<HTMLElement>('[data-command], button, [href], input, select, textarea, [tabindex]') ?? null;
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
        canvasRef: null,
        canvasLetter: '',
      };
      runStep();
    });
    on('commandPicker.pick', payload => { if (payload?.ref) pick(payload.ref); });
    on('commandPicker.cancel', cancel);
    // A picker is scoped to the graph and canvas context where it started.
    // Switching documents or opening an unrelated modal must never leave a
    // stale step/candidate set waiting behind the new surface.
    on('graph.switched', cancel);
    on('modal.open', cancel);
    contexts.interaction.cancel.register({
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
