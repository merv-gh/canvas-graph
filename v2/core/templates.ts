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
