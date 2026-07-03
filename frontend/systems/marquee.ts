import { clientPoint, isStageSurface, nodeRect, nodeRef, rectsIntersect, type Registry } from '../core';
import { Places } from '../types';
import type { ItemRef, Position } from '../types';
import { isMoveIntent } from './view-pan';

declare module '../types' {
  interface CustomEvents {
    'select.box.start': { point: Position; add: boolean };
    'select.box.move': Position;
    'select.box.end': void;
    'select.box.cancel': void;
  }
}

/** Rubber-band rectangle selection — a bare single-pointer drag on empty canvas
 *  paints a band and chooses every node it crosses on release. Pan is reserved
 *  for move-intent gestures (two-finger / middle / space — see `view-pan.ts`), so
 *  the plain drag is free to mean "select a region". Shift adds to the set. */
export function registerMarquee(system: Registry) {
  system('marquee', ({ on, emit, contexts, graphs, selection }) => {
    const stageSelector = `[data-place="${Places.Stage}"]`;
    let start: Position | null = null;   // client coords
    let add = false;
    let band: HTMLDivElement | null = null;
    let moved = false;

    const stageEl = () => contexts.places.el(Places.Stage);
    const clear = () => {
      band?.remove();
      band = null;
      start = null;
      moved = false;
      stageEl()?.classList.remove('marquee-active');
    };
    const drawBand = (current: Position) => {
      const stage = stageEl();
      if (!stage || !start) return;
      const a = contexts.view.clientToScreen(Places.Stage, start);
      const b = contexts.view.clientToScreen(Places.Stage, current);
      if (!band) {
        band = document.createElement('div');
        band.className = 'select-marquee';
        stage.append(band);
        stage.classList.add('marquee-active');
      }
      band.style.left = `${Math.min(a.x, b.x)}px`;
      band.style.top = `${Math.min(a.y, b.y)}px`;
      band.style.width = `${Math.abs(a.x - b.x)}px`;
      band.style.height = `${Math.abs(a.y - b.y)}px`;
    };

    contexts.commands.register([
      {
        id: 'select.box.start',
        label: 'Start box selection',
        event: 'select.box.start',
        group: 'selection',
        hidden: true,
        input: {
          on: 'pointerdown', selector: stageSelector,
          // Bare primary pointer on empty stage — everything move-intent is pan's.
          when: (event, stage) => {
            const e = event as PointerEvent;
            return isStageSurface(event, stage) && e.isPrimary && e.button === 0 && !isMoveIntent(e);
          },
          prevent: true, stop: true,
        },
        payload: ({ event }) => ({ point: clientPoint(event!), add: (event as PointerEvent).shiftKey }),
      },
      {
        id: 'select.box.move', label: 'Extend box selection', event: 'select.box.move',
        group: 'selection', hidden: true,
        input: { on: 'pointermove', when: () => !!start, prevent: true },
        payload: ({ event }) => clientPoint(event!),
      },
      {
        id: 'select.box.end', label: 'Commit box selection', event: 'select.box.end',
        group: 'selection', hidden: true,
        input: { on: 'pointerup', when: () => !!start },
      },
    ]);

    on('select.box.start', ({ point, add: addToSet }) => { start = point; add = addToSet; moved = false; });
    on('select.box.move', current => {
      if (!start) return;
      moved = moved || Math.abs(current.x - start.x) + Math.abs(current.y - start.y) > 4;
      if (moved) drawBand(current);
    });
    on('select.box.end', () => {
      const startPoint = start;
      const wasDrag = moved && !!band;
      const rect = band?.getBoundingClientRect();
      clear();
      if (!startPoint) return;
      if (!wasDrag) {
        // A click, not a drag: clear selection (unless additive) — matches the
        // background-cancel affordance without needing a separate handler.
        if (!add && selection.selected()) emit('selection.item.clear');
        return;
      }
      // Convert the band's two client corners to graph space, then choose every
      // node whose rect crosses the region.
      const p1 = contexts.view.clientToSpace(Places.Stage, { x: rect!.left, y: rect!.top });
      const p2 = contexts.view.clientToSpace(Places.Stage, { x: rect!.right, y: rect!.bottom });
      const region = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p1.x - p2.x), h: Math.abs(p1.y - p2.y) };
      const refs: ItemRef[] = graphs.current.nodes()
        .filter(n => n.Position && rectsIntersect(region, nodeRect(n)))
        .map(n => nodeRef(n.id));
      if (refs.length) emit('selection.choose', { refs, mode: add ? 'add' : 'replace' });
      else if (!add) emit('selection.item.clear');
    });
    on('select.box.cancel', clear);

    return clear;
  }, { requires: ['render', 'graph'] });
}
