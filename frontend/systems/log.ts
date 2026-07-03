import type { Registry } from '../core';
import { Places } from '../types';

/** Event log. Subscribes via bus.onAny, prepends each non-render.* event to a
 *  capped ring, and emits the render.view.set on the shared frame loop — even
 *  under a 100-event burst, the log paints at most once per frame (principle 8). */
export function registerLog(system: Registry) {
  system('log', ({ bus, emit, contexts, frameLoop }) => {
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
    const scheduleDraw = () => {
      frameLoop.schedule('log.draw', () => {
        emit('render.view.set', { place: Places.Left, key: 'log', view: renderLog });
      }, 30);
    };
    bus.onAny(event => {
      if (event.name.startsWith('render.')) return;
      rows.unshift(event.name === 'app.notice' ? `${event.name}: ${event.data.message}` : event.name);
      rows.length = Math.min(rows.length, 12);
      scheduleDraw();
    });
  }, { requires: ['render'] });
}
