import type { IconName, PropertyDef, PropertyRenderer } from '../types';
import { iconNode } from './icons';

const placementIcon: Record<string, IconName> = {
  inside: 'placement-inside',
  below: 'placement-below',
  right: 'placement-right',
  hidden: 'placement-hidden',
};

/** Property input registry — turns `prop.input` (a string) into an HTMLElement.
 *  Default renderers for 'text', 'number', 'checkbox', 'textarea', and 'select'
 *  ship; new kinds (color picker, markdown preview, etc.) register here without
 *  touching configurable. */
export function propertiesContext() {
  const renderers = new Map<string, PropertyRenderer<unknown>>();
  const choiceRender = <T,>(kind: 'swatches' | 'segments' | 'placement') =>
    (prop: PropertyDef<T>, item: T): HTMLElement => {
      const group = document.createElement('fieldset');
      group.className = `property-choice property-choice-${kind}`;
      const legend = document.createElement('legend');
      legend.textContent = prop.label;
      const choices = document.createElement('div');
      choices.className = 'property-choice-options';
      const current = String(prop.value(item));
      (prop.options ?? []).forEach(option => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'properties.item.choice';
        button.dataset.field = prop.id;
        button.dataset.value = option.value;
        button.dataset.optionValue = option.value || 'automatic';
        button.setAttribute('aria-label', `${prop.label}: ${option.label}`);
        button.setAttribute('aria-pressed', option.value === current ? 'true' : 'false');
        if (option.icon) {
          const icon = document.createElement('span');
          icon.className = 'property-choice-icon';
          icon.setAttribute('aria-hidden', 'true');
          if (kind === 'placement' && placementIcon[option.value]) icon.append(iconNode(placementIcon[option.value]));
          else icon.textContent = option.icon;
          button.append(icon);
        }
        const label = document.createElement('span');
        label.className = 'property-choice-label';
        label.textContent = option.label;
        button.append(label);
        choices.append(button);
      });
      group.append(legend, choices);
      return group;
    };
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
  renderers.set('swatches', choiceRender('swatches') as PropertyRenderer<unknown>);
  renderers.set('segments', choiceRender('segments') as PropertyRenderer<unknown>);
  renderers.set('placement', choiceRender('placement') as PropertyRenderer<unknown>);
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
