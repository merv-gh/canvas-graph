import type { GraphNode } from '../model';
import type { Registry } from '../core';
import type { ActionDef, NodeEntity, NonEmptyArray } from '../types';
import { ability, action } from './shared';

const NUDGE_DIRECTIONS = [
  { dir: 'right', key: 'ArrowRight', dx: 24, dy: 0 },
  { dir: 'left',  key: 'ArrowLeft',  dx: -24, dy: 0 },
  { dir: 'up',    key: 'ArrowUp',    dx: 0, dy: -24 },
  { dir: 'down',  key: 'ArrowDown',  dx: 0, dy: 24 },
] as const;

export const nudgeable = <T extends NodeEntity>() => ability<T>('nudgeable',
  NUDGE_DIRECTIONS.map(({ dir, key }) => action<T>({
    id: `node.nudge.${dir}`,
    label: `Nudge node ${dir}`,
    paletteCommand: `graph.node.nudge.${dir}`,
    ui: [{ surface: 'palette', command: `graph.node.nudge.${dir}`, kind: 'shortcut' }],
  })) as NonEmptyArray<ActionDef<T>>,
);

export function registerNudgeable(system: Registry) {
  system('ability.nudgeable', ({ contexts, selection }) => {
    const selectedNode = () => selection.selectedNode() as GraphNode | undefined;
    contexts.commands.register(
      NUDGE_DIRECTIONS.map(({ dir, key, dx, dy }) => ({
        id: `graph.node.nudge.${dir}`,
        label: `Nudge node ${dir}`,
        event: 'graph.node.update' as const,
        group: 'node',
        shortcut: key,
        input: { on: 'keydown' as const, key, prevent: true },
        available: () => !!selectedNode(),
        payload: () => {
          const node = selectedNode()!;
          const pos = node.Position ?? { x: 0, y: 0 };
          return { id: node.id, patch: { Position: { x: pos.x + dx, y: pos.y + dy } } };
        },
      })),
    );
  });
}
