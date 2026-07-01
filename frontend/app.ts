import { registerAbilitySystems } from './abilities';
import { createAppContext, localStorageIo, memoryIo, registry, withKind } from './core';
import { registerFeatures } from './features';
import { appModel, graphStore } from './model';
import { installRuntimeFeatureManager } from './runtime';
import { registerSystems } from './systems';

const plugins = registry();

registerSystems(withKind(plugins, 'system'));
registerAbilitySystems(withKind(plugins, 'ability'));
registerFeatures(withKind(plugins, 'feature'));

window.addEventListener('DOMContentLoaded', () => {
  // Pick io adapter. localStorage in production; memory mode in tests or kiosk boot.
  // Use ?io=memory in URL to opt out of persistence at boot.
  const useMemoryIo = new URLSearchParams(location.search).get('io') === 'memory';
  const io = useMemoryIo ? memoryIo() : localStorageIo();
  const ctx = createAppContext(graphStore(), appModel, {}, io);
  installRuntimeFeatureManager(ctx, plugins);
  plugins.start(ctx);
  ctx.bus.emit('app.start');
  window.app = ctx;
});

export {};
