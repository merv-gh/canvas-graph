import type { AppCtx } from '../core';
import { Places } from '../types';

type GraphExportDependencies = {
  contexts: AppCtx['contexts'];
  graphs: AppCtx['graphs'];
};

export const createGraphExport = ({ contexts, graphs }: GraphExportDependencies) => {
    const exportBody = (json: string) => () => {
      const panel = document.createElement('section');
      panel.className = 'export-json';
      const intro = document.createElement('p');
      intro.textContent = 'Export an editable graph file or an image of the current canvas view.';
      const actions = document.createElement('div');
      actions.className = 'export-actions';
      const option = (label: string, command: string, detail: string, primary = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = command;
        button.className = `export-option${primary ? ' primary' : ''}`;
        const strong = document.createElement('strong');
        strong.textContent = label;
        const small = document.createElement('small');
        small.textContent = detail;
        button.append(strong, small);
        return button;
      };
      actions.append(
        option('Canvas Graph JSON', 'graph.export.file.json', 'Editable backup', true),
        option('SVG', 'graph.export.svg', 'Current view · vector'),
        option('PNG', 'graph.export.png', 'Current view · 2×'),
      );
      const raw = document.createElement('details');
      raw.className = 'export-raw';
      const summary = document.createElement('summary');
      summary.textContent = 'View raw JSON';
      const textarea = document.createElement('textarea');
      textarea.readOnly = true;
      textarea.value = json;
      textarea.setAttribute('aria-label', 'Exported graph JSON');
      raw.append(summary, textarea);
      panel.append(intro, actions, raw);
      return panel;
    };

    const safeName = () => (graphs.current.name || 'canvas-graph')
      .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'canvas-graph';
    const download = (blob: Blob, extension: string) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeName()}.${extension}`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Keep the object URL alive long enough for WebKit and embedded browsers
      // to begin consuming it after the synthetic anchor click.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const currentViewSvg = () => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const clone = stage.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.tool-panel, .item-overlays, .item-toolbar, .picker-prompt')
        .forEach(element => element.remove());
      clone.removeAttribute('data-place');
      clone.style.width = `${width}px`;
      clone.style.height = `${height}px`;
      clone.style.position = 'relative';
      clone.style.overflow = 'hidden';
      const css = [...document.styleSheets].flatMap(sheet => {
        try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; }
      }).join('\n');
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      wrapper.className = 'shell';
      const theme = stage.closest('.shell')?.getAttribute('data-theme');
      if (theme) wrapper.setAttribute('data-theme', theme);
      const style = document.createElement('style');
      style.textContent = css;
      wrapper.append(style, clone);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      foreign.setAttribute('width', '100%');
      foreign.setAttribute('height', '100%');
      foreign.append(wrapper);
      svg.append(foreign);
      return { source: new XMLSerializer().serializeToString(svg), width, height };
    };
    const currentViewPng = () => new Promise<Blob | null>(resolve => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) { resolve(null); return; }
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');
      if (!context) { resolve(null); return; }
      context.scale(2, 2);
      const styles = getComputedStyle(stage);
      const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      const bg = color('--bg', '#f5f5f5');
      const panel = color('--panel', '#fbfbfb');
      const ink = color('--ink', '#242424');
      const muted = color('--text-muted', '#6e6e6e');
      const line = color('--line-strong', '#aeaeae');
      const accent = color('--accent', '#424242');
      const edgeColor = color('--edge', '#787878');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);
      context.fillStyle = color('--line', '#dedede');
      for (let x = 0; x < width; x += 32) for (let y = 0; y < height; y += 32) context.fillRect(x, y, 1, 1);
      const view = contexts.view.get();
      const screen = (point: { x: number; y: number }) => ({
        x: (point.x - view.x) * view.scale,
        y: (point.y - view.y) * view.scale,
      });
      const snapshot = graphs.current.snapshot();
      const containers = (snapshot.extensions?.containers ?? []) as Array<{
        Label?: { text?: string }; Position?: { x: number; y: number }; Size?: { w: number; h: number };
      }>;
      containers.forEach(container => {
        if (!container.Position || !container.Size) return;
        const center = screen(container.Position);
        const w = container.Size.w * view.scale, h = container.Size.h * view.scale;
        context.fillStyle = accent;
        context.globalAlpha = 0.06;
        context.strokeStyle = accent;
        context.setLineDash([5, 4]);
        context.fillRect(center.x - w / 2, center.y - h / 2, w, h);
        context.globalAlpha = 1;
        context.strokeRect(center.x - w / 2, center.y - h / 2, w, h);
        context.setLineDash([]);
        context.fillStyle = ink;
        context.font = '700 10px monospace';
        context.fillText(container.Label?.text ?? 'Container', center.x - w / 2 + 8, center.y - h / 2 + 15);
      });
      const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
      context.strokeStyle = edgeColor;
      context.fillStyle = edgeColor;
      context.lineWidth = 2;
      snapshot.edges.forEach(edge => {
        const from = nodes.get(edge.From), to = nodes.get(edge.To);
        if (!from?.Position || !to?.Position) return;
        const a = screen(from.Position), b = screen(to.Position);
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        context.beginPath(); context.moveTo(b.x, b.y);
        context.lineTo(b.x - 10 * Math.cos(angle - Math.PI / 6), b.y - 10 * Math.sin(angle - Math.PI / 6));
        context.lineTo(b.x - 10 * Math.cos(angle + Math.PI / 6), b.y - 10 * Math.sin(angle + Math.PI / 6));
        context.closePath(); context.fill();
        if (edge.Label?.text) {
          context.fillStyle = muted; context.font = '10px monospace';
          context.fillText(edge.Label.text, (a.x + b.x) / 2 + 5, (a.y + b.y) / 2 - 6);
          context.fillStyle = edgeColor;
        }
      });
      snapshot.nodes.forEach(node => {
        if (!node.Position) return;
        const center = screen(node.Position);
        const w = (node.Size?.w ?? 200) * view.scale, h = (node.Size?.h ?? 80) * view.scale;
        context.fillStyle = panel; context.strokeStyle = line; context.lineWidth = 1.5;
        context.beginPath();
        if (node.NodeType === 'circle') context.ellipse(center.x, center.y, w / 2, h / 2, 0, 0, Math.PI * 2);
        else context.rect(center.x - w / 2, center.y - h / 2, w, h);
        context.fill(); context.stroke();
        context.fillStyle = ink; context.textAlign = 'center';
        context.font = `700 ${Math.max(9, Math.round(14 * view.scale))}px sans-serif`;
        context.fillText(node.Label?.text ?? node.id, center.x, center.y - (node.Description ? 4 : -4), Math.max(20, w - 14));
        if (node.Description && h >= 38) {
          context.fillStyle = muted;
          context.font = `${Math.max(7, Math.round(10 * view.scale))}px sans-serif`;
          context.fillText(node.Description, center.x, center.y + 13, Math.max(20, w - 14));
        }
        context.textAlign = 'start';
      });
      canvas.toBlob(resolve, 'image/png');
    });
    return { currentViewPng, currentViewSvg, download, exportBody };
};

