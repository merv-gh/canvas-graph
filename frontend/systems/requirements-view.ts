import { itemFoldId, type Registry } from '../core';
import {
  emptyRequirementsFilters,
  requirementsCapabilityPasses,
  requirementsFiltersActive,
  requirementsMapOf,
  type RequirementsCapabilityMap,
  type RequirementsReviewFilters,
} from '../requirements-map';

/** Reading policy for generated requirements documents.
 *
 * The JSON remains ordinary graph data, but its requirementsMap extension
 * carries a presentation contract: the mission root stays open, Attributes
 * start folded, and opening one Attribute closes its siblings. This makes the
 * first frame a legible index and the second frame a focused reading surface.
 */
export function registerRequirementsView(system: Registry) {
  system('requirements.view', ({ on, emit, contexts, graphs, frameLoop, origin }) => {
    const task = 'requirements.view.camera';
    const filterTask = 'requirements.view.filter';
    let applying = false;
    let review: { filters: RequirementsReviewFilters; query: string } = {
      filters: emptyRequirementsFilters(), query: '',
    };
    const metadata = () => requirementsMapOf(graphs.current);
    const mutationCommand = (id: string) => [
      'editing.node.', 'editing.edge.', 'editing.container.',
      'graph.node.', 'graph.edge.', 'graph.container.',
      'selection.item.delete', 'item.title.', 'item.properties.open', 'properties.',
      'node.type.', 'item.nudge.', 'drag.item.', 'resize.item.',
      'container.', 'layout.apply.', 'history.undo', 'history.redo',
    ].some(prefix => id === prefix || id.startsWith(prefix));
    const offGuard = contexts.commands.registerGuard(origin, command => {
      const meta = metadata();
      if (!meta || !mutationCommand(command.id)) return true;
      return `This is a generated requirements projection. Edit ${meta.source}, then run ${meta.regenerateCommand}.`;
    });
    const shellEl = () => contexts.places.el('stage')?.closest<HTMLElement>('.shell') ?? null;
    const syncSurface = () => {
      const shell = shellEl();
      if (!shell) return;
      const meta = metadata();
      shell.dataset.requirementsMap = meta ? 'true' : 'false';
      if (meta) shell.dataset.requirementsSource = meta.source;
      else {
        delete shell.dataset.requirementsSource;
        delete shell.dataset.requirementsFiltered;
      }
    };
    const applyReviewSurface = () => {
      const stage = contexts.places.el('stage');
      const shell = shellEl();
      const meta = metadata();
      if (!stage || !shell) return;
      const active = !!meta && (requirementsFiltersActive(review.filters) || !!review.query.trim());
      shell.dataset.requirementsFiltered = active ? 'true' : 'false';
      const capabilityByNode = new Map(
        Object.entries(meta?.capabilities ?? {}).map(([id, capability]) => [capability.nodeId, { id, capability }]),
      );
      const query = review.query.trim().toLowerCase();
      const matches = (id: string, capability: RequirementsCapabilityMap) => {
        if (!requirementsCapabilityPasses(capability, review.filters)) return false;
        if (!query) return true;
        const node = graphs.current.getNode(capability.nodeId);
        const attribute = meta?.attributeContainers.find(candidate => candidate.id === capability.attributeId);
        return [
          id,
          node?.Label.text ?? '',
          node?.Description ?? '',
          `${capability.attributeId} · ${attribute?.name ?? ''}`,
          `${capability.componentId} · ${capability.componentName}`,
        ].join(' ').toLowerCase().includes(query);
      };
      stage.querySelectorAll<HTMLElement>('.node[data-item-id]').forEach(node => {
        if (meta) {
          const item = graphs.current.getNode(node.dataset.itemId ?? '');
          node.setAttribute('aria-label', `${item?.Label.text || 'Untitled requirement'}; read-only generated requirement card.`);
        }
        const entry = capabilityByNode.get(node.dataset.itemId ?? '');
        if (!entry || !active || !meta?.capabilities) delete node.dataset.requirementsMatch;
        else node.dataset.requirementsMatch = matches(entry.id, entry.capability) ? 'true' : 'false';
      });
      const attributes = new Map((meta?.attributeContainers ?? []).map(attribute => [attribute.containerId, attribute]));
      stage.querySelectorAll<HTMLElement>('.container[data-item-id]').forEach(container => {
        const attribute = attributes.get(container.dataset.itemId ?? '');
        if (!attribute || !active || !meta?.capabilities) delete container.dataset.requirementsMatch;
        else container.dataset.requirementsMatch = attribute.capabilityIds.some(id => {
          const capability = meta.capabilities?.[id];
          return !!capability && matches(id, capability);
        }) ? 'true' : 'false';
      });
    };
    const scheduleReviewSurface = () => frameLoop.schedule(filterTask, applyReviewSurface, 25);
    const foldId = (id: string) => itemFoldId({ kind: 'container', id }, graphs.current.id);
    const relayout = (rootContainerId: string) => emit('layout.apply.sections', { id: rootContainerId });
    const hasGraphFoldState = () => Object.keys(contexts.fold.all())
      .some(id => id.startsWith(`fold:${graphs.current.id}:`));
    const scheduleCamera = (event: 'view.fit.all' | 'view.fit.item', id?: string) => {
      frameLoop.schedule(task, () => {
        if (event === 'view.fit.item' && id) emit(event, { kind: 'container', id });
        else emit('view.fit.all');
      }, 40);
    };
    const applyDefaults = (announce: boolean, force = false) => {
      const meta = metadata();
      if (!meta || (!force && hasGraphFoldState())) return;
      applying = true;
      contexts.fold.set(foldId(meta.rootContainerId), true);
      meta.defaultFoldedContainerIds.forEach(id => contexts.fold.set(foldId(id), false));
      applying = false;
      relayout(meta.rootContainerId);
      scheduleCamera('view.fit.all');
      if (announce) {
        emit('app.notice', {
          message: `Requirements ready · ${meta.counts.attributes} Attributes · ${meta.counts.capabilities} capabilities · ${meta.counts.openBlockers} open blockers.`,
        });
      }
    };

    on('app.start', () => { syncSurface(); scheduleReviewSurface(); });
    on('graph.imported', () => { syncSurface(); applyDefaults(true, true); scheduleReviewSurface(); });
    on('graph.switched', () => { syncSurface(); applyDefaults(false); scheduleReviewSurface(); });
    on('requirements.review.changed', next => {
      review = { filters: { ...next.filters }, query: next.query };
      scheduleReviewSurface();
    });
    on('render.stage.draw', scheduleReviewSurface);
    on('render.stage.camera', scheduleReviewSurface);
    on('fold.changed', ({ id, open }) => {
      if (applying) return;
      const meta = metadata();
      if (!meta) return;
      const attribute = meta.attributeContainers.find(candidate => foldId(candidate.containerId) === id);
      if (!attribute) return;
      applying = true;
      if (open) {
        meta.attributeContainers.forEach(candidate => {
          if (candidate.containerId === attribute.containerId) return;
          const siblingId = foldId(candidate.containerId);
          if (contexts.fold.isOpen(siblingId)) contexts.fold.set(siblingId, false);
        });
        const rootId = foldId(meta.rootContainerId);
        if (!contexts.fold.isOpen(rootId)) contexts.fold.set(rootId, true);
      }
      applying = false;
      relayout(meta.rootContainerId);
      scheduleCamera(open ? 'view.fit.item' : 'view.fit.all', attribute.containerId);
    });

    return () => { frameLoop.cancel(task); frameLoop.cancel(filterTask); offGuard(); };
  }, { requires: ['containers', 'layout', 'view.zoom'] });
}
