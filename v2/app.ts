import { registerAbilitySystems } from './abilities';
import { createAppContext, registry } from './core';
import { registerFeatures } from './features';
import { appModel, graphStore } from './model';
import { registerSystems } from './systems';

const systems = registry();
const features = registry();

registerSystems(systems);
registerAbilitySystems(systems);
registerFeatures(features);

window.addEventListener('DOMContentLoaded', () => {
  const ctx = createAppContext(graphStore(), appModel);
  systems.start(ctx);
  features.start(ctx, () => ctx.bus.emit('app.start'));
  window.v2 = ctx;
});

export {};
