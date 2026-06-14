import type { PropertyDef, PropertyRenderer } from '../types';

/** Property input registry — turns `prop.input` (a string) into an HTMLElement.
 *  Default renderers for 'text', 'number', 'checkbox', 'textarea', and 'select'
 *  ship; new kinds (color picker, markdown preview, etc.) register here without
 *  touching configurable. */
export function propertiesContext() {
  const renderers = new Map<string, PropertyRenderer<unknown>>();
  const defaultRender = <T,>(prop: PropertyDef<T>, item: T): HTMLElement => {
    const label = document.createElement('label');
    if (prop.input === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.dataset.field = prop.id;
      textarea.rows = prop.rows ?? 5;
      textarea.value = String(prop.value(item));
      label.append(prop.label, textarea);
      return label;
    }
    if (prop.input === 'select') {
      const select = document.createElement('select');
      select.dataset.field = prop.id;
      const value = String(prop.value(item));
      (prop.options ?? []).forEach(option => {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        el.selected = option.value === value;
        select.append(el);
      });
      label.append(prop.label, select);
      return label;
    }
    const input = document.createElement('input');
    input.dataset.field = prop.id;
    input.type = prop.input;
    if (prop.min != null) input.min = `${prop.min}`;
    if (prop.step != null) input.step = `${prop.step}`;
    if (prop.input === 'checkbox') {
      label.className = 'check-row';
      input.checked = Boolean(prop.value(item));
      label.append(input, prop.label);
    } else {
      if (prop.input === 'text') input.classList.add('editable-inline');
      input.value = String(prop.value(item));
      label.append(prop.label, input);
    }
    return label;
  };
  renderers.set('text', defaultRender as PropertyRenderer<unknown>);
  renderers.set('number', defaultRender as PropertyRenderer<unknown>);
  renderers.set('checkbox', defaultRender as PropertyRenderer<unknown>);
  renderers.set('textarea', defaultRender as PropertyRenderer<unknown>);
  renderers.set('select', defaultRender as PropertyRenderer<unknown>);
  return {
    register(name: string, render: PropertyRenderer) { renderers.set(name, render); },
    has(name: string) { return renderers.has(name); },
    render<T>(prop: PropertyDef<T>, item: T): HTMLElement {
      const renderer = (renderers.get(prop.input) ?? defaultRender) as PropertyRenderer<T>;
      return renderer(prop, item);
    },
    names: () => [...renderers.keys()],
  };
}
