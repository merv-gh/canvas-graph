import type { AppCtx, Registry } from './core';

export type RuntimeFeatureManager = {
  registry: Registry;
  setFlag(name: string, on: boolean): void;
  refresh(): void;
};

declare module './types' {
  interface CustomExposable {
    registry?: Registry;
    runtime?: RuntimeFeatureManager;
  }
}

/** Hot-toggle the flag-driven lifecycle of any registered entry. One flat
 *  registry now holds system / ability / feature entries — distinguished by
 *  `kind`, not by which list they live in — so flag toggles call
 *  `registry.stop` / `registry.start` directly. */
export function installRuntimeFeatureManager(ctx: AppCtx, registry: Registry) {
  const redraw = () => {
    ctx.bus.emit('render.stage.draw');
    ctx.bus.emit('outline.draw');
  };
  const manager: RuntimeFeatureManager = {
    registry,
    setFlag(name, on) {
      ctx.flags.set(name, on);
      if (registry.names().includes(name)) {
        if (on) registry.start(ctx);
        else registry.stop(ctx, name);
      }
      redraw();
    },
    refresh() {
      registry.start(ctx);
      redraw();
    },
  };
  ctx.registry = registry;
  ctx.runtime = manager;
  return ctx.bus.on('flag.toggle', ({ name, on }) => {
    if (name) manager.setFlag(name, on);
  });
}
