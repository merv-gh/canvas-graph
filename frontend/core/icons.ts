import type { IconName } from '../types';

const NS = 'http://www.w3.org/2000/svg';
const paths: Record<IconName, string[]> = {
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  fit: ['M8 3H3v5', 'M16 3h5v5', 'M8 21H3v-5', 'M16 21h5v-5'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  commands: ['M4 6h16', 'M4 12h16', 'M4 18h10', 'M8 3v6', 'M16 9v6', 'M10 15v6'],
  select: ['m5 3 14 9-6 2-3 6z'],
  draw: ['m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z', 'm13.5 7.5 3 3'],
  erase: ['m7 20-4-4 10-10a2.8 2.8 0 0 1 4 0l3 3a2.8 2.8 0 0 1 0 4l-7 7z', 'M10 20h11'],
  node: ['M5 5h14v14H5z'],
  connect: ['M6 12h12', 'm14 8 4 4-4 4', 'M4 9v6'],
  container: ['M4 5h16v14H4z', 'M4 9h16'],
  group: ['M5 8h8v8H5z', 'M11 5h8v8'],
  undo: ['m9 7-5 5 5 5', 'M4 12h9a6 6 0 0 1 6 6'],
  redo: ['m15 7 5 5-5 5', 'M20 12h-9a6 6 0 0 0-6 6'],
  export: ['M12 3v12', 'm7 8 5-5 5 5', 'M5 14v6h14v-6'],
  import: ['M12 15V3', 'm7 10 5 5 5-5', 'M5 14v6h14v-6'],
  share: ['M8 12 16 7', 'M8 12l8 5', 'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
  help: ['M9.5 9a2.7 2.7 0 1 1 4.6 2c-1.1 1-2.1 1.4-2.1 3', 'M12 18h.01', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20'],
  theme: ['M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9'],
  star: ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'],
  'star-filled': ['m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  trash: ['M4 7h16', 'M9 3h6l1 4H8z', 'M6 7l1 14h10l1-14', 'M10 11v6', 'M14 11v6'],
  text: ['M5 5h14', 'M12 5v14', 'M9 19h6'],
  circle: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'],
  toggle: ['M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7', 'M8 12h.01'],
  reverse: ['M7 7h11', 'm15 4 3 3-3 3', 'M17 17H6', 'm3-3-3 3 3 3'],
  collapse: ['M5 12h14'],
  ungroup: ['M4 8h8v8H4z', 'M12 5h8v8h-3', 'M15 19H8v-3'],
  'move-out': ['M5 19h10V9', 'm11 7 4-4 4 4', 'M19 3v10'],
  check: ['m5 12 4 4L19 6'],
  'placement-inside': ['M4 4h16v16H4z', 'M8 9h8', 'M8 13h6'],
  'placement-below': ['M5 3h14v10H5z', 'M7 17h10', 'M8 21h8'],
  'placement-right': ['M3 5h10v14H3z', 'M16 8h5', 'M16 12h5', 'M16 16h4'],
  'placement-hidden': ['M4 4h16v16H4z', 'M3 21 21 3'],
  'layout-columns': ['M4 5h7v14H4z', 'M13 5h7v14h-7z'],
  'layout-rows': ['M4 5h16v6H4z', 'M4 13h16v6H4z'],
  pulse: ['M3 12h4l3-7 4 14 3-7h4'],
};

export const iconNode = (name: IconName, className = 'ui-icon') => {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add(...className.split(/\s+/).filter(Boolean));
  paths[name].forEach(d => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', name === 'star-filled' ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  });
  return svg;
};

export const setIcon = (element: Element, name: IconName) => element.replaceChildren(iconNode(name));
