import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAbilitySystems } from '../../frontend/abilities';
import {
  createAppContext,
  createFlags,
  memoryIo,
  registry,
  withKind,
  type AppCtx,
} from '../../frontend/core';
import { registerFeatures } from '../../frontend/features';
import { appModel, graphStore } from '../../frontend/model';
import { installRuntimeFeatureManager } from '../../frontend/runtime';
import { registerSystems } from '../../frontend/systems';
import { Places, type CommandSource, type FeatureFlags } from '../../frontend/types';

const html = readFileSync(resolve(process.cwd(), 'frontend/index.html'), 'utf8')
  .replace(/<script\b[^>]*><\/script>/g, '');

/** Flag overrides only. Registry declares each system/ability/feature ON at boot,
 *  so an empty object boots everything. Pass `{ render: false }` to disable. */
export function bootApp(flags: FeatureFlags = {}) {
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
  }
  document.documentElement.innerHTML = html;
  localStorage.clear();
  const plugins = registry();
  registerSystems(withKind(plugins, 'system'));
  registerAbilitySystems(withKind(plugins, 'ability'));
  registerFeatures(withKind(plugins, 'feature'));
  const io = memoryIo();
  const ctx = createAppContext(graphStore(), appModel, createFlags(flags, io), io);
  installRuntimeFeatureManager(ctx, plugins);
  plugins.start(ctx);
  ctx.bus.emit('app.start');
  const booted = ctx;
  window.app = booted;
  const stage = ctx.contexts.places.el(Places.Stage);
  if (stage) {
    stage.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
      toJSON: () => ({}),
    } as DOMRect);
  }
  return booted;
}

export const settle = async () => {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await Promise.resolve();
};

export const runCommand = (ctx: AppCtx, id: string, source: CommandSource = {}) =>
  ctx.contexts.commands.run(id, source);

export const commandButton = (id: string) =>
  document.querySelector(`[data-command="${id}"]`) as HTMLElement | null;

export const field = (name: string) =>
  document.querySelector(`[data-form-field="${name}"]`) as HTMLInputElement | null;

export const modalText = () => document.querySelector('.modal-slot')?.textContent ?? '';
