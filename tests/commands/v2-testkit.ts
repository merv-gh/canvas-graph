import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAbilitySystems } from '../../v2/abilities';
import {
  createAppContext,
  createFlags,
  memoryIo,
  registry,
  type AppCtx,
} from '../../v2/core';
import { registerFeatures } from '../../v2/features';
import { appModel, graphStore } from '../../v2/model';
import { registerSystems } from '../../v2/systems';
import { Places, type CommandSource, type FeatureFlags } from '../../v2/types';

const html = readFileSync(resolve(process.cwd(), 'v2/index.html'), 'utf8')
  .replace(/<script\b[^>]*><\/script>/g, '');

export const defaultFlags: FeatureFlags = {
  render: true, input: true, main: true, log: true, outline: true,
  modal: true, commandForm: true, commandModal: true, domain: true, graph: true,
  'view.zoom': true, 'view.pan': true, focus: true, layout: true, dx: true, demo: true,
  'ability.selectable': true,
  'ability.draggable': true,
  'ability.nudgeable': true,
  'ability.collapsible': true,
  'ability.editable': true,
  'ability.configurable': true,
  nodeLifecycle: true,
  edgeLifecycle: true,
};

export function bootV2(flags: FeatureFlags = {}) {
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
  }
  document.documentElement.innerHTML = html;
  localStorage.clear();
  const systems = registry();
  const features = registry();
  registerSystems(systems);
  registerAbilitySystems(systems);
  registerFeatures(features);
  const io = memoryIo();
  const ctx = createAppContext(graphStore(), appModel, createFlags({ ...defaultFlags, ...flags }, io), io);
  systems.start(ctx);
  features.start(ctx);
  ctx.bus.emit('app.start');
  window.v2 = ctx;
  const stage = ctx.contexts.places.el(Places.Stage);
  if (stage) {
    stage.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
      toJSON: () => ({}),
    } as DOMRect);
  }
  return ctx;
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
