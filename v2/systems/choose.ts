import { nodeRef, type Registry } from '../core';
import type { ItemRef, Position } from '../types';

/** choose — strategies for *building the chosen set*, and bulk actions over it.
 *
 *  "Choosing" is a higher concept than single selection: a chooser is a
 *  `Set → Set` transform (all / none / invert / follow-edges / radius / search),
 *  each emitting `selection.choose {refs, mode}`. Actions are `Set → mutations`
 *  that fan out into the SAME per-item events single-select already uses
 *  (`graph.*.delete`, `item.update`, `container.add-child`) — so decorations,
 *  redraw, deletion-cleanup, and (later) undo all reuse one set of seams.
 *
 *  Universal hotkeys: Ctrl+A (all), Ctrl+G (group). Esc (none) rides the global
 *  cancellation. Non-trivial mouse choosers (box / drag-follow) are TODO. */
declare module '../types' {
  interface CustomEvents {
    'choose.all': void;
    'choose.none': void;
    'choose.invert': void;
    'choose.follow': void;
    'choose.radius': void;
    'choose.search': { q: string };
    /** Bulk action: fold the chosen nodes/containers into a new container. */
    'selection.group': void;
  }
}

/** Proximity threshold (graph-space) for the "grow by radius" chooser. */
const RADIUS = 240;

export function registerChoose(system: Registry) {
  system('choose', ({ on, emit, contexts, graphs, selection, flags, contribute }) => {
    const allRefs = (): ItemRef[] => contexts.hierarchy.items().map(item => item.ref);
    const chosenNodes = () => selection.selectedAll().filter(ref => ref.kind === 'node');

    contexts.commands.register([
      {
        id: 'choose.all', label: 'Choose all', group: 'choose', shortcut: 'Ctrl+A',
        input: { on: 'keydown', key: 'a', ctrl: true, prevent: true },
        available: () => allRefs().length > 0,
      },
      { id: 'choose.none', label: 'Choose none', group: 'choose', available: () => selection.selectedAll().length > 0 },
      { id: 'choose.invert', label: 'Invert choice', group: 'choose', available: () => allRefs().length > 0, shortcut: 'I', input: { on: 'keydown', key: 'i', prevent: true } },
      { id: 'choose.follow', label: 'Grow along edges', group: 'choose', available: () => chosenNodes().length > 0 },
      { id: 'choose.radius', label: 'Grow by proximity', group: 'choose', available: () => chosenNodes().length > 0 },
      {
        id: 'choose.search', label: 'Choose by search', group: 'choose',
        form: {
          title: 'Choose by search',
          submitLabel: 'Choose',
          shouldOpen: () => true,
          fields: [{ id: 'q', label: 'Label contains', autofocus: true }],
          payload: values => ({ q: values.q ?? '' }),
        },
        available: () => allRefs().length > 0,
      },
      {
        id: 'selection.group', label: 'Group into container', group: 'choose', shortcut: 'Ctrl+G',
        input: { on: 'keydown', key: 'g', ctrl: true, prevent: true },
        available: () => flags.isOn('containers') && selection.selectedAll().some(ref => ref.kind === 'node' || ref.kind === 'container'),
      },
    ]);

    on('choose.all', () => emit('selection.choose', { refs: allRefs(), mode: 'replace' }));
    on('choose.none', () => emit('selection.item.clear'));
    on('choose.invert', () => emit('selection.choose', { refs: allRefs().filter(ref => !selection.has(ref)), mode: 'replace' }));

    // Follow edge direction (both ways): add every node adjacent to a chosen one.
    on('choose.follow', () => {
      const ids = new Set(chosenNodes().map(ref => ref.id));
      const add: ItemRef[] = [];
      graphs.current.edges().forEach(edge => {
        if (ids.has(edge.From)) add.push(nodeRef(edge.To));
        if (ids.has(edge.To)) add.push(nodeRef(edge.From));
      });
      if (add.length) emit('selection.choose', { refs: add, mode: 'add' });
    });

    // Grow by spatial proximity: add nodes within RADIUS of any chosen member.
    on('choose.radius', () => {
      const centers = selection.selectedAll()
        .map(ref => (graphs.current.getItem(ref) as { Position?: Position } | undefined)?.Position)
        .filter((p): p is Position => !!p);
      if (!centers.length) return;
      const near = graphs.current.nodes()
        .filter(n => n.Position && centers.some(c => Math.hypot(n.Position!.x - c.x, n.Position!.y - c.y) <= RADIUS))
        .map(n => nodeRef(n.id));
      if (near.length) emit('selection.choose', { refs: near, mode: 'add' });
    });

    on('choose.search', ({ q }) => {
      const needle = q.trim().toLowerCase();
      if (!needle) return;
      const refs = contexts.hierarchy.items()
        .filter(item => (item.label ?? '').toLowerCase().includes(needle))
        .map(item => item.ref);
      emit('selection.choose', { refs, mode: 'replace' });
    });

    // Group: create a container, then move every chosen node/container into it.
    // The container.created emit is synchronous, so the one-shot fires before
    // the create handler's own select — children land, container ends selected.
    on('selection.group', () => {
      const members = selection.selectedAll().filter(ref => ref.kind === 'node' || ref.kind === 'container');
      if (!members.length) return;
      const off = on('container.created', ({ id }) => {
        off();
        members.forEach(childRef => emit('container.add-child', { containerId: id, childRef }));
      });
      emit('editing.container.create', {});
    });

    contribute({ surface: 'top', command: 'choose.all', kind: 'button', text: 'All', order: 40 });
    contribute({ surface: 'top', command: 'selection.group', kind: 'button', text: 'Group', order: 41 });
  }, { requires: ['ability.selectable', 'graph'] });
}
