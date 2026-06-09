import type { Registry } from '../core';
import type { ActionDef, NonEmptyArray, Position } from '../types';
import { ability, action } from './shared';
import type { Positioned } from './shapes';

const NUDGE_DIRECTIONS = [
  { dir: 'right', key: 'ArrowRight', dx: 24, dy: 0 },
  { dir: 'left',  key: 'ArrowLeft',  dx: -24, dy: 0 },
  { dir: 'up',    key: 'ArrowUp',    dx: 0, dy: -24 },
  { dir: 'down',  key: 'ArrowDown',  dx: 0, dy: 24 },
] as const;

/** Nudgeable — any positioned item can be moved by arrow keys when selected.
 *  Keyboard-only: the affordance is the shortcut on the paletteCommand. */
export const nudgeable = <T extends Positioned>() => ability<T>('nudgeable',
  NUDGE_DIRECTIONS.map(({ dir }) => action<T>({
    id: `item.nudge.${dir}`,
    label: `Nudge ${dir}`,
    paletteCommand: `item.nudge.${dir}`,
  })) as NonEmptyArray<ActionDef<T>>,
);

export function registerNudgeable(system: Registry) {
  system('ability.nudgeable', ({ contexts, graphs, selection }) => {
    /** A positioned selected item, or null. Works for any kind. */
    const positioned = (): { ref: import('../types').ItemRef; Position: Position } | null => {
      const ref = selection.selected();
      if (!ref) return null;
      const item = graphs.current.getItem(ref) as Positioned | undefined;
      if (!item?.Position) return null;
      return { ref, Position: item.Position };
    };

    contexts.commands.register(
      NUDGE_DIRECTIONS.map(({ dir, key, dx, dy }) => ({
        id: `item.nudge.${dir}`,
        label: `Nudge ${dir}`,
        event: 'item.update' as const,
        group: 'item',
        shortcut: key,
        input: { on: 'keydown' as const, key, prevent: true },
        available: () => !!positioned(),
        payload: () => {
          const p = positioned()!;
          return { ref: p.ref, patch: { Position: { x: p.Position.x + dx, y: p.Position.y + dy } } };
        },
      })),
    );
  });
}
