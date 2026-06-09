import { uiValue, type Registry } from '../core';
import { Places } from '../types';
import type { ActionDef, AffordanceDef, EntityDef } from '../types';

/** Ephemeral toolbar pinned above the selected item — regardless of kind.
 *
 *  Pulls affordances from the same `affordances.entity(entityDef)` API the
 *  in-template wiring uses. Whichever entity is selected, its abilities'
 *  affordances appear here in floating chrome — no per-kind branching.
 *
 *  Adding a new entity kind that should get the toolbar = nothing here, as
 *  long as the entity declares abilities with `surface: 'entity'` affordances. */
export function registerItemToolbar(system: Registry) {
  system('item.toolbar', ({ on, emit, contexts, graphs, model, selection }) => {
    const clear = () => emit('render.view.clear', { place: Places.Stage, key: 'item-toolbar' });

    const buildButton = (item: unknown, action: ActionDef<unknown>, ui: AffordanceDef<unknown>) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = ui.command;
      button.textContent = uiValue(ui.text, item, action.label);
      button.setAttribute('aria-label', uiValue(ui.label, item, action.label));
      if (ui.className) button.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => button.setAttribute(name, uiValue(value, item)));
      return button;
    };

    const buildHandler = (item: unknown, ui: AffordanceDef<unknown>, text: string) => {
      const span = document.createElement('span');
      if (ui.className) span.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => span.setAttribute(name, uiValue(value, item)));
      span.textContent = text;
      return span;
    };

    const buildToolbar = (entityDef: EntityDef<unknown>, item: unknown, ref: import('../types').ItemRef) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'item-toolbar node-toolbar';
      // data-item-* lets affordance commands resolve the ref from inside the
      // toolbar without us threading the id manually.
      wrapper.dataset.itemKind = ref.kind;
      wrapper.dataset.itemId = ref.id;
      const pos = (item as { Position?: { x: number; y: number } }).Position ?? { x: 0, y: 0 };
      const size = (item as { Size?: { w: number; h: number } }).Size ?? { w: 0, h: 0 };
      const screen = contexts.view.spaceToScreen({ x: pos.x, y: pos.y - size.h / 2 });
      wrapper.style.left = `${screen.x}px`;
      wrapper.style.top = `${screen.y}px`;

      const append = (slot: string, kind: 'button' | 'handler', handlerText = '', baseClass = '') => {
        contexts.affordances.entity(entityDef, slot).forEach(({ action, ui }) => {
          if (ui.kind !== kind) return;
          const el = kind === 'button'
            ? buildButton(item, action, ui)
            : buildHandler(item, ui, handlerText);
          if (baseClass) el.classList.add(baseClass);
          wrapper.append(el);
        });
      };
      append('drag', 'handler', '⋮⋮', 'node-drag-handle');
      append('header:start', 'button');
      append('header:end', 'button');
      return wrapper;
    };

    const draw = () => {
      const ref = selection.selected();
      if (!ref) return clear();
      const entityDef = model.entity(ref.kind);
      const item = graphs.current.getItem(ref);
      if (!entityDef || !item) return clear();
      // Skip if the entity has no `surface: 'entity'` affordances at all —
      // nothing to put in the toolbar, no point flashing it.
      const affs = contexts.affordances.entity(entityDef);
      if (!affs.length) return clear();
      emit('render.view.set', {
        place: Places.Stage,
        key: 'item-toolbar',
        view: () => buildToolbar(entityDef, item, ref) ?? document.createDocumentFragment(),
      });
    };

    on('render.stage.draw', draw);
  });
}
