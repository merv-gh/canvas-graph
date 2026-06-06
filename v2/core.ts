import type { GraphStore } from './model';
import type {
  ActionDef,
  AffordanceDef,
  AnyEvent,
  Bus,
  CollectionDef,
  CommandSource,
  CommandSpec,
  EntityDef,
  EventName,
  Id,
  ItemRef,
  ModelDef,
  NodeEntity,
  Place,
  Position,
  RawInput,
  Rect,
  Renderable,
  UiValue,
  ViewState,
} from './types';

export type Contexts = ReturnType<typeof createContexts>;
export type Models = ReturnType<typeof createModelRegistry>;
export type ModelCtx = { graphs: GraphStore };
export type AppCtx = { bus: Bus; graphs: GraphStore; contexts: Contexts; model: Models };
export type AppCollectionDef<T> = CollectionDef<T, ModelCtx>;
export type SystemCtx = AppCtx & Pick<Bus, 'on' | 'emit'>;
export type AppSystem = (ctx: SystemCtx) => void;
export type Registry = ((name: string, setup: AppSystem) => void) & {
  start(ctx: AppCtx, then?: () => void): void;
  names(): string[];
};

declare global { interface Window { v2?: AppCtx } }

export const systemOf = (id: string) => id.split('.')[0] || 'app';
export const shortcutOf = (command: CommandSpec) => command.shortcut ?? (command.input?.key ? command.input.key.toUpperCase() : '');
const keyOfShortcut = (shortcut: string) => shortcut.trim().toLowerCase() === 'esc' ? 'Escape' : shortcut.trim();
const shortcutKey = (shortcut: string) => keyOfShortcut(shortcut).toLowerCase();
const keyMatches = (event: Event, key: string) => event instanceof KeyboardEvent
  && (
    event.key.toLowerCase() === key.toLowerCase()
    || (key === '?' && event.key === '/' && event.shiftKey)
    || (key === '+' && event.key === '=' && event.shiftKey)
  );
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const nodeRect = (node: NodeEntity): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};
export const clientPoint = (event: Event): Position => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY });
export const isStageSurface = (event: Event, stage: Element) =>
  event.target === stage || (event.target instanceof Element && event.target.classList.contains('nodes'));
export const appendRenderable = (slot: Element, view: Renderable) => {
  const value = typeof view === 'function' ? view() : view;
  if (typeof value === 'string') slot.insertAdjacentHTML('beforeend', value);
  else slot.append(value);
};
export const grouped = <T,>(items: T[], keyOf: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  items.forEach(item => (groups.get(keyOf(item)) || groups.set(keyOf(item), []).get(keyOf(item))!).push(item));
  return [...groups.entries()];
};
export const uiValue = <T,>(value: UiValue<T> | undefined, item: T, fallback = '') =>
  typeof value === 'function' ? value(item) : value ?? fallback;
export const entityUi = <T,>(entityDef: EntityDef<T>, slot?: string) =>
  entityDef.abilities.flatMap(abilityDef => abilityDef.actions.flatMap(actionDef =>
    actionDef.ui
      .filter(ui => ui.surface === 'entity' && (slot == null || ui.slot === slot))
      .map(ui => ({ action: actionDef as ActionDef<T>, ui: ui as AffordanceDef<T> })),
  ));
export const itemIdFrom = (target?: Element | null) =>
  target?.closest('[data-item-id]')?.getAttribute('data-item-id')
  ?? target?.closest('[data-node-id]')?.getAttribute('data-node-id')
  ?? target?.closest('[data-graph-id]')?.getAttribute('data-graph-id')
  ?? '';
export const itemRefFrom = (target?: Element | null): ItemRef | null => {
  const node = target?.closest('[data-node-id]')?.getAttribute('data-node-id');
  if (node) return { kind: 'node', id: node };
  const graph = target?.closest('[data-graph-id]')?.getAttribute('data-graph-id');
  if (graph) return { kind: 'graph', id: graph };
  return null;
};

export const createModelRegistry = <Ctx,>(model: ModelDef<Ctx>) => {
  const entities = new Map(model.entities.map(entityDef => [entityDef.kind, entityDef]));
  const collections = new Map(model.collections.map(collectionDef =>
    [collectionDef.id, collectionDef as unknown as CollectionDef<unknown, unknown>],
  ));
  return {
    entity<T, Patch = unknown>(kind: string) { return entities.get(kind) as EntityDef<T, Patch> | undefined; },
    collection<T>(id: string) { return collections.get(id) as CollectionDef<T, unknown> | undefined; },
    entities: () => [...entities.values()],
    collections: () => [...collections.values()],
  };
};

