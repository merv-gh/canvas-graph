import { join } from 'node:path';
import { SOURCE_ROOT, COMMANDS_VIEW, EVENTS_VIEW, FLOWS_VIEW, COMMAND_UI_VIEW, DATA_VIEW, RENDER_VIEW } from './shared.mjs';
import { collectCommands, commandSourceFiles, generateCommands, renderCommands } from './file-to-projection/commands.mjs';
import { syncCommands } from './projections-to-file/commands.mjs';
import { collectEventDecls, eventSourceFiles, generateEvents, renderEvents } from './file-to-projection/events.mjs';
import { syncEvents } from './projections-to-file/events.mjs';
import { collectEventUsages, generateFlows, renderFlows } from './file-to-projection/flows.mjs';
import { DATA_ENTITIES, generateData, renderData } from './file-to-projection/data.mjs';
import { collectShellFolds, generateRender, renderRender } from './file-to-projection/render.mjs';
import { syncRender } from './projections-to-file/render.mjs';
import { collectCommandUi, commandUiSourceFiles, generateCommandUi, renderCommandUi } from './file-to-projection/command-ui.mjs';
import { syncCommandUi } from './projections-to-file/command-ui.mjs';
import { listSourceFiles } from './shared.mjs';

export const projections = new Map([
  ['commands', {
    name: 'commands',
    outFile: COMMANDS_VIEW,
    description: 'all contexts.commands.register(...) command literals from frontend/',
    render: () => renderCommands(collectCommands()),
    generate: generateCommands,
    sync: syncCommands,
    watchFiles: commandSourceFiles,
    count: () => collectCommands().length,
  }],
  ['events', {
    name: 'events',
    outFile: EVENTS_VIEW,
    description: 'typed CustomEvents/BuiltinEvents declaration lines from frontend/',
    render: () => renderEvents(collectEventDecls()),
    generate: generateEvents,
    sync: syncEvents,
    watchFiles: eventSourceFiles,
    count: () => collectEventDecls().length,
  }],
  ['flows', {
    name: 'flows',
    outFile: FLOWS_VIEW,
    description: 'generated command/event/on/emit flow map from frontend/',
    render: renderFlows,
    generate: generateFlows,
    sync: () => console.log('flows is read-only; edit event declarations or source handlers instead'),
    watchFiles: () => listSourceFiles(),
    count: () => collectEventUsages().length,
  }],
  ['command-ui', {
    name: 'command-ui',
    outFile: COMMAND_UI_VIEW,
    description: 'all contribute({ surface, command, ... }) command UI affordances from frontend/',
    render: () => renderCommandUi(collectCommandUi()),
    generate: generateCommandUi,
    sync: syncCommandUi,
    watchFiles: commandUiSourceFiles,
    count: () => collectCommandUi().length,
  }],
  ['data', {
    name: 'data',
    outFile: DATA_VIEW,
    description: 'per-entity data lifecycle: commands → mutation requests → handler → fact (⟳ render)',
    render: renderData,
    generate: generateData,
    sync: () => console.log('data is read-only; it is derived from events + handlers in source'),
    watchFiles: () => listSourceFiles(),
    count: () => DATA_ENTITIES.length,
  }],
  ['render', {
    name: 'render',
    outFile: RENDER_VIEW,
    description: 'editable shell fold render wiring: dataset mirrors + snapshot fields + CSS rules',
    render: () => renderRender(collectShellFolds()),
    generate: generateRender,
    sync: syncRender,
    watchFiles: () => [join(SOURCE_ROOT, 'systems/main.ts'), join(SOURCE_ROOT, 'core/snapshot.ts'), join(SOURCE_ROOT, 'styles.css')],
    count: () => collectShellFolds().length,
  }],
]);

export function selectProjection(name) {
  const def = projections.get(name);
  if (!def) throw new Error(`unknown projection '${name}'. Known: ${[...projections.keys()].join(', ')}`);
  return def;
}
