import { clamp, semanticTitle } from '../core';
import { collapsible, configurable, draggable, editable, nudgeable, selectable } from '../abilities';
import { renderMarkdown } from '../core/markdown';
import { Slots } from '../types';
import type { EntityDef, EntityRenderer, Rect, Size } from '../types';
import type { Graph, GraphNode, NodePatch } from './graph';
import { isNodeType, NODE_TYPES, nodeTypeBorder, nodeTypeFill, nodeTypeLabel } from './node-types';
import { DESC_PLACEMENTS, NODE_COLORS, NODE_FILLS, entityDef, isDescPlacement, isNodeColor, isNodeFill, property } from './entity-options';

const typeLabel = nodeTypeLabel;

export const nodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  return { x: pos.x - node.Size.w / 2, y: pos.y - node.Size.h / 2, w: node.Size.w, h: node.Size.h };
};

// Fold is presentation state, not graph data. Keep the expanded model Size and
// cache only the currently rendered title-only geometry for edge anchors,
// culling, Fit, and the floating toolbar.
const renderedNodeSizes = new WeakMap<GraphNode, Size>();
const collapsedNodeSize = (node: GraphNode): Size => {
  const explicitLines = Math.max(1, node.Label.text.split(/\r?\n/).length);
  const capacity = Math.max(8, Math.floor((node.Size.w - 24) / 7.2));
  const wrappedLines = node.Label.text.split(/\r?\n/)
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / capacity)), 0);
  return { w: node.Size.w, h: clamp(Math.max(explicitLines, wrappedLines) * 22 + 20, 56, 120) };
};
const renderedNodeBoundsOf = (node: GraphNode): Rect => {
  const pos = node.Position ?? { x: 0, y: 0 };
  const size = renderedNodeSizes.get(node) ?? node.Size;
  return { x: pos.x - size.w / 2, y: pos.y - size.h / 2, w: size.w, h: size.h };
};

