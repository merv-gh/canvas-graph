import { clientPoint, itemRefFrom, type Registry } from '../core';
import { configurable, selectable } from '../abilities';
import { isNodeColor, type NodeColor } from '../model';
import { Places } from '../types';
import type { EntityDef, EntityRenderer, Id, ItemRef, Position, Rect, Size } from '../types';

declare module '../types' {
  interface CustomItemKinds { ink: unknown }
  interface CustomEvents {
    'ink.toggle': void;
    'ink.mode.changed': { drawing: boolean };
    'ink.erase.toggle': void;
    'ink.erase.mode.changed': { erasing: boolean };
    'ink.arm.color': { color: NodeColor };
    'ink.arm.width': { width: number };
    'ink.arm.opacity': { opacity: number };
    'ink.arm.changed': { color: NodeColor; width: number; opacity: number };
    'ink.stroke.start': { point: Position };
    'ink.stroke.move': { point: Position };
    'ink.stroke.end': void;
    'ink.stroke.created': { id: Id };
    'ink.stroke.updated': { id: Id; gesture?: boolean };
    'ink.stroke.completed': { id: Id };
    'ink.stroke.deleted': { id: Id };
    'ink.item.erase': ItemRef;
    'ink.select.all': void;
  }
}

/** Free-form marker stroke — the hand-drawn annotation layer (circles, arrows,
 *  underlines) over a diagram. Points are graph-space; Position/Size are the
 *  derived bounds kept for selection, culling, and Fit. */
export type InkStroke = {
  id: Id;
  kind: 'ink';
  Label: { text: string };
  Points: Position[];
  Color: NodeColor;
  Width: number;
  Opacity: number;
  Position: Position;
  Size: Size;
};
export type InkPatch = Partial<Pick<InkStroke, 'Points' | 'Color' | 'Width' | 'Opacity' | 'Label'>>;

const DEFAULT_WIDTH = 3;
const HIT_PAD = 10;

/** Midpoint-quadratic smoothing: each recorded point becomes the control point
 *  of a curve to the midpoint of its neighbor — the standard freehand-ink
 *  smoothing that turns a jittery polyline into one continuous stroke. */
export const smoothInkPath = (points: Position[]): string => {
  if (!points.length) return '';
  const rounded = points.map(point => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 }));
  const [first, ...rest] = rounded;
  if (rest.length === 0) return `M ${first.x} ${first.y} L ${first.x + 0.01} ${first.y}`;
  if (rest.length === 1) return `M ${first.x} ${first.y} L ${rest[0].x} ${rest[0].y}`;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < rounded.length - 1; i += 1) {
    const control = rounded[i];
    const mid = { x: (control.x + rounded[i + 1].x) / 2, y: (control.y + rounded[i + 1].y) / 2 };
    d += ` Q ${control.x} ${control.y} ${mid.x} ${mid.y}`;
  }
  const last = rounded[rounded.length - 1];
  return `${d} L ${last.x} ${last.y}`;
};

