import type { Registry } from '../core';
import { Places } from '../types';

export function registerLog(system: Registry) {
  system('log', ({ bus, emit, contexts }) => {
    const rows: string[] = [];
    const renderLog = () => {
      const panel = contexts.templates.clone('log');
      const list = contexts.templates.slot(panel, 'rows');
      rows.forEach(row => {
        const item = contexts.templates.clone('log-row');
        contexts.templates.text(item, 'name', row);
        list.append(item);
      });
      return panel;
    };
    bus.onAny(event => {
      if (event.name.startsWith('render.')) return;
      rows.unshift(event.name);
      rows.length = Math.min(rows.length, 12);
      emit('render.view.set', { place: Places.Left, key: 'log', view: renderLog });
    });
  });
}
