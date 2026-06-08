import type { AppCtx, Registry } from './core';

export type RuntimeRegistries = {
  systems: Registry;
  abilities: Registry;
  features: Registry;
};

export type RuntimeFeatureManager = {
  registries: RuntimeRegistries;
  setFlag(name: string, on: boolean): void;
  refresh(): void;
};

declare module './types' {
  interface CustomExposable {
    registries?: RuntimeRegistries;
    runtime?: RuntimeFeatureManager;
  }
}

export function installRuntimeFeatureManager(ctx: AppCtx, registries: RuntimeRegistries) {
  const registryList = [registries.systems, registries.abilities, registries.features];
  const ownerOf = (name: string) => registryList.find(registry => registry.names().includes(name));
  const redraw = () => {
    ctx.bus.emit('render.stage.draw');
    ctx.bus.emit('outline.draw');
  };
  const manager: RuntimeFeatureManager = {
    registries,
    setFlag(name, on) {
      const owner = ownerOf(name);
      ctx.flags.set(name, on);
      if (owner) {
        if (on) owner.start(ctx);
        else owner.stop(ctx, name);
      }
      redraw();
    },
    refresh() {
      registryList.forEach(registry => registry.start(ctx));
      redraw();
    },
  };
  ctx.registries = registries;
  ctx.runtime = manager;
  return ctx.bus.on('flag.toggle', ({ name, on }) => {
    if (name) manager.setFlag(name, on);
  });
}
