import { registerAbilitySystems } from './abilities';
import { createAppContext, createFlags, localStorageIo, memoryIo, registry, withKind } from './core';
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

  // Flags default to ON via registry.declare. Persisted overrides (via io adapter)
  // win. To force a flag off at boot, pass it here or call window.v2.flags.set(...).
  const flags = createFlags({}, io);
  const ctx = createAppContext(graphStore(), appModel, flags, io);
  installRuntimeFeatureManager(ctx, plugins);
  plugins.start(ctx);
  ctx.bus.emit('app.start');
  window.v2 = ctx;
});

export {};