export const inkBounds = (points: Position[]): Rect => {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export type InkArm = { color: NodeColor; width: number; opacity: number };
const DEFAULT_ARM: InkArm = { color: 'pink', width: DEFAULT_WIDTH, opacity: 1 };

const applyBounds = (stroke: InkStroke) => {
  const bounds = inkBounds(stroke.Points);
  stroke.Position = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  stroke.Size = { w: bounds.w, h: bounds.h };
};

type InkSnapshot = { id: Id; Points: Position[]; Color: NodeColor; Width: number; Opacity?: number; Label?: { text: string } };

export function registerInk(system: Registry) {
  system('ink', ctx => {
    const { on, emit, contexts, graphs, selection, contribute, origin } = ctx;
    let drawing = false;
    let erasing = false;
    let drawArm = { ...DEFAULT_ARM };

    type GraphState = { strokes: Map<Id, InkStroke>; next: number; storeOff: () => void; snapshotOff: () => void };
    const states = new Map<Id, GraphState>();
    const ensureState = (gid: Id): GraphState => {
      const existing = states.get(gid);
      if (existing) return existing;
      const strokes = new Map<Id, InkStroke>();
      const graph = graphs.get(gid) ?? graphs.current;
      const storeOff = graph.registerItemStore<InkStroke>('ink', () => [...strokes.values()]);
      const state: GraphState = { strokes, next: 1, storeOff, snapshotOff: () => {} };
      const serialize = (): InkSnapshot[] => [...strokes.values()].map(stroke => ({
        id: stroke.id,
        Points: stroke.Points.map(point => ({ ...point })),
        Color: stroke.Color,
        Width: stroke.Width,
        Opacity: stroke.Opacity,
        Label: { ...stroke.Label },
      }));
      const restore = (value: InkSnapshot[] | undefined) => {
        strokes.clear();
        const saved = Array.isArray(value) ? value : [];
        saved.forEach(input => {
          if (!input?.id || !Array.isArray(input.Points) || input.Points.length === 0) return;
          const stroke: InkStroke = {
            id: input.id,
            kind: 'ink',
            Label: { text: input.Label?.text ?? 'Ink stroke' },
            Points: input.Points
              .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))
              .map(point => ({ x: point.x, y: point.y })),
            Color: isNodeColor(input.Color) ? input.Color : 'pink',
            Width: Number.isFinite(input.Width) && input.Width! > 0 ? input.Width : DEFAULT_WIDTH,
            Opacity: Number.isFinite(input.Opacity) ? Math.max(0.1, Math.min(1, input.Opacity!)) : 1,
            Position: { x: 0, y: 0 },
            Size: { w: 0, h: 0 },
          };
          if (!stroke.Points.length) return;
          applyBounds(stroke);
          strokes.set(stroke.id, stroke);
          const sequence = Number.parseInt(input.id.replace(/^\D+/, ''), 10);
          if (Number.isFinite(sequence)) state.next = Math.max(state.next, sequence + 1);
        });
      };
      restore(graph.snapshotExtension<InkSnapshot[]>('ink'));
      state.snapshotOff = graph.registerSnapshotExtension('ink', serialize, restore);
      states.set(gid, state);
      return state;
    };
    const strokesHere = () => ensureState(graphs.current.id).strokes;

    // ---------- Entity declaration ----------
    const render: EntityRenderer<InkStroke> = {
      layer: 'svg',
      bounds: stroke => ({
        x: stroke.Position.x - stroke.Size.w / 2,
        y: stroke.Position.y - stroke.Size.h / 2,
        w: stroke.Size.w,
        h: stroke.Size.h,
      }),
      draw(stroke, renderer) {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('class', 'ink');
        group.dataset.inkColor = stroke.Color;
        group.style.opacity = String(stroke.Opacity);
        const ref = renderer.refOf(stroke.id);
        const d = smoothInkPath(stroke.Points);
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'ink-hit');
        hit.setAttribute('d', d);
        hit.setAttribute('stroke-width', String(stroke.Width + HIT_PAD));
        renderer.tagItem(hit, ref);
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'ink-path');
        path.setAttribute('d', d);
        path.setAttribute('stroke-width', String(stroke.Width));
        renderer.tagItem(path, ref);
        renderer.applyItemModes(path, ref);
        group.append(hit, path);
        return group;
      },
      // Points only grow during the draw gesture and are immutable after, so
      // count + style is a complete visual signature.
      signature: stroke => `${stroke.Points.length}:${stroke.Color}:${stroke.Width}:${stroke.Opacity}`,
    };
    const inkEntity: EntityDef<InkStroke, InkPatch> = {
      kind: 'ink',
      label: 'Ink stroke',
      labelOf: stroke => stroke.Label.text,
      abilities: [selectable<InkStroke>(), configurable<InkStroke>()],
      render,
      properties: [
        {
          id: 'color', label: 'Color', input: 'select',
          options: [
            { value: 'pink', label: 'Pink' }, { value: 'red', label: 'Red' },
            { value: 'orange', label: 'Orange' }, { value: 'yellow', label: 'Yellow' },
            { value: 'green', label: 'Green' }, { value: 'blue', label: 'Blue' },
            { value: 'purple', label: 'Purple' }, { value: 'gray', label: 'Gray' },
          ],
          value: stroke => stroke.Color,
          patch: (_stroke, value) => isNodeColor(value) ? { Color: value } : undefined,
        },
        {
          id: 'width', label: 'Stroke width', input: 'number', min: 1, step: 1,
          value: stroke => stroke.Width,
          patch: (_stroke, value) => {
            const width = Number(value);
            return Number.isFinite(width) && width > 0 ? { Width: Math.min(24, width) } : undefined;
          },
        },
        {
          id: 'opacity', label: 'Opacity', input: 'number', min: 0.1, step: 0.1,
          value: stroke => stroke.Opacity,
          patch: (_stroke, value) => {
            const opacity = Number(value);
            return Number.isFinite(opacity) ? { Opacity: Math.max(0.1, Math.min(1, opacity)) } : undefined;
          },
        },
      ],
    };
    // No collection declaration: strokes are annotations over the diagram,
    // not document content — they don't belong in the outline/palette lists,
    // and the collection contract (create/delete commands) doesn't fit a
    // pointer gesture.
    const offEntity = ctx.model.registerEntity(inkEntity);

    // ---------- Storage: apply ink patches from item.update ----------
    contexts.storage.register('ink', origin, (ref, patch) => {
      const stroke = strokesHere().get(ref.id);
      if (!stroke) return;
      const p = patch as InkPatch;
      if (p.Label) stroke.Label = { text: p.Label.text };
      if (p.Color && isNodeColor(p.Color)) stroke.Color = p.Color;
      if (Number.isFinite(p.Width) && p.Width! > 0) stroke.Width = Math.min(24, p.Width!);
      if (Number.isFinite(p.Opacity)) stroke.Opacity = Math.max(0.1, Math.min(1, p.Opacity!));
      if (Array.isArray(p.Points) && p.Points.length) {
        stroke.Points = p.Points.map(point => ({ x: point.x, y: point.y }));
        applyBounds(stroke);
      }
      emit('ink.stroke.updated', {
        id: stroke.id,
        gesture: ref.id === activeId && Array.isArray(p.Points),
      });
    });

    // ---------- Draw mode + pointer gesture ----------
    let activeId: Id | null = null;
    const stageEl = () => contexts.places.el(Places.Stage);
    const setDrawing = (next: boolean) => {
      if (drawing === next) return;
      if (next && erasing) setErasing(false);
      drawing = next;
      if (!next) activeId = null;
      stageEl()?.classList.toggle('ink-drawing', next);
      emit('ink.mode.changed', { drawing: next });
      emit('tool.panel.redraw', { id: 'top' });
    };
    const setErasing = (next: boolean) => {
      if (erasing === next) return;
      if (next && drawing) setDrawing(false);
      erasing = next;
      stageEl()?.classList.toggle('ink-erasing', next);
      emit('ink.erase.mode.changed', { erasing: next });
      emit('tool.panel.redraw', { id: 'top' });
    };
    const deleteStroke = (id: Id) => {
      if (!strokesHere().delete(id)) return;
      selection.remove({ kind: 'ink', id });
      emit('ink.stroke.deleted', { id });
    };

    contexts.commands.register([
      { id: 'ink.toggle', label: 'Draw ink annotations', group: 'edit' },
      { id: 'ink.erase.toggle', label: 'Erase ink annotations', group: 'edit' },
      {
        id: 'ink.item.erase',
        label: 'Erase canvas item',
        group: 'edit',
        hidden: true,
        input: {
          on: 'pointerdown', selector: '[data-item-kind][data-item-id]', prevent: true, stop: true,
          when: event => erasing && (event as PointerEvent).isPrimary && (event as PointerEvent).button === 0
            && !(event.target as Element).closest('.tool-panel, .item-toolbar, .modal-layer'),
        },
        payload: ({ target }) => itemRefFrom(target),
      },
      {
        id: 'ink.select.all',
        label: 'Select all drawings',
        group: 'selection',
        available: () => strokesHere().size > 0,
      },
      ...(['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as NodeColor[]).map(color => ({
        id: `ink.arm.color.${color}`,
        label: `Arm draw color: ${color}`,
        event: 'ink.arm.color' as const,
        group: 'edit',
        payload: () => ({ color }),
      })),
      ...[1.5, 3, 6].map(width => ({
        id: `ink.arm.width.${String(width).replace('.', '-')}`,
        label: `Arm draw width: ${width}`,
        event: 'ink.arm.width' as const,
        group: 'edit',
        payload: () => ({ width }),
      })),
      ...[0.25, 0.5, 0.75, 1].map(opacity => ({
        id: `ink.arm.opacity.${Math.round(opacity * 100)}`,
        label: `Arm draw opacity: ${Math.round(opacity * 100)}%`,
        event: 'ink.arm.opacity' as const,
        group: 'edit',
        payload: () => ({ opacity }),
      })),
      {
        id: 'ink.stroke.start',
        label: 'Start ink stroke',
        event: 'ink.stroke.start',
        group: 'edit',
        hidden: true,
        input: {
          on: 'pointerdown',
          selector: `[data-place="${Places.Stage}"]`,
          // Drawing owns bare canvas only. Items retain selection and context
          // actions, so draw mode never makes existing work unreachable.
          when: event => drawing && (event as PointerEvent).isPrimary && (event as PointerEvent).button === 0
            && !(event.target as Element).closest('[data-item-id], .tool-panel, .item-toolbar, .modal-layer, .empty-action'),
          prevent: true,
          stop: true,
        },
        payload: ({ event }) => ({ point: contexts.view.clientToSpace(Places.Stage, clientPoint(event!)) }),
      },
      {
        id: 'ink.stroke.move',
        label: 'Extend ink stroke',
        event: 'ink.stroke.move',
        group: 'edit',
        hidden: true,
        input: { on: 'pointermove', when: () => drawing && !!activeId, prevent: true },
        payload: ({ event }) => ({ point: contexts.view.clientToSpace(Places.Stage, clientPoint(event!)) }),
      },
      {
        id: 'ink.stroke.end',
        label: 'Finish ink stroke',
        event: 'ink.stroke.end',
        group: 'edit',
        hidden: true,
        input: { on: 'pointerup', when: () => drawing && !!activeId },
      },
    ]);

    on('ink.toggle', () => setDrawing(!drawing));
    on('ink.erase.toggle', () => setErasing(!erasing));
    on('ink.item.erase', ref => {
      if (!erasing) return;
      if (ref.kind === 'ink') deleteStroke(ref.id);
      if (ref.kind === 'node') emit('graph.node.delete', { id: ref.id });
      if (ref.kind === 'edge') emit('graph.edge.delete', { id: ref.id });
      if (ref.kind === 'container') emit('graph.container.delete', { id: ref.id });
    });
    on('ink.select.all', () => {
      emit('selection.choose', {
        refs: [...strokesHere().keys()].map(id => ({ kind: 'ink' as const, id })),
        mode: 'replace',
      });
    });
    const armChanged = () => emit('ink.arm.changed', { ...drawArm });
    on('ink.arm.color', ({ color }) => { if (isNodeColor(color)) { drawArm = { ...drawArm, color }; armChanged(); } });
    on('ink.arm.width', ({ width }) => {
      if (Number.isFinite(width) && width > 0) { drawArm = { ...drawArm, width: Math.min(24, width) }; armChanged(); }
    });
    on('ink.arm.opacity', ({ opacity }) => {
      if (Number.isFinite(opacity)) { drawArm = { ...drawArm, opacity: Math.max(0.1, Math.min(1, opacity)) }; armChanged(); }
    });

    on('ink.stroke.start', ({ point }) => {
      if (!drawing) return;
      const state = ensureState(graphs.current.id);
      const id = `k${state.next++}`;
      const stroke: InkStroke = {
        id,
        kind: 'ink',
        Label: { text: `Ink stroke ${id.slice(1)}` },
        Points: [{ ...point }],
        Color: drawArm.color,
        Width: drawArm.width,
        Opacity: drawArm.opacity,
        Position: { ...point },
        Size: { w: 0, h: 0 },
      };
      state.strokes.set(id, stroke);
      activeId = id;
      emit('ink.stroke.created', { id });
    });

    on('ink.stroke.move', ({ point }) => {
      if (!activeId) return;
      const stroke = strokesHere().get(activeId);
      if (!stroke) { activeId = null; return; }
      const last = stroke.Points[stroke.Points.length - 1];
      // Skip sub-pixel jitter; keeps point counts (and replay traces) small.
      if (Math.abs(point.x - last.x) + Math.abs(point.y - last.y) < 1.5) return;
      emit('item.update', { ref: { kind: 'ink', id: activeId }, patch: { Points: [...stroke.Points, { ...point }] } });
    });

    on('ink.stroke.end', () => {
      if (!activeId) return;
      const stroke = strokesHere().get(activeId);
      // A click without movement isn't an annotation — drop the dot.
      if (stroke && stroke.Points.length < 2) {
        strokesHere().delete(stroke.id);
        emit('ink.stroke.deleted', { id: stroke.id });
      } else if (stroke) emit('ink.stroke.completed', { id: stroke.id });
      activeId = null;
    });

    // Selection delete fans out per kind (selectable owns node/edge, containers
    // owns container) — ink owns its own strokes.
    on('selection.item.delete', () => {
      selection.selectedAll().forEach(ref => {
        if (ref.kind !== 'ink') return;
        deleteStroke(ref.id);
      });
    });

    on('graph.switched', () => { activeId = null; ensureState(graphs.current.id); });
    on('app.start', () => { ensureState(graphs.current.id); });

    contexts.cancellation.register({
      origin,
      priority: 30,
      background: false,
      blocksPointer: true,
      active: () => drawing || erasing,
      cancel: () => drawing ? setDrawing(false) : setErasing(false),
    });

    contribute({
      origin,
      surface: 'top',
      command: 'ink.toggle',
      kind: 'button',
      icon: 'draw',
      label: 'Draw mode',
      className: 'canvas-mode-tool ink-mode-switch',
      active: () => drawing,
      slot: 'start',
      group: 'mode',
      order: 4,
    });
    contribute({
      origin,
      surface: 'top',
      command: 'ink.erase.toggle',
      kind: 'button',
      icon: 'erase',
      label: 'Erase canvas items',
      className: 'canvas-mode-tool ink-erase-switch',
      active: () => erasing,
      slot: 'start',
      group: 'mode',
      order: 6,
    });

    return () => {
      setDrawing(false);
      setErasing(false);
      states.forEach(state => { state.storeOff(); state.snapshotOff(); });
      states.clear();
      offEntity();
    };
  }, { requires: ['render', 'graph'] });
}