const nodeRenderer: EntityRenderer<GraphNode> = {
  layer: 'html',
  bounds: renderedNodeBoundsOf,
  collect(graph, hiddenByFold, visibleNodeIds) {
    const g = graph as unknown as Graph;
    const all = visibleNodeIds
      ? [...visibleNodeIds].map(id => g.node(id)).filter((n): n is GraphNode => !!n)
      : g.nodes();
    return all.filter(n => !hiddenByFold({ kind: 'node', id: n.id }));
  },
  draw(node, ctx) {
    const el = ctx.cloneTemplate<HTMLElement>('node');
    const pos = node.Position ?? { x: 0, y: 0 };
    const ref = ctx.refOf(node.id);
    const nodeType = node.NodeType ?? 'text';
    const nodeTypeDef = ctx.nodeType(nodeType);
    const nodeVisual = nodeTypeDef?.visual ?? 'card';
    const description = node.Description?.trim() ?? '';
    const meta = [
      node.ExpectedRps != null ? `${node.ExpectedRps}/s` : '',
      node.LatencyMs != null ? `${node.LatencyMs}ms` : '',
      node.ComputeMs != null ? `${node.ComputeMs}ms cpu` : '',
    ].filter(Boolean).join(' · ');
    ctx.tagItem(el, ref);
    el.tabIndex = -1;
    // The whole card is the drag surface (see abilities/draggable.ts). Text
    // selection, buttons, and the inline editors opt out via DRAG_BLOCKERS.
    el.dataset.slot = Slots.Drag;
    el.setAttribute('role', nodeVisual === 'switch' ? 'group' : 'button');
    const editHint = globalThis.innerWidth <= 680 ? 'Hold for actions.' : 'Press Enter to edit.';
    el.setAttribute('aria-label', `${node.Label.text || 'Untitled'}; ${typeLabel(nodeType)} node. ${editHint}`);
    ctx.applyItemModes(el, ref);
    const collapsed = !!description && ctx.isFolded(ref);
    const renderedSize = collapsed ? collapsedNodeSize(node) : node.Size;
    renderedNodeSizes.set(node, renderedSize);
    el.classList.toggle('collapsed', collapsed);
    el.classList.add(`node-type-${nodeType}`);
    el.classList.add(`node-visual-${nodeVisual}`);
    el.classList.toggle('has-description', !!description);
    if (description) el.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    el.classList.toggle('semantic-big-data', node.DataScale === 'big' || node.DataScale === 'huge');
    el.classList.toggle('semantic-stale-risk', node.FreshnessMs != null && node.FreshnessMs > 60_000);
    el.dataset.nodeType = nodeType;
    el.dataset.nodeVisual = nodeVisual;
    if (nodeVisual === 'switch') {
      el.dataset.toggleState = node.ToggleState ? 'on' : 'off';
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'node-switch-control';
      control.dataset.command = 'node.toggle.state';
      control.setAttribute('role', 'switch');
      control.setAttribute('aria-checked', node.ToggleState ? 'true' : 'false');
      control.setAttribute('aria-label', `${node.ToggleState ? 'Turn off' : 'Turn on'} ${node.Label.text || 'switch'}`);
      control.append(document.createElement('span'));
      el.append(control);
    }
    if (node.Color) el.dataset.nodeColor = node.Color;
    // Fill + border are data-driven so any type (built-in or future
    // user-defined) styles without its own CSS. Absent → the type's own look.
    const effectiveFill = nodeTypeFill(nodeType, node.Fill);
    const effectiveBorder = nodeTypeBorder(nodeType, node.BorderColor);
    if (effectiveFill) el.dataset.fill = effectiveFill;
    if (effectiveBorder) el.dataset.borderColor = effectiveBorder;
    if (node.DescriptionPlacement) el.dataset.descPlacement = node.DescriptionPlacement;
    if (node.DataScale) el.dataset.dataScale = node.DataScale;
    const titleText = semanticTitle(node);
    if (titleText) el.title = titleText;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${renderedSize.w}px`;
    el.style.height = `${renderedSize.h}px`;
    ctx.templateText(el, 'type', nodeTypeDef?.label ?? typeLabel(nodeType));
    ctx.templateText(el, 'metrics', meta);
    ctx.templateText(el, 'title', node.Label.text);
    const descriptionEl = ctx.templateSlot(el, 'description');
    descriptionEl.setAttribute('data-editable-description', '');
    descriptionEl.setAttribute('aria-label', description ? 'Description. Double-click to edit.' : 'Empty description. Press Shift+Enter to edit.');
    descriptionEl.replaceChildren(renderMarkdown(description));
    ctx.wireAffordances(el);
    return el;
  },
  /** Drag / nudge only changes where the node sits — move the existing element
   *  (keeps its identity so CSS can ease the move; no rebuild). */
  reposition(el, node) {
    const pos = node.Position ?? { x: 0, y: 0 };
    (el as HTMLElement).style.left = `${pos.x}px`;
    (el as HTMLElement).style.top = `${pos.y}px`;
  },
  /** Everything the drawn node depends on *except* position, as one integer:
   *  Graph.updateNode bumps `visualVersion` on any non-Position change, so an
   *  unchanged version ⇒ the stage takes the cheap `reposition` path. */
  signature(node) {
    return `v${node.visualVersion}`;
  },
};

export const nodeEntity: EntityDef<GraphNode, NodePatch> = entityDef<GraphNode, NodePatch>('node', {
  label: 'Node',
  labelOf: node => node.Label.text,
  render: nodeRenderer,
  abilities: [
    selectable<GraphNode>(),
    draggable<GraphNode>(),
    nudgeable<GraphNode>(),
    collapsible<GraphNode>(node => !!node.Description?.trim()),
    editable<GraphNode>(),
    configurable<GraphNode>(),
  ],
  properties: [
    property<GraphNode, NodePatch>({
      id: 'title', label: 'Title', input: 'text',
      value: node => node.Label.text,
      patch: (_node, value) => ({ Label: { text: String(value) } }),
    }),
    property<GraphNode, NodePatch>({
      id: 'nodeType', label: 'Type', input: 'select', options: NODE_TYPES,
      value: node => node.NodeType ?? 'text',
      patch: (_node, value) => isNodeType(value) ? { NodeType: value } : undefined,
    }),
    property<GraphNode, NodePatch>({
      id: 'color', label: 'Color', input: 'swatches',
      options: [{ value: '', label: 'Default (by type)' }, ...NODE_COLORS],
      value: node => node.Color ?? '',
      patch: (_node, value) => value === '' ? { Color: undefined } : isNodeColor(value) ? { Color: value } : undefined,
    }),
    property<GraphNode, NodePatch>({
      id: 'fill', label: 'Fill', input: 'segments', options: NODE_FILLS,
      value: node => nodeTypeFill(node.NodeType, node.Fill) ?? 'soft',
      patch: (_node, value) => isNodeFill(value) ? { Fill: value } : undefined,
    }),
    property<GraphNode, NodePatch>({
      id: 'borderColor', label: 'Border', input: 'swatches',
      options: [{ value: '', label: 'Match color' }, { value: 'none', label: 'None' }, ...NODE_COLORS],
      value: node => nodeTypeBorder(node.NodeType, node.BorderColor) ?? '',
      patch: (_node, value) =>
        value === '' ? { BorderColor: undefined }
          : value === 'none' ? { BorderColor: 'none' }
          : isNodeColor(value) ? { BorderColor: value } : undefined,
    }),
    property<GraphNode, NodePatch>({
      id: 'description', label: 'Description', input: 'textarea', rows: 6, placeholder: 'Description', hideLabel: true,
      value: node => node.Description ?? '',
      patch: (_node, value) => ({ Description: String(value) }),
    }),
    property<GraphNode, NodePatch>({
      id: 'descPlacement', label: 'Description placement', input: 'placement',
      options: DESC_PLACEMENTS,
      value: node => node.DescriptionPlacement ?? 'inside',
      patch: (_node, value) =>
        value === 'inside' ? { DescriptionPlacement: undefined }
          : isDescPlacement(value) ? { DescriptionPlacement: value } : undefined,
    }),
    property<GraphNode, NodePatch>({
      id: 'width', label: 'Width', input: 'number', min: 96, step: 8,
      value: node => node.Size.w,
      patch: (node, value) => {
        const width = Number(value);
        return Number.isFinite(width) ? { Size: { ...node.Size, w: clamp(width, 96, 900) } } : undefined;
      },
    }),
    property<GraphNode, NodePatch>({
      id: 'height', label: 'Height', input: 'number', min: 40, step: 8,
      value: node => node.Size.h,
      patch: (node, value) => {
        const height = Number(value);
        return Number.isFinite(height) ? { Size: { ...node.Size, h: clamp(height, 40, 900) } } : undefined;
      },
    }),
    // Collapse is fold state (presentation), not a node property — toggle it with
    // the fold chevron / item.collapse.toggle, not the properties modal.
  ],
});
