/** Default render adapter: HTML <template> elements addressed by id (`tpl-<name>`).
 *  Systems clone a template, then fill named [data-text="..."] and [data-slot="..."]
 *  holes. Swappable — a future JSX adapter just exposes the same surface. */
export function templateContext() {
  const find = (root: ParentNode, selector: string) =>
    root instanceof Element && root.matches(selector) ? root : root.querySelector(selector);
  const cloned = new Set<string>();
  const clone = <T extends HTMLElement = HTMLElement>(name: string) => {
    cloned.add(name);
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
    if (!(el instanceof Element)) throw new Error(`Missing slot: ${name}`);
    return el as HTMLElement;
  };
  return { clone, text, slot, _cloned: cloned };
}

export type TemplateApi = ReturnType<typeof templateContext>;

/** Build an empty-state DOM block. `hint` is a Node — typically text + a <kbd>.
 *  Use `kbdHint(lead, key, tail)` for "Press <kbd>K</kbd> tail" without HTML strings. */
export const emptyState = (templates: TemplateApi, title: string, hint?: Node, command?: string) => {
  try {
    const el = templates.clone<HTMLElement>('empty');
    templates.text(el, 'title', title);
    if (hint) templates.slot(el, 'hint').append(hint);
    if (command) {
      el.classList.add('empty-action');
      el.dataset.command = command;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${title}. Activate to continue.`);
    }
    return el;
  } catch { return null; }
};

/** Compose a hint as a DocumentFragment with a <kbd> in the middle.
 *  `key` is set via textContent, so user-edited shortcuts can't inject HTML. */
export const kbdHint = (lead: string, key: string, tail = '') => {
  const fragment = document.createDocumentFragment();
  if (lead) fragment.append(lead);
  const kbd = document.createElement('kbd');
  kbd.textContent = key;
  fragment.append(kbd);
  if (tail) fragment.append(tail);
  return fragment;
};
