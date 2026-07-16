import { edgeRef, itemFoldId, nodeRef, refKey, tagItem, type Registry } from '../core';
import {
  emptyRequirementsFilters,
  requirementsCapabilityPasses,
  requirementsFiltersActive,
  requirementsMapOf,
  type RequirementsCapabilityMap,
  type RequirementsFilterKey,
  type RequirementsMapMetadata,
  type RequirementsReviewFilters,
} from '../requirements-map';
import { Places } from '../types';
import type { Graph, GraphEdge, GraphNode } from '../model';
import type { Id, ItemRef } from '../types';

type OutlineContainer = {
  id: Id;
  Label?: { text?: string };
  Sections?: { id: Id; title: string; weight?: number }[];
  SectionAxis?: 'rows' | 'columns';
  ChildSections?: Record<string, Id>;
  Children?: ItemRef[];
};
type OutlineSectionResult = { container: OutlineContainer; section: NonNullable<OutlineContainer['Sections']>[number] };

declare module '../types' {
  interface CustomEvents {
    'outline.draw': void;
    'outline.search.changed': { query: string };
    'outline.search.clear': void;
    'outline.item.open': { graphId: Id; ref: ItemRef };
    'outline.section.open': { graphId: Id; containerId: Id; sectionId: Id };
    'outline.requirements.filter.changed': { key: RequirementsFilterKey; value: string };
    'outline.requirements.filter.clear': void;
    'requirements.review.changed': { filters: RequirementsReviewFilters; query: string };
  }
}

const PANEL_FOLD_ID = 'outline.panel';
const graphFoldId = (id: Id) => `outline.graph.${id}`;
const graphName = (graph: Graph) => graph.name;

/** Release document navigator: the current graph name is always visible. Expand
 *  the rail to search all documents, switch between them, and reveal each
 *  graph's nodes and connections without turning the canvas into a file tree. */
