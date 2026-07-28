import { setIcon, type AppCtx } from '../core';
import {
  BUILTIN_NODE_TYPES,
  EDGE_KINDS,
  NODE_COLORS,
  NODE_FILLS,
  nodeTypeBorder,
  nodeTypeDefinition,
  nodeTypeFill,
  nodeTypeLabel,
  type GraphEdge,
  type GraphNode,
  type NodeColor,
} from '../model';
import { Places } from '../types';
import type { ContainerType } from './container-entity';
import {
  catalogRefKey,
  sameVisualEntry,
  typeLabel,
  type CatalogItem,
  type CatalogRef,
  type PaletteArm,
} from './palette-catalog';
import { allPresets, typeEntriesFor, type PresetId, type PresetTypeEntry } from './presets';

const SWATCH_CLASS: Record<NodeColor, string> = {
  gray: 'gray', red: 'red', orange: 'orange', yellow: 'yellow',
  green: 'green', blue: 'blue', purple: 'purple', pink: 'pink',
};

const button = (command: string, label: string, text = '') => {
  const el = document.createElement('button');
  el.type = 'button';
  el.dataset.command = command;
  el.setAttribute('aria-label', label);
  el.title = label;
  el.textContent = text;
  return el;
};

const block = (title: string) => {
  const el = document.createElement('section');
  el.className = 'palette-block';
  const heading = document.createElement('h3');
  heading.textContent = title;
  el.append(heading);
  return el;
};

type PaletteViewState = {
  arm: PaletteArm;
  category: string;
  drawing: boolean;
  favorites: CatalogRef[];
  inkArm: { color: NodeColor; width: number; opacity: number };
  mobileOpen: boolean;
  placing: boolean;
  recent: CatalogRef[];
  search: string;
};

type PaletteViewDependencies = {
  contexts: AppCtx['contexts'];
  io: AppCtx['io'];
  presetId: () => PresetId;
  primaryContainer: () => { ContainerType?: ContainerType; Color?: NodeColor } | undefined;
  primaryEdge: () => GraphEdge | undefined;
  primaryNode: () => GraphNode | undefined;
  selectedEdges: () => readonly unknown[];
  state: PaletteViewState;
};

