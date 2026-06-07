import type { Registry } from '../core';
import { registerCollections } from './collections';
import { registerCommandModal } from './command-modal';
import { registerCommandForm } from './command-form';
import { registerDemo } from './demo';
import { registerDx } from './dx';
import { registerFocus } from './focus';
import { registerGraph } from './graph';
import { registerInput } from './input';
import { registerLayout } from './layout';
import { registerLog } from './log';
import { registerMain } from './main';
import { registerModal } from './modal';
import { registerOutline } from './outline';
import { registerRender } from './render';
import { registerViewPan } from './view-pan';
import { registerViewZoom } from './view-zoom';

export function registerSystems(system: Registry) {
  registerRender(system);
  registerInput(system);
  registerMain(system);
  registerLog(system);
  registerOutline(system);
  registerModal(system);
  registerCommandForm(system);
  registerCommandModal(system);
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
    main: ['render'],
    log: ['render'],
    outline: ['render', 'graph'],
    modal: ['render'],
    commandForm: ['modal'],
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
