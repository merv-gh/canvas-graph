import { registerAbilitySystems } from './abilities';
import { createAppContext, createFlags, localStorageIo, memoryIo, registry } from './core';
import { registerFeatures } from './features';
import { appModel, graphStore } from './model';
import { registerSystems } from './systems';

const systems = registry();
const features = registry();

registerSystems(systems);
registerAbilitySystems(systems);
registerFeatures(features);

window.addEventListener('DOMContentLoaded', () => {
  // Pick io adapter. localStorage in production; memory mode in tests or kiosk boot.
  // Use ?io=memory in URL to opt out of persistence at boot.
  const useMemoryIo = new URLSearchParams(location.search).get('io') === 'memory';
  const io = useMemoryIo ? memoryIo() : localStorageIo();

  // Single source of truth — flip a key here (or via window.v2.flags.set) to disable a system or ability.
  // Persistence: any change writes via the io adapter (default localStorage 'v2.flags').
  const flags = createFlags({
    // systems
    render: true, input: true, main: true, log: true, outline: true,
    modal: true, commandForm: true, commandModal: true, domain: true, graph: true,
    'view.zoom': true, 'view.pan': true, focus: true, layout: true, dx: true, demo: true,
    // abilities
    'ability.selectable': true,
    'ability.draggable': true,
    'ability.nudgeable': true,
    'ability.collapsible': true,
    'ability.editable': true,
    'ability.configurable': true,
    // features
    nodeLifecycle: true,
  }, io);
  const ctx = createAppContext(graphStore(), appModel, flags, io);
  systems.start(ctx);
  features.start(ctx);
  ctx.bus.emit('app.start');
  window.v2 = ctx;
});

export {};
