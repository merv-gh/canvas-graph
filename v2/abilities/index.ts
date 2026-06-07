import type { Registry } from '../core';
import { registerCollapsible } from './collapsible';
import { registerConfigurable } from './configurable';
import { registerDraggable } from './draggable';
import { registerEditable } from './editable';
import { registerNudgeable } from './nudgeable';
import { registerSelectable } from './selectable';

export { collapsible } from './collapsible';
export { configurable } from './configurable';
export { draggable } from './draggable';
export { editable } from './editable';
export { nudgeable } from './nudgeable';
export { selectable } from './selectable';

export function registerAbilitySystems(system: Registry) {
  registerSelectable(system);
  registerDraggable(system);
  registerNudgeable(system);
  registerCollapsible(system);
  registerEditable(system);
  registerConfigurable(system);

  const deps: Record<string, string[]> = {
    'ability.nudgeable': ['ability.selectable'],
    'ability.collapsible': ['ability.selectable'],
    'ability.editable': ['ability.selectable'],
    'ability.configurable': ['ability.selectable', 'modal'],
  };
  Object.entries(deps).forEach(([name, list]) => system.setRequires(name, list));
}