function templateContext() {
  const find = (root: ParentNode, selector: string) =>
    root instanceof Element && root.matches(selector) ? root : root.querySelector(selector);
  const clone = <T extends HTMLElement = HTMLElement>(name: string) => {
    const template = document.getElementById(`tpl-${name}`);
    const node = template instanceof HTMLTemplateElement ? template.content.firstElementChild?.cloneNode(true) : null;
    if (!(node instanceof HTMLElement)) throw new Error(`Missing template: ${name}`);
    return node as T;
  };
  const text = (root: ParentNode, name: string, value: unknown) => {
    const el = find(root, `[data-text="${name}"]`);
    if (el) el.textContent = String(value ?? '');
    return root;
  };
  const slot = (root: ParentNode, name: string) => {
    const el = find(root, `[data-slot="${name}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`Missing slot: ${name}`);
    return el;
  };
  return { clone, text, slot };
}

function viewContext(places: Map<Place, HTMLElement>) {
  let state: ViewState = { x: 0, y: 0, scale: 1 };
  const localRect = (place: Place) => places.get(place)?.getBoundingClientRect();
  const get = () => ({ ...state });
  const set = (next: Partial<ViewState>) => {
    state = {
      x: next.x ?? state.x,
      y: next.y ?? state.y,
      scale: clamp(next.scale ?? state.scale, 0.25, 3),
    };
    return get();
  };
  const clientToScreen = (place: Place, point: Position) => {
    const rect = localRect(place);
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : point;
  };
  const screenToSpace = (point: Position) => ({ x: state.x + point.x / state.scale, y: state.y + point.y / state.scale });
  const spaceToScreen = (point: Position) => ({ x: (point.x - state.x) * state.scale, y: (point.y - state.y) * state.scale });
  const clientToSpace = (place: Place, point: Position) => screenToSpace(clientToScreen(place, point));
  const screenCenter = (place: Place) => {
    const rect = localRect(place);
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  };
  const spaceCenter = (place: Place) => screenToSpace(screenCenter(place));
  const visibleRect = (place: Place, margin = 0): Rect | null => {
    const rect = localRect(place);
    if (!rect) return null;
    return {
      x: state.x - margin,
      y: state.y - margin,
      w: rect.width / state.scale + margin * 2,
      h: rect.height / state.scale + margin * 2,
    };
  };
  const isVisible = (place: Place, rect: Rect, margin = 0) => {
    const visible = visibleRect(place, margin);
    return !visible || rectsIntersect(visible, rect);
  };
  const zoomAtScreen = (screen: Position, factor: number) => {
    const before = screenToSpace(screen);
    const scale = clamp(state.scale * factor, 0.25, 3);
    return set({ scale, x: before.x - screen.x / scale, y: before.y - screen.y / scale });
  };
  return { get, set, clientToScreen, screenToSpace, spaceToScreen, clientToSpace, screenCenter, spaceCenter, visibleRect, isVisible, zoomAtScreen };
}

function eventBus(): Bus {
  const listeners = new Map<EventName, ((data: unknown, event: AnyEvent) => void)[]>();
  const any: ((event: AnyEvent) => void)[] = [];
  return {
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)!).push(fn as (data: unknown, event: AnyEvent) => void); },
    onAny(fn) { any.push(fn); },
    emit(name, ...args) {
      const event = { name, data: args[0], at: performance.now() } as AnyEvent;
      any.forEach(fn => fn(event));
      (listeners.get(name) || []).forEach(fn => fn(event.data, event));
    },
  };
}

function createContexts(bus: Bus) {
  const commandMap = new Map<string, CommandSpec>();
  const places = new Map<Place, HTMLElement>();
  const templates = templateContext();
  const view = viewContext(places);
  const shortcutConflict = (id: string, shortcut: string) => {
    const key = shortcutKey(shortcut);
    if (!key) return undefined;
    return [...commandMap.values()].find(command => command.id !== id && shortcutKey(shortcutOf(command)) === key);
  };

  const commands = {
    register: (commands: CommandSpec[]) => commands.forEach(command => commandMap.set(command.id, command)),
    get: (id: string) => commandMap.get(id),
    all: () => [...commandMap.values()],
    shortcutConflict,
    setShortcut(id: string, shortcut: string) {
      const command = commandMap.get(id);
      if (!command) return false;
      const next = shortcut.trim();
      if (shortcutConflict(id, next)) return false;
      command.shortcut = next;
      if (command.input?.key) command.input.key = keyOfShortcut(command.shortcut);
      return true;
    },
    run(id: string, source: CommandSource = {}) {
      const command = commandMap.get(id);
      if (!command || command.available?.(source) === false) return false;
      const payload = command.payload?.(source);
      (bus.emit as (name: EventName, data?: unknown) => void)(command.event, payload);
      return true;
    },
  };

  const input = {
    start(root: Document | HTMLElement = document) {
      const route = (event: Event) => {
        const rawTarget = event.target instanceof Element ? event.target : null;
        const typing = event instanceof KeyboardEvent
          && (/input|textarea|select/i.test(rawTarget?.tagName ?? '') || (rawTarget instanceof HTMLElement && rawTarget.isContentEditable));

        const button = event.type === 'click' ? rawTarget?.closest('[data-command]') : null;
        if (button instanceof HTMLElement) {
          event.preventDefault();
          commands.run(button.dataset.command!, { event, target: button });
          return;
        }

        for (const command of commands.all()) {
          const binding = command.input;
          if (!binding || binding.on !== event.type) continue;
          if (binding.key && !keyMatches(event, binding.key)) continue;
          const target = rawTarget && binding.selector ? rawTarget.closest(binding.selector) : rawTarget;
          if (!(target instanceof Element) || (binding.selector && !target)) continue;
          if (typing && !binding.global && !binding.selector) continue;
          if (binding.when && !binding.when(event, target)) continue;
          if (binding.prevent) event.preventDefault();
          commands.run(command.id, { event, target });
          if (binding.stop) break;
        }
      };
      (['click', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'input', 'change', 'focusout'] as RawInput[])
        .forEach(type => root.addEventListener(type, route, type === 'wheel' ? { passive: false } : undefined));
    },
  };

  const placeContext = {
    set: (place: Place, el: HTMLElement | null) => { if (el) places.set(place, el); },
    el: (place: Place) => places.get(place) ?? null,
  };

  return { commands, input, places: placeContext, templates, view };
}

export function registry(): Registry {
  const entries: { name: string; setup: AppSystem }[] = [];
  const register = ((name: string, setup: AppSystem) => { entries.push({ name, setup }); }) as Registry;
  register.start = (ctx, then) => {
    const api: SystemCtx = { ...ctx, on: ctx.bus.on, emit: ctx.bus.emit };
    entries.forEach(entry => entry.setup(api));
    then?.();
  };
  register.names = () => entries.map(entry => entry.name);
  return register;
}

export function createAppContext(graphs: GraphStore, model: ModelDef<ModelCtx>): AppCtx {
  const bus = eventBus();
  return { bus, graphs, contexts: createContexts(bus), model: createModelRegistry(model) };
}

export function validateModel<Ctx>(model: ModelDef<Ctx>, commands: ReturnType<Contexts['commands']['all']>) {
  const commandIds = new Set(commands.map(command => command.id));
  const visibleCommandIds = new Set(commands.filter(command => !command.hidden).map(command => command.id));
  const issues: string[] = [];
  model.entities.forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    if (!abilityDef.actions.length) issues.push(`${entityDef.kind}.${abilityDef.id} has no actions`);
    if (abilityDef.id === 'configurable' && !entityDef.properties?.length) issues.push(`${entityDef.kind}.configurable has no properties`);
    abilityDef.actions.forEach(actionDef => {
      if (!visibleCommandIds.has(actionDef.paletteCommand)) issues.push(`${actionDef.id} missing visible palette command ${actionDef.paletteCommand}`);
      if (!actionDef.ui.length) issues.push(`${actionDef.id} has no UI affordance`);
      actionDef.ui.forEach(ui => {
        if (!commandIds.has(ui.command)) issues.push(`${actionDef.id} UI missing command ${ui.command}`);
      });
    });
  }));
  model.collections.forEach(collectionDef => {
    if (!commandIds.has(collectionDef.crud.create)) issues.push(`${collectionDef.id} missing create command ${collectionDef.crud.create}`);
    if (!commandIds.has(collectionDef.crud.delete)) issues.push(`${collectionDef.id} missing delete command ${collectionDef.crud.delete}`);
    if (!collectionDef.search) issues.push(`${collectionDef.id} missing search`);
    if (!collectionDef.order) issues.push(`${collectionDef.id} missing order`);
  });
  return issues;
}
