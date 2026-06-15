import { itemRefFrom, type Registry } from '../core';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'item.context.open': ItemRef;
    'item.context.edit-title': ItemRef;
    'item.context.properties': ItemRef;
  }
}

type ContainerLike = {
  id: Id;
  Sections?: { id: Id; title: string }[];
  ChildSections?: Record<string, Id>;
};

const childKey = (ref: ItemRef) => `${ref.kind}:${ref.id}`;

export function registerContextActions(system: Registry) {
  system('context.actions', ({ on, emit, contexts, graphs, selection }) => {
    const selected = () => selection.selected();
    const refFrom = (target?: Element | null) => itemRefFrom(target) ?? selected() ?? undefined;
    const button = (label: string, command: string, attrs: Record<string, string> = {}) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'context-action';
      el.dataset.command = command;
      Object.entries(attrs).forEach(([key, value]) => { el.dataset[key] = value; });
      el.textContent = label;
      return el;
    };

    contexts.commands.register([
      {
        id: 'item.context.open',
        label: 'Open context actions',
        group: 'item',
        available: source => !!refFrom(source?.target),
        payload: source => refFrom(source.target),
      },
      {
        id: 'item.context.edit-title',
        label: 'Edit title from context actions',
        group: 'item',
        hidden: true,
        payload: source => refFrom(source.target),
      },
      {
        id: 'item.context.properties',
        label: 'Open properties from context actions',
        group: 'item',
        hidden: true,
        payload: source => refFrom(source.target),
      },
    ]);

    const bodyFor = (ref: ItemRef) => () => {
      const wrap = document.createElement('section');
      wrap.className = 'context-actions';
      wrap.dataset.itemKind = ref.kind;
      wrap.dataset.itemId = ref.id;
      wrap.append(
        button('Edit title', 'item.context.edit-title', { itemKind: ref.kind, itemId: ref.id }),
        button('Properties', 'item.context.properties', { itemKind: ref.kind, itemId: ref.id }),
      );

      if (ref.kind === 'node') {
        const shapes = document.createElement('div');
        shapes.className = 'context-action-row';
        shapes.append(
          button('Text', 'node.type.text'),
          button('Box', 'node.type.square'),
          button('Circle', 'node.type.circle'),
        );
        wrap.append(shapes);
      }

      const parent = contexts.hierarchy.parentRefOf(ref);
      const container = parent?.kind === 'container'
        ? graphs.current.getItem<ContainerLike>(parent)
        : null;
      if (parent?.kind === 'container' && container) {
        wrap.append(button('Move out of container', 'container.remove-child'));
        if (container.Sections?.length) {
          const heading = document.createElement('div');
          heading.className = 'context-action-heading';
          heading.textContent = 'Move to section';
          wrap.append(heading);
          container.Sections.forEach(section => {
            const active = container.ChildSections?.[childKey(ref)] === section.id;
            const move = button(`${active ? '✓ ' : ''}${section.title}`, 'container.child.section.set', {
              containerId: parent.id,
              childKind: ref.kind,
              childId: ref.id,
              sectionId: section.id,
            });
            wrap.append(move);
          });
        }
      }
      return wrap;
    };

    on('item.context.open', ref => {
      const item = graphs.current.getItem(ref);
      if (!item) return;
      emit('modal.open', {
        title: 'Context Actions',
        visual: 'properties',
        body: bodyFor(ref),
      });
    });
    on('item.context.edit-title', ref => {
      emit('modal.close');
      queueMicrotask(() => emit('item.title.edit', { ref }));
    });
    on('item.context.properties', ref => {
      emit('item.properties.open', ref);
    });
  }, { requires: ['modal', 'ability.selectable'] });
}
