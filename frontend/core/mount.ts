/** Mount root indirection.
 *
 * The dev app renders into `#app` (index.html). When the app is embedded as a
 * library it must render into a caller-supplied element instead — the host page
 * owns its own DOM and there may be no `#app`. `setMountRoot` lets the library
 * point the renderer at any element before boot; `mountRoot` is what `render`
 * resolves against. Default preserves the standalone behaviour. */
let root: HTMLElement | null = null;

export const setMountRoot = (el: HTMLElement) => { root = el; };

export const mountRoot = (): HTMLElement => {
  if (root) return root;
  const el = document.getElementById('app');
  if (!el) throw new Error('mountRoot: no element set and no #app in document');
  return el;
};
