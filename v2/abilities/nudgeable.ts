import { sameItemRef, type Registry } from '../core';
import type { ActionDef, ItemRef, NonEmptyArray } from '../types';
import { ability, action } from './shared';
import type { Positioned } from './shapes';

declare module '../types' {
  interface CustomEvents {
    /** Move the whole chosen set by a delta. Fanned out to per-item item.update. */
    'item.nudge': { dx: number; dy: number };
  }
}

const NUDGE_DIRECTIONS = [
  { dir: 'right', key: 'ArrowRight', dx: 24, dy: 0 },
  { dir: 'left',  key: 'ArrowLeft',  dx: -24, dy: 0 },
  { dir: 'up',    key: 'ArrowUp',    dx: 0, dy: -24 },
  { dir: 'down',  key: 'ArrowDown',  dx: 0, dy: 24 },
] as const;

/** Nudgeable — any positioned item can be moved by arrow keys when chosen.
 *  Keyboard-only: the affordance is the shortcut on the paletteCommand. Moves
 *  the entire chosen set, so arrows move 1 or N items with the same keystroke. */
export const nudgeable = <T extends Positioned>() => ability<T>('nudgeable',
  NUDGE_DIRECTIONS.map(({ dir }) => action<T>({
    id: `item.nudge.${dir}`,
    label: `Nudge ${dir}`,
    paletteCommand: `item.nudge.${dir}`,
  })) as NonEmptyArray<ActionDef<T>>,
);

export function registerNudgeable(system: Registry) {
  system('ability.nudgeable', ({ on, emit, contexts, graphs, selection }) => {
    const hasPositioned = () => selection.selectedAll().some(ref => {
      const item = graphs.current.getItem(ref) as Positioned | undefined;
      return !!item?.Position;
    });

    contexts.commands.register(
      NUDGE_DIRECTIONS.map(({ dir, key, dx, dy }) => ({
        id: `item.nudge.${dir}`,
        label: `Nudge ${dir}`,
        event: 'item.nudge' as const,
        group: 'item',
        shortcut: key,
        input: { on: 'keydown' as const, key, prevent: true },
        available: () => hasPositioned(),
        payload: () => ({ dx, dy }),
      })),
    );

    // Move the whole chosen set. Skip members whose ancestor is also chosen —
    // the ancestor's drag-cascade (containers) already shifts them, so applying
    // the delta again would double-move. One keystroke moves the set coherently.
    on('item.nudge', ({ dx, dy }) => {
      const all = selection.selectedAll();
      const inSet = (ref: ItemRef) => all.some(r => sameItemRef(r, ref));
      all.forEach(ref => {
        if (contexts.hierarchy.parentChain(ref).some(inSet)) return;
        const item = graphs.current.getItem(ref) as Positioned | undefined;
        if (!item?.Position) return;
        emit('item.update', { ref, patch: { Position: { x: item.Position.x + dx, y: item.Position.y + dy } } });
      });
    });
  }, { requires: ['ability.selectable'] });
}