export function registerOutline(system: Registry) {
  system('outline', ({ on, emit, contexts, graphs, frameLoop, origin }) => {
    let query = '';
    let requirementsFilters = emptyRequirementsFilters();
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const matches = (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());
    const count = (value: number, singular: string, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
    const containersOf = (graph: Graph) => graph.itemsOfKind<OutlineContainer>('container');
    const graphMeta = (graph: Graph) => [
      count(graph.nodes().length, 'node'),
      count(graph.edges().length, 'connection'),
      count(containersOf(graph).length, 'container'),
    ].join(' · ');
    const nodeTypeLabel = (type?: string) => type === 'square' ? 'Box' : type === 'circle' ? 'Circle' : 'Text';

    const itemRow = (graph: Graph, ref: ItemRef, label: string, detail: string) => {
      const row = el('button', 'graph-nav-item');
      row.type = 'button';
      row.dataset.command = 'outline.item.open';
      row.dataset.graphId = graph.id;
      tagItem(row, ref);
      const marker = el('span', `graph-nav-marker graph-nav-marker-${ref.kind}`);
      const copy = el('span', 'graph-nav-item-copy');
      copy.append(el('strong', undefined, label), el('small', undefined, detail));
      row.append(marker, copy);
      return row;
    };
    const sectionRow = (graph: Graph, container: OutlineContainer, section: OutlineSectionResult['section'], detail?: string) => {
      const row = el('button', 'graph-nav-item graph-nav-section');
      row.type = 'button';
      row.dataset.command = 'outline.section.open';
      row.dataset.graphId = graph.id;
      row.dataset.containerId = container.id;
      row.dataset.sectionId = section.id;
      tagItem(row, { kind: 'container', id: container.id });
      const marker = el('span', 'graph-nav-marker graph-nav-marker-section');
      const copy = el('span', 'graph-nav-item-copy');
      copy.append(
        el('strong', undefined, section.title),
        el('small', undefined, detail ?? `${container.Label?.text?.trim() || 'Untitled container'} · section`),
      );
      row.append(marker, copy);
      return row;
    };
    const descriptiveText = (item: GraphNode | GraphEdge) => [
      'Description' in item ? item.Description : '',
      item.Purpose, item.Assumptions, item.Limits, item.WhatThen, item.Observability, item.FailureMode,
    ].filter(Boolean).join(' ');

    const requirementSentence = (node: GraphNode) => {
      const lines = (node.Description ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const capability = lines.find(line => !/^Open blocker:/i.test(line) && line.length > 28) ?? lines[1] ?? lines[0] ?? '';
      return capability;
    };
    const requirementsFilterActive = () => requirementsFiltersActive(requirementsFilters);
    const requirementsFilterSelect = (
      key: RequirementsFilterKey,
      label: string,
      options: Array<{ value: string; text: string }>,
    ) => {
      const select = el('select', 'requirements-nav-filter') as HTMLSelectElement;
      select.dataset.requirementsFilter = key;
      select.setAttribute('aria-label', label);
      select.title = label;
      options.forEach(option => {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.text;
        select.append(element);
      });
      select.value = requirementsFilters[key];
      return select;
    };
    const requirementsFilterControls = (meta: RequirementsMapMetadata) => {
      if (!meta.capabilities) return null; // v2 projections remain readable, without v3 readiness filters.
      const controls = el('div', 'requirements-nav-filters');
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Requirements review filters');
      controls.append(
        requirementsFilterSelect('scope', 'Release scope', [
          { value: 'all', text: 'All scope' },
          { value: '0.1', text: '0.1 only' },
          { value: 'later', text: 'Later only' },
        ]),
        requirementsFilterSelect('readiness', 'Readiness state', [
          { value: 'all', text: 'All readiness' },
          { value: 'blocked', text: 'Open blockers' },
          { value: 'needs-proof', text: 'Needs proof' },
          { value: 'missing', text: 'No record' },
          { value: 'pending', text: 'Pending / stale' },
          { value: 'proven', text: 'Proven' },
        ]),
        requirementsFilterSelect('attribute', 'Attribute', [
          { value: 'all', text: 'All Attributes' },
          ...meta.attributeContainers.map(attribute => ({ value: attribute.id, text: `${attribute.id} ${attribute.name}` })),
        ]),
        requirementsFilterSelect('component', 'Component', [
          { value: 'all', text: 'All Components' },
          ...(meta.components ?? []).map(component => ({ value: component.id, text: `${component.id} ${component.name}` })),
        ]),
      );
      if (requirementsFilterActive()) {
        const clear = el('button', 'requirements-nav-filter-clear', 'Clear filters');
        clear.type = 'button';
        clear.dataset.command = 'outline.requirements.filter.clear';
        const note = el('small', 'requirements-nav-filter-note', 'Matching cards stay prominent; context dims on the canvas.');
        controls.append(clear, note);
      }
      return controls;
    };
    const requirementsItems = (graph: Graph, meta: RequirementsMapMetadata) => {
      const group = el('div', 'graph-nav-tree graph-nav-requirements');
      const summary = el('section', 'requirements-nav-summary');
      const source = el('span', 'requirements-nav-source', `Generated view · ${meta.source}`);
      const totals = el(
        'strong',
        'requirements-nav-totals',
        `${meta.counts.attributes} Attributes · ${meta.counts.capabilities} capabilities · ${meta.counts.openBlockers} open blockers`,
      );
      const regenerate = el('small', 'requirements-nav-regenerate', `Refresh: ${meta.regenerateCommand}`);
      const evidence = el(
        'small',
        'requirements-nav-evidence',
        `Evidence: ${meta.evidenceCoverage.accepted}/${meta.evidenceCoverage.required} release Capabilities proven · ${meta.evidenceCoverage.unproven ?? Math.max(0, meta.evidenceCoverage.required - meta.evidenceCoverage.accepted)} unproven · ${meta.evidenceCoverage.records ?? 0} records`,
      );
      summary.append(source, totals, evidence, regenerate);
      group.append(summary);
      const filters = requirementsFilterControls(meta);
      if (filters) group.append(filters);

      const mission = graph.getNode(meta.missionNodeId);
      const missionMatch = mission && matches(`${mission.Label.text} ${mission.Description ?? ''}`);
      if ((!query.trim() && !requirementsFilterActive()) || (query.trim() && missionMatch && !requirementsFilterActive())) {
        const overview = itemRow(
          graph,
          { kind: 'container', id: meta.rootContainerId },
          'Contract overview',
          'Mission, scope, legend, and Attribute index',
        );
        overview.classList.add('requirements-nav-overview');
        group.append(overview);
      }

      const requirementRow = (graph: Graph, node: GraphNode, capability?: RequirementsCapabilityMap) => {
        const row = itemRow(graph, nodeRef(node.id), node.Label.text, requirementSentence(node));
        row.classList.add('requirements-nav-capability');
        const blocked = capability ? capability.blockerIds.length > 0 : /Open blocker:/i.test(node.Description ?? '');
        if (blocked) row.dataset.blocked = 'true';
        if (capability) {
          row.dataset.evidenceState = capability.evidenceState;
          const state = capability.evidenceState === 'accepted' ? 'proof accepted'
            : capability.evidenceState === 'not-required' ? 'proof not required'
              : capability.evidenceState === 'missing' ? 'proof missing'
                : `proof ${capability.evidenceState}`;
          const status = el('em', 'requirements-nav-status', [blocked ? 'blocked' : '', state].filter(Boolean).join(' · '));
          row.querySelector('.graph-nav-item-copy')?.append(status);
        }
        return row;
      };

      meta.attributeContainers.forEach(attribute => {
        const ref = { kind: 'container', id: attribute.containerId } as ItemRef;
        const container = graph.getItem<OutlineContainer>(ref);
        if (!container) return;
        const sections = container.Sections ?? [];
        const entries = attribute.capabilityIds
          .map(id => {
            const node = graph.getNode(meta.capabilityNodes[id]);
            return { id, node, capability: meta.capabilities?.[id], sectionId: node ? container.ChildSections?.[refKey(nodeRef(node.id))] : undefined };
          })
          .filter((entry): entry is { id: string; node: GraphNode; capability: RequirementsCapabilityMap | undefined; sectionId: Id | undefined } => !!entry.node);
        const filteredEntries = entries.filter(entry => !entry.capability || requirementsCapabilityPasses(entry.capability, requirementsFilters));
        const matchingEntries = filteredEntries.filter(entry => matches(`${entry.id} ${entry.node.id} ${entry.node.Label.text} ${entry.node.Description ?? ''}`));
        const matchingSections = sections.filter(item => matches(`${item.id} ${item.title}`));
        const attributeMatches = matches(`${attribute.id} ${attribute.name} ${container.Label?.text ?? ''}`);
        if (requirementsFilterActive() && !filteredEntries.length) return;
        if (query.trim() && !attributeMatches && !matchingEntries.length && !matchingSections.length) return;

        const foldId = itemFoldId(ref, graph.id);
        const open = contexts.fold.isOpen(foldId);
        const section = el('section', `requirements-nav-attribute${open ? ' open' : ''}`);
        const head = el('div', 'requirements-nav-attribute-head');
        const fold = el('button', 'requirements-nav-fold', open ? '⊟' : '⊞');
        fold.type = 'button';
        fold.dataset.foldId = foldId;
        fold.setAttribute('aria-expanded', open ? 'true' : 'false');
        fold.setAttribute('aria-label', `${open ? 'Fold' : 'Open'} ${attribute.id} ${attribute.name}`);
        const releaseCount = filteredEntries.filter(entry => / · 0\.1$/.test(entry.node.Label.text)).length;
        const countDetail = requirementsFilterActive()
          ? `${filteredEntries.length}/${entries.length} shown · ${releaseCount} in 0.1`
          : `${entries.length} capabilities · ${releaseCount} in 0.1`;
        const choose = itemRow(
          graph,
          ref,
          `${attribute.id} · ${attribute.name}`,
          countDetail,
        );
        choose.classList.add('requirements-nav-attribute-open');
        head.append(fold, choose);
        section.append(head);

        if (open || query.trim()) {
          const sectionGroups = el('div', 'requirements-nav-sections');
          sections.forEach(item => {
            const sectionEntries = filteredEntries.filter(entry => entry.sectionId === item.id);
            const matchingChildren = sectionEntries.filter(entry => matches(`${entry.id} ${entry.node.id} ${entry.node.Label.text} ${entry.node.Description ?? ''}`));
            const sectionMatches = matches(`${item.id} ${item.title}`);
            if (requirementsFilterActive() && !sectionEntries.length) return;
            if (query.trim() && !sectionMatches && !matchingChildren.length) return;
            const block = el('section', 'requirements-nav-component');
            const jump = sectionRow(graph, container, item, `${sectionEntries.length} ${sectionEntries.length === 1 ? 'Capability' : 'Capabilities'}`);
            jump.classList.add('requirements-nav-section');
            block.append(jump);
            const visibleEntries = query.trim() ? matchingChildren : sectionEntries;
            if (visibleEntries.length) {
              const capabilities = el('div', 'requirements-nav-capabilities');
              visibleEntries.forEach(({ node, capability }) => capabilities.append(requirementRow(graph, node, capability)));
              block.append(capabilities);
            }
            sectionGroups.append(block);
          });
          const looseEntries = (query.trim() ? matchingEntries : filteredEntries)
            .filter(entry => !entry.sectionId || !sections.some(item => item.id === entry.sectionId));
          if (looseEntries.length) {
            const capabilities = el('div', 'requirements-nav-capabilities');
            looseEntries.forEach(({ node, capability }) => capabilities.append(requirementRow(graph, node, capability)));
            sectionGroups.append(capabilities);
          }
          if (sectionGroups.childElementCount) section.append(sectionGroups);
        }
        group.append(section);
      });

      if (!group.querySelector('.requirements-nav-attribute, .requirements-nav-overview') && (query.trim() || requirementsFilterActive())) {
        const empty = el('button', 'empty empty-action graph-nav-empty', query.trim()
          ? 'No requirement text matches this search and filter combination'
          : 'No Capabilities match these review filters');
        empty.type = 'button';
        empty.dataset.command = query.trim() ? 'outline.search.clear' : 'outline.requirements.filter.clear';
        group.append(empty);
      }
      return group;
    };

    const graphItems = (graph: Graph) => {
      const requirements = requirementsMapOf(graph);
      if (requirements) return requirementsItems(graph, requirements);
      const group = el('div', 'graph-nav-tree');
      const nodes = graph.nodes().filter(node => matches(`${node.Label.text} ${node.id} ${descriptiveText(node)}`));
      const edges = graph.edges().filter(edge => {
        const from = graph.getNode(edge.From)?.Label.text ?? edge.From;
        const to = graph.getNode(edge.To)?.Label.text ?? edge.To;
        return matches(`${edge.Label?.text ?? ''} ${from} ${to} ${edge.id} ${descriptiveText(edge)}`);
      });
      const allContainers = containersOf(graph);
      const containers = allContainers.filter(container => matches(`${container.Label?.text ?? ''} ${container.id}`));
      const sectionResults = allContainers
        .flatMap(container => (container.Sections ?? []).map(section => ({ container, section })))
        .filter(({ container, section }) => matches(`${section.id} ${section.title} ${container.Label?.text ?? ''} ${container.id}`));
      const section = <T>(title: string, items: T[], row: (item: T) => HTMLElement) => {
        if (!items.length && query.trim()) return;
        const wrap = el('section', 'graph-nav-kind');
        const heading = el('div', 'graph-nav-kind-title');
        heading.append(el('span', undefined, title), el('b', undefined, `${items.length}`));
        wrap.append(heading);
        items.slice(0, 50).forEach(item => wrap.append(row(item)));
        group.append(wrap);
      };
      section('Nodes', nodes, node => itemRow(
        graph,
        nodeRef(node.id),
        node.Label.text || 'Untitled node',
        node.Description?.trim() || nodeTypeLabel(node.NodeType),
      ));
      section('Connections', edges, edge => {
        const from = graph.getNode(edge.From)?.Label.text ?? edge.From;
        const to = graph.getNode(edge.To)?.Label.text ?? edge.To;
        const label = edge.Label?.text?.trim();
        return itemRow(graph, edgeRef(edge.id), label || `${from} → ${to}`, label ? `${from} → ${to}` : 'Connection');
      });
      section('Containers', containers, container => itemRow(
        graph,
        { kind: 'container', id: container.id },
        container.Label?.text?.trim() || 'Untitled container',
        container.Sections?.length ? container.Sections.map(item => item.title).join(' · ') : 'Container',
      ));
      section('Sections', sectionResults, ({ container, section: item }) => sectionRow(graph, container, item));
      if (!nodes.length && !edges.length && !containers.length && !sectionResults.length) {
        const empty = el('button', 'empty empty-action graph-nav-empty', query
          ? `No matching items in “${graphName(graph)}”`
          : 'Add the first node');
        empty.type = 'button';
        empty.dataset.command = query ? 'outline.search.clear' : 'editing.node.create';
        group.append(empty);
      }
      return group;
    };

    const graphCard = (graph: Graph) => {
      const active = graph.id === graphs.current.id;
      const hasMatch = matches(`${graphName(graph)} ${graph.id}`)
        || graph.nodes().some(node => matches(`${node.Label.text} ${node.id} ${descriptiveText(node)}`))
        || graph.edges().some(edge => matches(`${edge.Label?.text ?? ''} ${edge.id} ${descriptiveText(edge)}`))
        || containersOf(graph).some(container => matches(
          `${container.Label?.text ?? ''} ${container.id} ${container.Sections?.map(section => section.title).join(' ') ?? ''}`,
        ));
      if (!hasMatch) return null;
      const open = query.trim() ? true : contexts.fold.isOpen(graphFoldId(graph.id), active);
      const card = el('article', `graph-nav-card${active ? ' active' : ''}`);
      card.dataset.graphId = graph.id;
      const head = el('div', 'graph-nav-card-head');
      const fold = el('button', 'graph-nav-fold', open ? '⊟' : '⊞');
      fold.type = 'button';
      fold.dataset.foldId = graphFoldId(graph.id);
      fold.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${graphName(graph)}`);
      const choose = el('button', 'graph-nav-choose');
      choose.type = 'button';
      choose.dataset.command = 'graph.switch';
      choose.dataset.itemId = graph.id;
      choose.append(el('strong', undefined, graphName(graph)), el('small', undefined, graphMeta(graph)));
      head.append(fold, choose);
      const duplicate = el('button', 'graph-nav-duplicate', '⧉');
      duplicate.type = 'button';
      duplicate.dataset.command = 'graph.duplicate';
      duplicate.dataset.itemId = graph.id;
      duplicate.setAttribute('aria-label', `Duplicate ${graphName(graph)}`);
      head.append(duplicate);
      if (graphs.all().length > 1) {
        const remove = el('button', 'graph-nav-delete', '×');
        remove.type = 'button';
        remove.dataset.command = 'graph.delete';
        remove.dataset.itemId = graph.id;
        remove.setAttribute('aria-label', `Delete ${graphName(graph)}`);
        head.append(remove);
      }
      card.append(head);
      if (open) card.append(graphItems(graph));
      return card;
    };

    const renderOutline = () => {
      const collapsed = contexts.fold.folded(PANEL_FOLD_ID);
      const wrapper = el('aside', 'outline-panel graph-navigator');
      wrapper.dataset.outlineFolded = collapsed ? 'true' : 'false';
      const head = el('div', 'outline-panel-head');
      const fold = el('button', 'graph-navigator-toggle', collapsed ? 'Graphs' : '×');
      fold.type = 'button';
      fold.dataset.foldId = PANEL_FOLD_ID;
      fold.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      fold.setAttribute('aria-label', collapsed ? 'Expand graph navigator' : 'Collapse graph navigator');
      const title = el('input', 'graph-navigator-title') as HTMLInputElement;
      title.type = 'text';
      title.value = graphName(graphs.current);
      title.dataset.command = 'graph.rename.input';
      title.dataset.graphTitle = '';
      title.dataset.graphId = graphs.current.id;
      title.setAttribute('aria-label', 'Current graph name');
      title.setAttribute('title', graphName(graphs.current));
      if (collapsed) title.setAttribute('title', `${graphName(graphs.current)} — click Graphs to browse documents`);
      title.spellcheck = false;
      head.append(fold, title);
      wrapper.append(head);
      if (collapsed) return wrapper;

      const body = el('div', 'outline-panel-body');
      const searchRow = el('div', 'graph-nav-search-row');
      const search = el('input', 'graph-nav-search') as HTMLInputElement;
      search.type = 'search';
      search.placeholder = 'Search graphs and items';
      search.value = query;
      search.dataset.graphNavSearch = '';
      search.setAttribute('aria-label', 'Filter graph navigator');
      const create = el('button', 'graph-nav-create', 'New graph');
      create.type = 'button';
      create.dataset.command = 'graph.create';
      const duplicateCurrent = el('button', 'graph-nav-duplicate-current', 'Duplicate');
      duplicateCurrent.type = 'button';
      duplicateCurrent.dataset.command = 'graph.duplicate';
      duplicateCurrent.dataset.itemId = graphs.current.id;
      searchRow.append(search, create, duplicateCurrent);
      if (graphs.all().length > 1) {
        const deleteCurrent = el('button', 'graph-nav-delete-current', 'Delete');
        deleteCurrent.type = 'button';
        deleteCurrent.dataset.command = 'graph.delete';
        deleteCurrent.dataset.itemId = graphs.current.id;
        deleteCurrent.setAttribute('aria-label', `Delete ${graphName(graphs.current)}`);
        searchRow.append(deleteCurrent);
      }
      const list = el('div', 'graph-nav-list');
      const current = el('section', 'graph-nav-current');
      current.append(graphItems(graphs.current));
      list.append(current);
      [...graphs.all()].reverse().filter(graph => graph.id !== graphs.current.id).forEach(graph => {
        const card = graphCard(graph);
        if (card) list.append(card);
      });
      if (!list.querySelector('.graph-nav-item, .graph-nav-card') && query.trim()) {
        const clear = el('button', 'empty empty-action graph-nav-empty', 'No graphs match this filter');
        clear.type = 'button';
        clear.dataset.command = 'outline.search.clear';
        current.replaceChildren(clear);
      }
      body.append(searchRow, list);
      wrapper.append(body);
      return wrapper;
    };

    const draw = () => emit('render.view.set', { place: Places.Left, key: 'outline', view: renderOutline });
    const offCancellation = contexts.cancellation.register({
      origin,
      priority: -5,
      background: false,
      active: () => contexts.fold.isOpen(PANEL_FOLD_ID),
      cancel: () => contexts.fold.set(PANEL_FOLD_ID, false),
    });
    const publishRequirementsReview = () => emit('requirements.review.changed', {
      filters: { ...requirementsFilters },
      query,
    });
    contexts.commands.register([
      {
        id: 'outline.search.change', label: 'Filter graph navigator', group: 'outline', hidden: true,
        event: 'outline.search.changed',
        input: { on: 'input', selector: '[data-graph-nav-search]' },
        payload: ({ target }) => ({ query: (target as HTMLInputElement).value }),
      },
      { id: 'outline.search.clear', label: 'Clear graph filter', group: 'outline', hidden: true },
      {
        id: 'outline.requirements.filter.change',
        label: 'Filter requirements review',
        group: 'outline',
        hidden: true,
        event: 'outline.requirements.filter.changed',
        input: { on: 'change', selector: '[data-requirements-filter]' },
        payload: ({ target }) => ({
          key: (target as HTMLSelectElement).dataset.requirementsFilter as RequirementsFilterKey,
          value: (target as HTMLSelectElement).value,
        }),
      },
      { id: 'outline.requirements.filter.clear', label: 'Clear requirements filters', group: 'outline', hidden: true },
      {
        id: 'outline.section.open', label: 'Open container section', group: 'outline', hidden: true,
        payload: ({ target }) => {
          const row = (target as HTMLElement).closest<HTMLElement>('[data-section-id][data-container-id]');
          return row ? {
            graphId: row.closest('[data-graph-id]')?.getAttribute('data-graph-id') ?? graphs.current.id,
            containerId: row.dataset.containerId ?? '',
            sectionId: row.dataset.sectionId ?? '',
          } : undefined;
        },
      },
      {
        id: 'outline.item.open', label: 'Open graph item', group: 'outline', hidden: true,
        payload: ({ target }) => ({
          graphId: (target as HTMLElement).closest('[data-graph-id]')?.getAttribute('data-graph-id') ?? graphs.current.id,
          ref: {
            kind: (target as HTMLElement).closest('[data-item-kind]')?.getAttribute('data-item-kind') as ItemRef['kind'],
            id: (target as HTMLElement).closest('[data-item-id]')?.getAttribute('data-item-id') ?? '',
          },
        }),
      },
    ]);
    on('outline.search.changed', ({ query: next }) => {
      query = next;
      draw();
      publishRequirementsReview();
      queueMicrotask(() => {
        const input = contexts.places.el(Places.Left)?.querySelector<HTMLInputElement>('[data-graph-nav-search]');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    });
    on('outline.search.clear', () => { query = ''; draw(); publishRequirementsReview(); });
    on('outline.requirements.filter.changed', ({ key, value }) => {
      if (!(['scope', 'readiness', 'attribute', 'component'] as string[]).includes(key)) return;
      requirementsFilters = { ...requirementsFilters, [key]: value };
      const meta = requirementsMapOf(graphs.current);
      if (key === 'attribute' && value !== 'all' && meta) {
        const attribute = meta.attributeContainers.find(candidate => candidate.id === value);
        if (attribute) {
          const id = itemFoldId({ kind: 'container', id: attribute.containerId }, graphs.current.id);
          if (!contexts.fold.isOpen(id)) contexts.fold.set(id, true);
        }
      }
      draw();
      publishRequirementsReview();
      if (meta?.capabilities && requirementsFilters.attribute !== 'all') {
        const attribute = meta.attributeContainers.find(candidate => candidate.id === requirementsFilters.attribute);
        const first = attribute?.capabilityIds.find(id => {
          const capability = meta.capabilities?.[id];
          if (!capability || !requirementsCapabilityPasses(capability, requirementsFilters)) return false;
          if (!query.trim()) return true;
          const node = graphs.current.getNode(capability.nodeId);
          return `${id} ${node?.Label.text ?? ''} ${node?.Description ?? ''}`
            .toLowerCase().includes(query.trim().toLowerCase());
        });
        const nodeId = first ? meta.capabilityNodes[first] : undefined;
        if (nodeId) frameLoop.schedule('outline.requirements.filter.focus', () => emit('view.fit.item', nodeRef(nodeId)), 60);
      }
      queueMicrotask(() => {
        contexts.places.el(Places.Left)
          ?.querySelector<HTMLSelectElement>(`[data-requirements-filter="${key}"]`)
          ?.focus();
      });
    });
    on('outline.requirements.filter.clear', () => {
      requirementsFilters = emptyRequirementsFilters();
      draw();
      publishRequirementsReview();
    });
    const revealRef = (ref: ItemRef) => {
      const reveal = [
        ...contexts.hierarchy.parentChain(ref),
        ...(ref.kind === 'container' ? [ref] : []),
      ];
      reveal.forEach(ancestor => {
        const id = itemFoldId(ancestor, graphs.current.id);
        if (!contexts.fold.isOpen(id)) contexts.fold.set(id, true);
      });
    };
    on('outline.item.open', ({ graphId, ref }) => {
      if (!ref.id || !ref.kind) return;
      if (graphs.current.id !== graphId) emit('graph.switch', { id: graphId });
      // A navigator result must be visible when it is opened. Reveal its full
      // ancestor path first; generated requirements maps then enforce their
      // one-Attribute-at-a-time reading policy through fold.changed.
      revealRef(ref);
      emit('selection.item.select', ref);
      frameLoop.schedule('outline.open.item', () => emit('view.fit.item', ref), 45);
    });
    on('outline.section.open', ({ graphId, containerId, sectionId }) => {
      if (!containerId || !sectionId) return;
      if (graphs.current.id !== graphId) emit('graph.switch', { id: graphId });
      const ref = { kind: 'container', id: containerId } as ItemRef;
      revealRef(ref);
      emit('selection.item.select', ref);
      // Section fitting intentionally runs after the container's unfold/layout
      // camera task and aligns the requested band to the top reading edge.
      frameLoop.schedule('outline.open.section', () => emit('view.fit.section', { containerId, sectionId }), 50);
    });
    on('app.start', () => {
      // Canvas-first default. Preserve an explicit user choice, but keep a
      // first visit focused on the document instead of opening a file tree
      // over it. The graph name and the Graphs affordance remain visible.
      const foldState = contexts.fold.all();
      const compact = globalThis.innerWidth <= 680
        || globalThis.matchMedia?.('(pointer: coarse)').matches === true;
      if (compact && contexts.fold.isOpen(PANEL_FOLD_ID)) {
        // A persisted desktop-open navigator must not cover a phone canvas on
        // reload. Users can still expand it from the compact document chip.
        contexts.fold.set(PANEL_FOLD_ID, false);
      } else if (!Object.prototype.hasOwnProperty.call(foldState, PANEL_FOLD_ID)) {
        contexts.fold.set(PANEL_FOLD_ID, false);
      }
      draw();
    });
    on('outline.draw', draw);
    on('graph.switched', () => {
      requirementsFilters = emptyRequirementsFilters();
      draw();
      publishRequirementsReview();
    });
    on('fold.changed', ({ id }) => {
      if (id.startsWith('outline.') || (requirementsMapOf(graphs.current) && id.startsWith(`fold:${graphs.current.id}:`))) draw();
    });
    return offCancellation;
  }, { requires: ['render', 'graph'] });
}