export const createPaletteView = ({
  contexts,
  io,
  presetId,
  primaryContainer,
  primaryEdge,
  primaryNode,
  selectedEdges,
  state,
}: PaletteViewDependencies) => {
  const { arm, category, drawing, favorites, inkArm, mobileOpen, placing, recent, search } = state;

    const pressed = (el: HTMLButtonElement, active: boolean) =>
      el.setAttribute('aria-pressed', active ? 'true' : 'false');

    const categoryTabs = () => {
      const wrap = document.createElement('div');
      wrap.className = 'palette-catalog-search';
      const categories = document.createElement('div');
      categories.className = 'palette-category-tabs';
      for (const name of ['All', 'Favorites', ...new Set(BUILTIN_NODE_TYPES.map(def => def.category))]) {
        const choice = button('palette.category.set', `Show ${name} node types`, name);
        choice.dataset.paletteCategory = name;
        pressed(choice, category === name);
        categories.append(choice);
      }
      wrap.append(categories);
      return wrap;
    };

    const matches = (entry: PresetTypeEntry, categoryName = '', keywords: string[] = []) => {
      const categoryMatch = category === 'All' || category === categoryName;
      const haystack = [typeLabel(entry), entry.value, categoryName, ...keywords].join(' ').toLocaleLowerCase();
      return categoryMatch && (!search || haystack.includes(search.toLocaleLowerCase()));
    };

    const entryTile = (
      entry: PresetTypeEntry,
      index: number,
      entries: PresetTypeEntry[],
      command = 'palette.arm.entry',
      entryPreset = presetId(),
      catalog = command !== 'palette.arm.entry',
    ) => {
        const tile = button(command, typeLabel(entry));
        tile.className = 'palette-tile';
        tile.dataset.paletteType = entry.value;
        tile.dataset.paletteEntity = entry.entity ?? 'node';
        tile.dataset.palettePreset = entryPreset;
        tile.dataset.paletteIndex = String(index);
        if (catalog) tile.dataset.paletteCatalog = '';
        if (entry.id) tile.dataset.paletteCustomType = entry.id;
        const preview = document.createElement('span');
        const visual = nodeTypeDefinition(entry.value)?.visual ?? entry.value;
        preview.className = `palette-tile-preview palette-shape-${visual}`;
        if (entry.entity === 'container') preview.classList.add('palette-container-preview');
        preview.dataset.nodeColor = entry.color ?? 'gray';
        preview.dataset.fill = entry.fill ?? 'none';
        preview.dataset.borderColor = entry.border ?? 'automatic';
        if (entry.value === 'operator') preview.textContent = '⊕';
        if (entry.value === 'caption' || entry.value === 'text') preview.textContent = 'T';
        const label = document.createElement('span');
        label.className = 'palette-tile-label';
        label.textContent = typeLabel(entry);
        tile.append(preview, label);
        const node = primaryNode();
        const container = primaryContainer();
        const shownType = node ? node.NodeType : arm.type;
        const shownColor = node ? node.Color : arm.color;
        const shownFill = node ? nodeTypeFill(node.NodeType, node.Fill) : arm.fill;
        const shownBorder = node ? nodeTypeBorder(node.NodeType, node.BorderColor) : arm.border;
        if (command !== 'palette.arm.entry') {
          pressed(tile, !container && shownType === entry.value);
          return tile;
        }
        const ambiguous = entries.some((candidate, candidateIndex) => candidateIndex !== index && sameVisualEntry(candidate, entry));
        const identityMatches = node ? !ambiguous || node.Label.text === typeLabel(entry) : arm.entryIndex === index;
        pressed(tile, container
          ? entry.entity === 'container' && container.ContainerType === entry.containerType && container.Color === entry.color
          : identityMatches && shownType === entry.value && shownColor === entry.color
            && shownFill === nodeTypeFill(entry.value, entry.fill)
            && shownBorder === nodeTypeBorder(entry.value, entry.border));
        return tile;
    };

    const catalogItems = (filtered = true) => {
      const items: CatalogItem[] = [];
      BUILTIN_NODE_TYPES.forEach(def => {
        const entry: PresetTypeEntry = { value: def.id, label: def.label };
        if (filtered && !matches(entry, def.category, def.keywords)) return;
        items.push({
          entry, index: -1, preset: 'none', category: def.category,
          keywords: def.keywords ?? [], command: `palette.arm.type.${def.id}`,
        });
      });
      allPresets(io).forEach(preset => typeEntriesFor(io, preset.id).forEach((entry, index) => {
        if (entry.id) return;
        const def = nodeTypeDefinition(entry.value);
        const semantic = entry.entity === 'container' || (!!entry.label && entry.label !== def?.label);
        if (!semantic) return;
        const categoryName = entry.entity === 'container' ? 'Architecture' : def?.category ?? 'Diagram';
        const keywords = [preset.label, ...(def?.keywords ?? [])];
        if (filtered && !matches(entry, categoryName, keywords)) return;
        items.push({ entry, index, preset: preset.id, category: categoryName, keywords, command: 'palette.arm.entry' });
      }));
      const seen = new Set<string>();
      return items.filter(({ entry }) => {
        const key = [typeLabel(entry), entry.value, entry.color, entry.fill, entry.border, entry.entity, entry.containerType].join('|');
        return !seen.has(key) && (seen.add(key), true);
      });
    };

    const refOf = (item: CatalogItem): CatalogRef => ({
      command: item.command, preset: item.preset, index: item.index, type: item.entry.value,
    });
    const catalogTile = (item: CatalogItem) => {
      const ref = refOf(item);
      const key = catalogRefKey(ref);
      const wrap = document.createElement('div');
      wrap.className = 'palette-catalog-tile-wrap';
      wrap.append(entryTile(
        item.entry, item.index, typeEntriesFor(io, item.preset), item.command, item.preset, true,
      ));
      const favorite = button(
        'palette.favorite.toggle',
        `${favorites.some(candidate => catalogRefKey(candidate) === key) ? 'Remove' : 'Add'} ${typeLabel(item.entry)} ${favorites.some(candidate => catalogRefKey(candidate) === key) ? 'from' : 'to'} favorites`,
      );
      setIcon(favorite, favorites.some(candidate => catalogRefKey(candidate) === key) ? 'star-filled' : 'star');
      favorite.className = 'palette-favorite';
      favorite.dataset.paletteFavorite = key;
      favorite.setAttribute('aria-pressed', favorites.some(candidate => catalogRefKey(candidate) === key) ? 'true' : 'false');
      wrap.append(favorite);
      return wrap;
    };

    const reuseBlock = (title: string, refs: CatalogRef[], className: string, empty: string) => {
      const section = block(title);
      section.classList.add(className);
      if (!refs.length) {
        const hint = document.createElement('p');
        hint.className = 'palette-reuse-empty';
        hint.textContent = empty;
        section.append(hint);
        return section;
      }
      const items = new Map(catalogItems(false).map(item => [catalogRefKey(refOf(item)), item]));
      const resolved = refs.flatMap(ref => items.get(catalogRefKey(ref)) ?? []);
      if (!resolved.length) {
        const hint = document.createElement('p');
        hint.className = 'palette-reuse-empty';
        hint.textContent = empty;
        section.append(hint);
        return section;
      }
      const grid = document.createElement('div');
      grid.className = 'palette-types';
      resolved.forEach(item => grid.append(catalogTile(item)));
      section.append(grid);
      return section;
    };

    const catalogBlock = () => {
      const section = document.createElement('section');
      section.classList.add('palette-catalog-block');
      const groups = new Map<string, CatalogItem[]>();
      catalogItems().forEach(item =>
        (groups.get(item.category) ?? groups.set(item.category, []).get(item.category)!).push(item));
      groups.forEach((items, name) => {
        const heading = document.createElement('h4'); heading.textContent = name;
        const grid = document.createElement('div'); grid.className = 'palette-types';
        items.forEach(item => grid.append(catalogTile(item)));
        section.append(heading, grid);
      });
      if (!groups.size) {
        const empty = document.createElement('p'); empty.className = 'palette-catalog-empty'; empty.textContent = 'No node types match.';
        section.append(empty);
      }
      return section;
    };

    const savedTypesBlock = () => {
      const section = block('Saved types');
      section.classList.add('palette-saved-block');
      const grid = document.createElement('div'); grid.className = 'palette-types';
      const savedPresets = [{ id: 'none' as PresetId }, ...allPresets(io)];
      savedPresets.forEach(preset => typeEntriesFor(io, preset.id).forEach((entry, index) => {
        const haystack = `${typeLabel(entry)} ${entry.value}`.toLowerCase();
        if (!entry.id || (search && !haystack.includes(search))) return;
        const entries = typeEntriesFor(io, preset.id);
        const tile = entryTile(entry, index, entries, 'palette.arm.entry', preset.id);
        const wrap = document.createElement('div');
        wrap.className = 'palette-tile-wrap palette-tile-wrap-custom';
        const controls = document.createElement('div');
        controls.className = 'palette-custom-actions';
        const rename = button('palette.custom-type.rename', `Rename ${typeLabel(entry)}`, '✎');
        const remove = button('palette.custom-type.delete.request', `Delete ${typeLabel(entry)}`, '×');
        [rename, remove].forEach(control => {
          control.dataset.customTypeId = entry.id!;
          control.dataset.customTypePreset = preset.id;
          control.dataset.customTypeLabel = typeLabel(entry);
        });
        remove.classList.add('danger');
        controls.append(rename, remove);
        wrap.append(tile, controls);
        grid.append(wrap);
      }));
      const create = button('palette.custom-type.create', 'Create a reusable palette type', '+ New type');
      create.className = 'palette-custom-type';
      if (grid.childElementCount) section.append(grid);
      section.append(create);
      return section;
    };

    const colorBlock = (title: string, kind: 'color' | 'border') => {
      const section = block(title);
      const row = document.createElement('div');
      row.className = 'palette-swatches';
      const node = primaryNode();
      const edge = primaryEdge();
      const container = primaryContainer();
      const current = kind === 'color'
        ? (node ? node.Color : edge ? edge.Color : container ? container.Color : arm.color)
        : (node ? nodeTypeBorder(node.NodeType, node.BorderColor) : arm.border);
      const auto = button(`palette.arm.${kind}.default`, `${title}: automatic`, 'A');
      auto.className = 'palette-swatch palette-swatch-auto';
      pressed(auto, current === undefined);
      row.append(auto);
      if (kind === 'border') {
        const none = button('palette.arm.border.none', 'Border: none', '⊘');
        none.className = 'palette-swatch palette-swatch-none';
        pressed(none, current === 'none');
        row.append(none);
      }
      for (const { value, label } of NODE_COLORS) {
        const swatch = button(`palette.arm.${kind}.${value}`, `${title}: ${label}`);
        swatch.className = `palette-swatch palette-swatch-${SWATCH_CLASS[value]}`;
        pressed(swatch, current === value);
        row.append(swatch);
      }
      section.append(row);
      return section;
    };

    const fillBlock = () => {
      const section = block('Fill');
      const row = document.createElement('div');
      row.className = 'palette-options';
      for (const { value, label } of NODE_FILLS) {
        const option = button(`palette.arm.fill.${value}`, `Fill: ${label}`, value);
        const node = primaryNode();
        pressed(option, (node ? nodeTypeFill(node.NodeType, node.Fill) : arm.fill) === value);
        row.append(option);
      }
      section.append(row);
      return section;
    };

    const creationBlock = () => {
      const section = block('Actions');
      section.classList.add('palette-creation-block');
      const row = document.createElement('div');
      row.className = 'palette-creation-actions';
      row.append(
        button('palette.place.activate', 'Create node', 'Node'),
        button('editing.container.create', 'Create container', 'Container'),
        button('palette.arm.type.text', 'Use the text tool', 'Text'),
      );
      section.append(row);
      return section;
    };

    const edgeBlock = () => {
      const section = block('Edge style');
      const row = document.createElement('div');
      row.className = 'palette-options palette-edge-kinds';
      const current = primaryEdge()?.EdgeKind;
      for (const { value, label } of EDGE_KINDS) {
        const option = button(`palette.edge.kind.${value}`, `Edge appearance: ${label}`, label);
        pressed(option, current === value);
        row.append(option);
      }
      section.append(row);
      return section;
    };

    const drawBody = () => {
      const wrap = document.createElement('div');
      wrap.className = 'palette-draw palette-style-controls';
      const note = document.createElement('p');
      note.textContent = 'Draw · drag canvas to annotate';
      wrap.append(note);
      const color = block('Stroke color');
      const colors = document.createElement('div');
      colors.className = 'palette-swatches';
      for (const { value, label } of NODE_COLORS) {
        const swatch = button(`ink.arm.color.${value}`, `Stroke color: ${label}`);
        swatch.className = `palette-swatch palette-swatch-${SWATCH_CLASS[value]}`;
        pressed(swatch, inkArm.color === value);
        colors.append(swatch);
      }
      color.append(colors);
      const width = block('Width');
      const widths = document.createElement('div');
      widths.className = 'palette-options';
      for (const value of [1.5, 3, 6]) {
        const option = button(`ink.arm.width.${String(value).replace('.', '-')}`, `Stroke width: ${value}`, `${value}`);
        pressed(option, inkArm.width === value);
        widths.append(option);
      }
      width.append(widths);
      const opacity = block('Opacity');
      const opacities = document.createElement('div');
      opacities.className = 'palette-options';
      for (const value of [0.25, 0.5, 0.75, 1]) {
        const option = button(`ink.arm.opacity.${Math.round(value * 100)}`, `Stroke opacity: ${Math.round(value * 100)}%`, `${Math.round(value * 100)}%`);
        pressed(option, inkArm.opacity === value);
        opacities.append(option);
      }
      opacity.append(opacities);
      wrap.append(color, width, opacity);
      return wrap;
    };

    const deleteTypeBody = (entry: PresetTypeEntry) => {
      const root = document.createElement('section');
      root.className = 'properties palette-delete-type';
      const warning = document.createElement('p');
      warning.textContent = `Delete “${typeLabel(entry)}” from this collection? Existing nodes will not change.`;
      const actions = document.createElement('div');
      actions.className = 'form-actions';
      const cancel = button('modal.close', 'Cancel custom type deletion', 'Cancel');
      const confirm = button('palette.custom-type.delete.confirm', `Delete ${typeLabel(entry)}`, 'Delete type');
      confirm.classList.add('danger');
      actions.append(cancel, confirm);
      root.append(warning, actions);
      return root;
    };

    const render = () => {
      const root = document.createElement('div');
      root.className = 'palette-panel';
      root.dataset.mobileOpen = mobileOpen ? 'true' : 'false';
      root.dataset.placing = placing ? 'true' : 'false';
      root.dataset.drawing = drawing ? 'true' : 'false';
      // The desktop drawer is display:none while folded. Avoid allocating the
      // full searchable catalog on every selection/render cycle until it can
      // actually be seen; fold.changed redraws it when the hamburger opens.
      if (globalThis.innerWidth > 700 && contexts.fold.folded('outline.panel')) return root;
      const toggle = button('palette.mobile.toggle', mobileOpen ? 'Close node palette' : 'Open node palette', mobileOpen ? 'Close' : 'Palette');
      toggle.className = 'palette-mobile-toggle';
      toggle.setAttribute('aria-expanded', mobileOpen ? 'true' : 'false');
      const scrim = button('palette.mobile.close', 'Close node palette');
      scrim.className = 'palette-scrim';
      const sheet = document.createElement('div');
      sheet.className = 'palette-sheet';
      if (globalThis.innerWidth <= 700) {
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Node catalog and drawing styles');
      }
      const close = button('palette.mobile.close', 'Close node palette', '×');
      close.className = 'palette-mobile-close';
      sheet.append(close);
      {
        const catalogOpen = contexts.fold.isOpen('palette.catalog');
        const catalogSection = document.createElement('section');
        catalogSection.className = 'workspace-drawer-section palette-workspace-section';
        const activeTypeLabel = nodeTypeLabel(primaryNode()?.NodeType ?? arm.type);
        const catalogToggle = button(
          'fold.toggle',
          `${catalogOpen ? 'Collapse' : 'Change'} node type`,
          `${catalogOpen ? '⌄' : '›'} Change type · ${activeTypeLabel}`,
        );
        catalogToggle.className = 'workspace-drawer-section-toggle';
        catalogToggle.dataset.foldId = 'palette.catalog';
        catalogToggle.setAttribute('aria-expanded', catalogOpen ? 'true' : 'false');
        catalogSection.append(catalogToggle);
        if (catalogOpen) {
          catalogSection.append(categoryTabs());
          const catalog = document.createElement('div');
          catalog.className = 'palette-catalog-region';
          catalog.dataset.nativeScroll = '';
          if (category === 'Favorites') {
            catalog.append(reuseBlock('Favorites', favorites, 'palette-favorites-block', 'Star a type to keep it here.'));
          } else {
            if (!search && category === 'All' && recent.length) catalog.append(
              reuseBlock('Recent', recent, 'palette-recent-block', ''),
            );
            catalog.append(catalogBlock());
          }
          catalogSection.append(catalog);
          const saved = savedTypesBlock();
          saved.classList.add('palette-saved-pinned');
          catalogSection.append(saved);
        }
        const styles = document.createElement('div');
        styles.className = 'palette-style-controls';
        styles.append(creationBlock(), colorBlock('Color', 'color'), fillBlock(), colorBlock('Border', 'border'));
        if (selectedEdges().length) styles.append(edgeBlock());
        sheet.append(catalogSection);
        if (drawing) sheet.append(drawBody());
        else sheet.append(styles);
      }
      root.append(toggle, scrim, sheet);
      return root;
    };
    return { catalogItems, deleteTypeBody, refOf, render };
};

