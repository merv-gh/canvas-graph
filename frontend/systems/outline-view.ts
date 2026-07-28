import { edgeRef, iconNode, itemFoldId, nodeRef, refKey, tagItem, type AppCtx } from '../core';
import {
  requirementsCapabilityPasses,
  requirementsFiltersActive,
  requirementsMapOf,
  type RequirementsCapabilityMap,
  type RequirementsFilterKey,
  type RequirementsMapMetadata,
  type RequirementsReviewFilters,
} from '../requirements-map';
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

type OutlineSectionResult = {
  container: OutlineContainer;
  section: NonNullable<OutlineContainer['Sections']>[number];
};

const PANEL_FOLD_ID = 'outline.panel';
const graphName = (graph: Graph) => graph.name;

type OutlineViewDependencies = {
  contexts: AppCtx['contexts'];
  graphs: AppCtx['graphs'];
  mobileSheet: () => boolean;
  query: string;
  requirementsFilters: RequirementsReviewFilters;
};

export const createOutlineView = ({
  contexts,
  graphs,
  mobileSheet,
  query,
  requirementsFilters,
}: OutlineViewDependencies) => {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const matches = (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());
    const containersOf = (graph: Graph) => graph.itemsOfKind<OutlineContainer>('container');
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
        fold.dataset.command = 'fold.toggle';
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
      const endpointLabel = (id: Id) => {
        const ref = graph.refById(id);
        return (ref ? graph.getItem<{ Label?: { text?: string } }>(ref)?.Label?.text : undefined) ?? id;
      };
      const nodes = graph.nodes().filter(node => matches(`${node.Label.text} ${node.id} ${descriptiveText(node)}`));
      const edges = graph.edges().filter(edge => {
        const from = endpointLabel(edge.From);
        const to = endpointLabel(edge.To);
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
        const from = endpointLabel(edge.From);
        const to = endpointLabel(edge.To);
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
      if (!matches(`${graphName(graph)} ${graph.id}`)) return null;
      const card = el('article', `graph-nav-card${active ? ' active' : ''}`);
      card.dataset.graphId = graph.id;
      const head = el('div', 'graph-nav-card-head');
      const choose = el('button', 'graph-nav-choose');
      choose.type = 'button';
      choose.dataset.itemId = graph.id;
      if (active) choose.disabled = true;
      else choose.dataset.command = 'graph.switch';
      choose.setAttribute('aria-current', active ? 'page' : 'false');
      choose.append(
        el('span', 'graph-nav-name', graphName(graph)),
        el('small', undefined, active ? 'Current graph' : 'Open graph'),
      );
      head.append(choose);
      if (graphs.all().length > 1) {
        const remove = el('button', 'graph-nav-delete', '×');
        remove.type = 'button';
        remove.dataset.command = 'graph.delete';
        remove.dataset.itemId = graph.id;
        remove.setAttribute('aria-label', `Delete ${graphName(graph)}`);
        head.append(remove);
      }
      card.append(head);
      return card;
    };

    const renderOutline = () => {
      const collapsed = contexts.fold.folded(PANEL_FOLD_ID);
      const wrapper = el('aside', 'outline-panel graph-navigator');
      wrapper.dataset.outlineFolded = collapsed ? 'true' : 'false';
      if (!collapsed && mobileSheet()) {
        wrapper.setAttribute('role', 'dialog');
        wrapper.setAttribute('aria-modal', 'true');
        wrapper.setAttribute('aria-label', 'Graph navigator');
        const scrim = el('button', 'graph-navigator-scrim');
        scrim.type = 'button';
        scrim.dataset.command = 'fold.toggle';
        scrim.dataset.foldId = PANEL_FOLD_ID;
        scrim.setAttribute('aria-label', 'Close graph navigator');
        wrapper.append(scrim);
      }
      const head = el('div', 'outline-panel-head');
      const fold = el('button', 'graph-navigator-toggle');
      fold.append(iconNode('menu'));
      fold.type = 'button';
      // Click commands dispatch synchronously. Without an explicit command this
      // control depended on coalesced generic input and could appear inert in
      // background/browser tabs.
      fold.dataset.command = 'fold.toggle';
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
      if (collapsed) title.setAttribute('title', `${graphName(graphs.current)} — open workspace drawer`);
      title.spellcheck = false;
      head.append(fold, title);
      wrapper.append(head);
      if (collapsed) return wrapper;

      const body = el('div', 'outline-panel-body');
      const searchRow = el('div', 'graph-nav-search-row workspace-search-row');
      const search = el('input', 'graph-nav-search') as HTMLInputElement;
      search.type = 'search';
      search.placeholder = 'Search graphs';
      search.value = query;
      search.dataset.graphNavSearch = '';
      search.setAttribute('aria-label', 'Search graphs');
      const create = el('button', 'graph-nav-create', '+');
      create.type = 'button';
      create.dataset.command = 'graph.create';
      create.setAttribute('aria-label', 'New graph');
      create.title = 'New graph';
      searchRow.append(search, create);
      body.append(searchRow);
      const list = el('div', 'graph-nav-list');
      list.setAttribute('aria-label', 'Graphs');
      [graphs.current, ...[...graphs.all()].reverse().filter(graph => graph.id !== graphs.current.id)].forEach(graph => {
        const card = graphCard(graph);
        if (card) list.append(card);
      });
      if (!list.querySelector('.graph-nav-card') && query.trim()) {
        const clear = el('button', 'empty empty-action graph-nav-empty', 'No graphs match this filter');
        clear.type = 'button';
        clear.dataset.command = 'outline.search.clear';
        list.append(clear);
      }
      body.append(list);
      // Requirements review commands still use the outline's addressable item
      // model. Keep that engine outside the visible and accessibility trees;
      // the drawer itself remains graph-only.
      const itemModel = el('section', 'graph-nav-current graph-nav-item-model');
      itemModel.hidden = true;
      itemModel.append(graphItems(graphs.current));
      body.append(itemModel);
      wrapper.append(body);
      return wrapper;
    };
    return { renderOutline };
};

