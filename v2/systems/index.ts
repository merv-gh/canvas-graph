import type { Registry } from '../core';
import { registerCancellation } from './cancellation';
import { registerCollections } from './collections';
import { registerCommandModal } from './command-modal';
import { registerCommandForm } from './command-form';
import { registerCommandPicker } from './command-picker';
import { registerDemo } from './demo';
import { registerDx } from './dx';
import { registerFocus } from './focus';
import { registerGraph } from './graph';
import { registerInput } from './input';
import { registerJump } from './jump';
import { registerLayout } from './layout';
import { registerLog } from './log';
import { registerMain } from './main';
import { registerModal } from './modal';
import { registerOutline } from './outline';
import { registerRender } from './render';
import { registerRenderStage } from './render-stage';
import { registerViewPan } from './view-pan';
import { registerViewZoom } from './view-zoom';

export function registerSystems(system: Registry) {
  registerRender(system);
  registerRenderStage(system);
  registerInput(system);
  registerCancellation(system);
  registerMain(system);
  registerLog(system);
  registerOutline(system);
  registerModal(system);
  registerCommandForm(system);
  registerCommandPicker(system);
  registerCommandModal(system);
  // Jump must register before `collections` so its `g` binding sits earlier in
  // the input router's enabled() iteration — combined with `stop: true` it then
  // shadows `graph.switch.next` instead of doubling up.
  registerJump(system);
  registerCollections(system);
  registerGraph(system);
  registerViewZoom(system);
  registerViewPan(system);
  registerFocus(system);
  registerLayout(system);
  registerDemo(system);
  registerDx(system);

  const deps: Record<string, string[]> = {
    render: ['input'],
    'render.stage': ['render', 'graph'],
    cancellation: ['input'],
    jump: ['render.stage', 'graph', 'focus', 'view.zoom'],
    main: ['render'],
    log: ['render'],
    outline: ['render', 'graph'],
    modal: ['render'],
    commandForm: ['modal'],
    commandPicker: ['render.stage', 'graph'],
    commandModal: ['modal'],
    collections: ['graph'],
    'view.zoom': ['render'],
    'view.pan': ['render'],
    focus: ['graph'],
    layout: ['graph'],
    demo: ['graph', 'render'],
  };
  Object.entries(deps).forEach(([name, list]) => system.setRequires(name, list));
}
