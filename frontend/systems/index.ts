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
import { registerGhostNode } from './ghost-node';
import { registerGraph } from './graph';
import { registerHistory } from './history';
import { registerInk } from './ink';
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
import { registerOutline } from './outline';
import { registerPerfPanel } from './perf-panel';
import { registerPresets } from './presets';
import { registerPalette } from './palette';
import { registerRender } from './render';
import { registerRenderStage } from './render-stage';
import { registerRenderStageGpu } from './render-stage-gpu';
import { registerRequirementsView } from './requirements-view';
import { registerScenario } from './scenario';
import { registerShare } from './share';
import { registerTelemetry } from './telemetry';
import { registerTelemetryPortal } from './telemetry-portal';
import { registerTextLayout } from './text-layout';
import { registerToolPanel } from './tool-panel';
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
  // Telemetry starts early so it records the rest of boot; the portal that
  // draws it is a separate system you can toggle off without losing the data.
  registerTelemetry(system);
  registerTelemetryPortal(system);
  // The event log remains developer-only. The release navigator is the
  // polished document tree in outline.ts.
  registerOutline(system);
  registerModal(system);
  registerCommandForm(system);
  registerCommandPicker(system);
  registerCommandModal(system);
  registerPerfPanel(system);
  // Gesture precedence is data now: `jump`'s `g` shadows `graph.switch.next`
  // through `input.priority`, not through this line's position.
  registerJump(system);
  registerCollections(system);
  registerGraph(system);
  registerViewZoom(system);
  registerViewPan(system);
  // Ink's draw/erase pointerdown outranks marquee and selection by priority;
  // marquee also yields through the generic pointer-mode claim.
  registerInk(system);
  registerMarquee(system);
  registerFocus(system);
  registerLayout(system);
  registerPresets(system);
  // Palette registers after presets so its explicit arm is the final default
  // patch while imported/demo nodes marked styleExplicit remain untouched.
  registerPalette(system);
  registerContextActions(system);
  registerItemToolbar(system);
  registerGhostNode(system);
  registerNodeVisuals(system);
  registerNodeAutosize(system);
  registerContainers(system);
  registerRequirementsView(system);
  registerHistory(system);
  registerChoose(system);
  registerDetail(system);
  registerDemo(system);
  registerOnboarding(system);
  registerDebug(system);
  registerScenario(system);
  registerShare(system);
  // Presentation and varflow remain in-tree (and documented) but are not
  // registered in the release composition until their UX is ready.
  registerDx(system);
}
