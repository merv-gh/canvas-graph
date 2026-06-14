import { DATA_VIEW, writeProjection } from '../shared.mjs';
import { eventFlowData, FACT_RE, formatLoc } from './flows.mjs';

export const DATA_ENTITIES = ['node', 'edge', 'container', 'item', 'graph'];

export function entityOf(event) {
  const segs = event.split('.');
  return DATA_ENTITIES.find(e => segs.includes(e)) ?? null;
}

export function renderData() {
  const data = eventFlowData();
  const lines = [
    '# @dx-projection data frontend',
    '',
    'Per-entity data lifecycle: command → mutation request → handler (owner) → fact (⟳ render).',
    'The fact is where the data changed and the UI re-reads it. Read-only.',
    'Trace one entity: `project show data node`.',
    '',
  ];
  for (const entity of DATA_ENTITIES) {
    const events = data.events.filter(event => entityOf(event) === entity);
    if (!events.length) continue;
    const requests = events.filter(event => !FACT_RE.test(event));
    const facts = events.filter(event => FACT_RE.test(event));
    const commands = [...new Set(events.flatMap(event =>
      (data.commandsByEvent.get(event) ?? []).map(command => `${command.id} (${formatLoc(command)})`)))];
    lines.push(`## ${entity}`);
    if (commands.length) lines.push(`commands: ${commands.join(', ')}`);
    lines.push('writes (request → owner handler → fact emitted):');
    let wrote = false;
    for (const request of requests) {
      for (const handler of data.handlersByEvent.get(request) ?? []) {
        const emitted = handler.emits.length ? handler.emits.join(', ') : '(emits no fact)';
        lines.push(`  ${request} → ${formatLoc(handler)} → ${emitted}`);
        wrote = true;
      }
    }
    if (!wrote) lines.push('  (no static request handlers found — may mutate via item.update or a store)');
    if (facts.length) lines.push(`facts (data changed → ⟳ render reads here): ${facts.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function generateData({ quiet = false } = {}) {
  const def = {
    name: 'data',
    outFile: DATA_VIEW,
    render: renderData,
    count: () => DATA_ENTITIES.length,
  };
  writeProjection(def, def.render(), quiet);
}
