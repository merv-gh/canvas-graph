import type { PropertyDef, PropertyRenderer } from '../types';

/** Property input registry — turns `prop.input` (a string) into an HTMLElement.
 *  Default renderers for 'text', 'number', 'checkbox' ship; new kinds (color picker,
 *  select, etc.) register here without touching core. */
export function propertiesContext() {
  const renderers = new Map<string, PropertyRenderer<unknown>>();
  const defaultRender = <T,>(prop: PropertyDef<T>, item: T): HTMLElement => {
    const label = document.createElement('label');
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
