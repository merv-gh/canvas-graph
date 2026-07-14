import type { Registry } from '../core';
import { registerCancellation } from './cancellation';
import { registerChoose } from './choose';
import { registerCollections } from './collections';
import { registerCommandModal } from './command-modal';
import { registerCommandForm } from './command-form';
import { registerCommandPicker } from './command-picker';
import { registerContainers } from './containers';
import { registerContextActions } from './context-actions';
import { registerDarkTheme } from './dark-theme';
import { registerDebug } from './debug';
import { registerDetail } from './detail';
import { registerDemo } from './demo';
import { registerDx } from './dx';
import { registerFoldable } from './foldable';
import { registerFocus } from './focus';
import { registerGraph } from './graph';
import { registerInput } from './input';
import { registerIo } from './io';
import { registerJump } from './jump';
import { registerLayout } from './layout';
import { registerMain } from './main';
import { registerMarquee } from './marquee';
import { registerModal } from './modal';
import { registerItemToolbar } from './item-toolbar';
import { registerNodeAutosize } from './node-autosize';
import { registerNodeVisuals } from './node-visuals';
import { registerOnboarding } from './onboarding';
import { registerPerfPanel } from './perf-panel';
import { registerPresent } from './present';
import { registerRender } from './render';
import { registerRenderStage } from './render-stage';
import { registerRenderStageGpu } from './render-stage-gpu';
import { registerScenario } from './scenario';
import { registerShare } from './share';
import { registerTextLayout } from './text-layout';
import { registerToolPanel } from './tool-panel';
import { registerVarflow } from './varflow';
import { registerViewPan } from './view-pan';
import { registerViewZoom } from './view-zoom';

export function registerSystems(system: Registry) {
  registerRender(system);
  registerDarkTheme(system);
  registerRenderStage(system);
  registerRenderStageGpu(system);
  registerTextLayout(system);
  registerInput(system);
  registerIo(system);
  registerFoldable(system);
  registerCancellation(system);
  registerMain(system);
  registerToolPanel(system);
  // Log + outline unregistered for release — dev/left-pane chrome that pulled
  // focus off the canvas. Files kept for type augmentations + revival.
  registerModal(system);
  registerCommandForm(system);
  registerCommandPicker(system);
  registerCommandModal(system);
  registerPerfPanel(system);
  // Jump must register before `collections` so its `g` binding sits earlier in
  // the input router's enabled() iteration — combined with `stop: true` it then
  // shadows `graph.switch.next` instead of doubling up.
  registerJump(system);
  registerCollections(system);
  registerGraph(system);
  registerViewZoom(system);
  registerViewPan(system);
  registerMarquee(system);
  registerFocus(system);
  registerLayout(system);
  registerContextActions(system);
  registerItemToolbar(system);
  registerNodeVisuals(system);
  registerNodeAutosize(system);
  registerContainers(system);
  registerChoose(system);
  registerPresent(system);
  registerDetail(system);
  registerDemo(system);
  registerOnboarding(system);
  registerDebug(system);
  registerScenario(system);
  registerShare(system);
  registerVarflow(system);
  registerDx(system);
}
