import { itemIdFrom, refKey, type AppCtx, type NestApi } from '../core';
import { Places, type CommandSpecInput, type Id, type ItemRef } from '../types';
import { firstSectionId, type Container } from './container-entity';

type SectionTitleTarget = {
  el: HTMLElement;
  containerId: Id;
  sectionId: Id;
};

type ContainerCommandDependencies = {
  containerOfChild: (ref: ItemRef) => Container | null;
  containersHere: () => Map<Id, Container>;
  contexts: AppCtx['contexts'];
  isSectionResizing: () => boolean;
  nestHere: () => NestApi;
  sectionTitleTarget: (target?: Element | null) => SectionTitleTarget | null;
  selection: AppCtx['selection'];
};

export const containerCommands = ({
  containerOfChild,
  containersHere,
  contexts,
  isSectionResizing,
  nestHere,
  sectionTitleTarget,
  selection,
}: ContainerCommandDependencies): CommandSpecInput[] => [
      {
        id: 'editing.container.create',
        label: 'Create container',
        group: 'container',
        shortcut: 'Y',
        input: { on: 'keydown', key: 'y', prevent: true },
        payload: () => ({
          Label: { text: `Container ${containersHere().size + 1}` },
          at: contexts.view.spaceCenter(Places.Stage),
        }),
      },
      {
        id: 'graph.container.delete',
        label: 'Delete container immediately',
        group: 'container',
        hidden: true,
        available: source => {
          const fromDom = !!source?.target?.closest('[data-item-kind="container"]') && !!itemIdFrom(source?.target);
          const ref = selection.selected();
          return fromDom || ref?.kind === 'container';
        },
        payload: source => {
          const fromDom = source.target?.closest('[data-item-kind="container"]')?.getAttribute('data-item-id');
          if (fromDom) return { id: fromDom };
          const ref = selection.selected();
          return ref?.kind === 'container' ? { id: ref.id } : undefined;
        },
      },
      {
        id: 'container.delete.request',
        label: 'Delete container…',
        group: 'container',
        available: source => {
          const fromDom = !!source?.target?.closest('[data-item-kind="container"]') && !!itemIdFrom(source?.target);
          const ref = selection.selected();
          return fromDom || ref?.kind === 'container';
        },
        payload: source => {
          const fromDom = source.target?.closest('[data-item-kind="container"]')?.getAttribute('data-item-id');
          if (fromDom) return { id: fromDom, confirm: source.origin !== 'programmatic' };
          const ref = selection.selected();
          return ref?.kind === 'container' ? { id: ref.id, confirm: source.origin !== 'programmatic' } : undefined;
        },
      },
      {
        id: 'container.ungroup',
        label: 'Ungroup and keep contents',
        group: 'container',
        available: source => {
          const fromDom = source?.target?.closest('[data-item-kind="container"]')?.getAttribute('data-item-id');
          const ref = selection.selected();
          const id = fromDom ?? (ref?.kind === 'container' ? ref.id : undefined);
          return !!id && (containersHere().get(id)?.Children.length ?? 0) > 0;
        },
        payload: source => {
          const fromDom = source.target?.closest('[data-item-kind="container"]')?.getAttribute('data-item-id');
          if (fromDom) return { id: fromDom };
          const ref = selection.selected();
          return ref?.kind === 'container' ? { id: ref.id } : undefined;
        },
      },
      {
        id: 'container.delete.confirm', label: 'Confirm container deletion', group: 'container', hidden: true,
        input: { on: 'click', selector: '[data-container-delete-confirm]' },
      },
      {
        id: 'container.delete.cancel', label: 'Cancel container deletion', group: 'container', hidden: true,
        input: { on: 'click', selector: '[data-container-delete-cancel]' },
      },
      {
        id: 'container.add-child',
        label: 'Move item',
        event: 'container.move-child',
        group: 'container',
        shortcut: 'M',
        input: { on: 'keydown', key: 'm', prevent: true },
        picker: {
          title: 'Move item',
          steps: [
            { id: 'child', prompt: 'Pick a node or container to move',
              filter: () => ref => ref.kind === 'node' || ref.kind === 'container',
              seed: () => {
                const r = selection.selected();
                return r && (r.kind === 'node' || r.kind === 'container') ? r : null;
              } },
            { id: 'container', prompt: 'Pick a destination', canvasLabel: 'Canvas',
              canvas: vs => !!vs.child && !!nestHere().parentRefOf(vs.child),
              filter: vs => ref => ref.kind === 'container' && !!vs.child && !nestHere().isAncestorOrSelf(vs.child, ref) },
          ],
          validate: vs => (!vs.child || !vs.container) ? 'Pick an item and a destination.' : undefined,
          payload: vs => ({ destination: vs.container, childRef: vs.child }),
        },
      },
      {
        id: 'container.remove-child',
        label: 'Remove from container',
        group: 'container',
        available: () => {
          const r = selection.selected();
          return !!r && !!nestHere().parentRefOf(r);
        },
        payload: () => {
          const r = selection.selected();
          return r ? { childRef: r } : undefined;
        },
      },
      {
        id: 'container.child.section.set',
        label: 'Move item to container section',
        group: 'container',
        hidden: true,
        payload: source => {
          const target = source.target as HTMLElement | undefined;
          const childKind = target?.dataset.childKind as ItemRef['kind'] | undefined;
          const childId = target?.dataset.childId;
          const childRef = childKind && childId ? { kind: childKind, id: childId } as ItemRef : selection.selected() ?? undefined;
          return {
            containerId: target?.dataset.containerId,
            childRef,
            sectionId: target?.dataset.sectionId,
          };
        },
      },
      {
        id: 'container.child.section.next',
        label: 'Move to next section',
        event: 'container.child.section.set',
        group: 'container',
        available: () => {
          const ref = selection.selected();
          const c = ref ? containerOfChild(ref) : null;
          return (c?.Sections?.length ?? 0) > 1;
        },
        payload: () => {
          const childRef = selection.selected() ?? undefined;
          const c = childRef ? containerOfChild(childRef) : null;
          if (!childRef || !c?.Sections?.length) return undefined;
          const current = c.ChildSections?.[refKey(childRef)] ?? firstSectionId(c);
          const index = Math.max(0, c.Sections.findIndex(section => section.id === current));
          return { containerId: c.id, childRef, sectionId: c.Sections[(index + 1) % c.Sections.length].id };
        },
      },
      {
        id: 'container.section.title.edit.dblclick',
        label: 'Edit section title',
        event: 'container.section.title.edit',
        group: 'container',
        hidden: true,
        input: { on: 'dblclick', selector: '[data-container-section-title]', prevent: true, stop: true },
        payload: ({ target }) => {
          const hit = sectionTitleTarget(target);
          return hit ? { containerId: hit.containerId, sectionId: hit.sectionId } : undefined;
        },
      },
      {
        id: 'container.section.title.commit.enter',
        label: 'Commit section title',
        event: 'container.section.title.commit',
        group: 'container',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '[data-container-section-title].editing', prevent: true, stop: true },
        payload: ({ target }) => {
          const hit = sectionTitleTarget(target);
          return hit ? { containerId: hit.containerId, sectionId: hit.sectionId, title: hit.el.textContent?.trim() ?? '', finish: true } : undefined;
        },
      },
      {
        id: 'container.section.title.commit.focusout',
        label: 'Commit section title on blur',
        event: 'container.section.title.commit',
        group: 'container',
        hidden: true,
        input: { on: 'focusout', selector: '[data-container-section-title].editing' },
        payload: ({ target }) => {
          const hit = sectionTitleTarget(target);
          return hit ? { containerId: hit.containerId, sectionId: hit.sectionId, title: hit.el.textContent?.trim() ?? '' } : undefined;
        },
      },
      {
        id: 'container.section.resize.start',
        label: 'Start section resize',
        group: 'container',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-container-section-resize]', prevent: true, stop: true },
        payload: ({ event, target }) => ({
          containerId: (target as HTMLElement).dataset.containerId ?? '',
          index: Number((target as HTMLElement).dataset.sectionIndex ?? 0),
          x: (event as PointerEvent).clientX,
          y: (event as PointerEvent).clientY,
        }),
      },
      {
        id: 'container.section.resize.move',
        label: 'Resize sections',
        group: 'container',
        hidden: true,
        input: { on: 'pointermove', when: () => isSectionResizing(), prevent: true, stop: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'container.section.resize.end',
        label: 'End section resize',
        group: 'container',
        hidden: true,
        input: { on: 'pointerup', when: () => isSectionResizing(), stop: true },
      },
    ];

