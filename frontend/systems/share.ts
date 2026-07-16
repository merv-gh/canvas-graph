import type { Registry } from '../core';
import type { GraphSnapshot } from '../model';

declare module '../types' {
  interface CustomEvents {
    /** Copy a share link (`?g=`) for the current graph to the clipboard. */
    'graph.share.copy': void;
    'graph.share.clipboard': { url: string };
    'graph.shared': { url: string };
    /** Import a mermaid flowchart from a string (raw source, a mermaid.live
     *  link, or an http(s) URL) — the paste/`?in=` entry point. */
    'graph.import.mermaid': { source: string };
    'graph.import.confirm': void;
    'graph.import.cancel': void;
    /** Read the clipboard and import it as mermaid (palette action). */
    'graph.import.paste': void;
    /** Preview Mermaid entered in the import dialog. */
    'graph.import.submit': { source: string };
  }
}

// ---------------------------------------------------------------------------
// base64url <-> bytes
// ---------------------------------------------------------------------------
const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

// ---------------------------------------------------------------------------
// DEFLATE via the platform stream codecs (browser + Node ≥18). Async, but the
// share/import entry points are already async (clipboard / fetch), so no cost.
// ---------------------------------------------------------------------------
const streamBytes = async (bytes: Uint8Array, transform: 'deflate-raw' | 'deflate' | 'gzip', mode: 'compress' | 'decompress') => {
  // Feed via the stream's own writer/reader (no Blob/Response) so it works
  // identically in the browser and in the jsdom test env.
  const Ctor = mode === 'compress' ? CompressionStream : DecompressionStream;
  const stream = new Ctor(transform);
  const writer = stream.writable.getWriter();
  void writer.write(bytes as BufferSource);
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
};
const deflate = (bytes: Uint8Array) => streamBytes(bytes, 'deflate-raw', 'compress');
const inflateRaw = (bytes: Uint8Array) => streamBytes(bytes, 'deflate-raw', 'decompress');
const inflateZlib = (bytes: Uint8Array) => streamBytes(bytes, 'deflate', 'decompress');

// ---------------------------------------------------------------------------
// Compact array form — one array per node/edge, no field names, so the JSON is
// small before compression (matters for big graphs in a URL).
//   node: [id, title, type, x, y, w, h, description?]
//   edge: [id, from, to, kind?, label?]
// ---------------------------------------------------------------------------
type CompactNode = [string, string, string, number, number, number, number, string?];
type CompactEdge = [string, string, string, string?, string?];
type LegacyCompactGraph = { v: 3; n: CompactNode[]; e: CompactEdge[] };
type CompactGraph = LegacyCompactGraph | { v: 4; s: GraphSnapshot };

// v4 compresses the complete versioned document. Deflate removes repeated
// field names while preserving every semantic field and entity extension.
const toCompact = (snapshot: GraphSnapshot): CompactGraph => ({ v: 4, s: snapshot });
const fromLegacyCompact = (compact: LegacyCompactGraph): GraphSnapshot => ({
  nodes: compact.n.map(([id, title, NodeType, x, y, w, h, Description]) => ({
    id,
    Label: { text: title },
    NodeType: NodeType as GraphSnapshot['nodes'][number]['NodeType'],
    Position: { x, y },
    Size: { w, h },
    ...(Description ? { Description } : {}),
  })),
  edges: compact.e.map(([id, From, To, EdgeKind, label]) => ({
    id,
    From,
    To,
    ...(EdgeKind ? { EdgeKind: EdgeKind as GraphSnapshot['edges'][number]['EdgeKind'] } : {}),
    ...(label ? { Label: { text: label } } : {}),
  })),
});

/** Compressed graph payload for `?g=`. Prefixed with `~` so the decoder can tell
 *  it apart from the legacy uncompressed base64-JSON form (backward compatible). */
export const encodeGraph = async (snapshot: GraphSnapshot): Promise<string> => {
  const json = new TextEncoder().encode(JSON.stringify(toCompact(snapshot)));
  return '~' + bytesToBase64Url(await deflate(json));
};
export const decodeGraph = async (encoded: string): Promise<GraphSnapshot | null> => {
  try {
    const unpack = (raw: CompactGraph): GraphSnapshot | null => {
      if (raw.v === 4) return Array.isArray(raw.s?.nodes) && Array.isArray(raw.s?.edges) ? raw.s : null;
      return Array.isArray(raw.n) && Array.isArray(raw.e) ? fromLegacyCompact(raw) : null;
    };
    if (encoded.startsWith('~')) {
      const bytes = await inflateRaw(base64UrlToBytes(encoded.slice(1)));
      return unpack(JSON.parse(new TextDecoder().decode(bytes)) as CompactGraph);
    }
    // Legacy: base64url(JSON) — either the new compact shape or the old
    // Legacy compact shape (both carry {n,e}). Read the fields we understand.
    const raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as CompactGraph;
    return unpack(raw);
  } catch {
    return null;
  }
};

const jsonToSnapshot = (source: string): GraphSnapshot | null => {
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const candidate = record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : record;
    const snapshot = candidate as Partial<GraphSnapshot>;
    if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return null;
    if (!snapshot.nodes.every(node => !!node && typeof node === 'object' && typeof node.id === 'string')) return null;
    if (!snapshot.edges.every(edge => !!edge && typeof edge === 'object' && typeof edge.id === 'string')) return null;
    return snapshot as GraphSnapshot;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// mermaid.live link -> mermaid source. The editor stores `pako:` + base64 of
// zlib(JSON), where JSON.code is the diagram text. Also tolerates `base64:`.
// ---------------------------------------------------------------------------
const mermaidLivePayload = (link: string): { kind: 'pako' | 'base64'; data: string } | null => {
  const hash = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link;
  const m = /(pako|base64):([A-Za-z0-9\-_+/=]+)/.exec(hash);
  return m ? { kind: m[1] as 'pako' | 'base64', data: m[2] } : null;
};
const decodeMermaidLive = async (link: string): Promise<string | null> => {
  const payload = mermaidLivePayload(link);
  if (!payload) return null;
  try {
    const bytes = base64UrlToBytes(payload.data);
    const json = payload.kind === 'pako'
      ? new TextDecoder().decode(await inflateZlib(bytes))
      : new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as { code?: string };
    return typeof parsed.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// mermaid flowchart -> GraphSnapshot. Handles mermaid.live output: quoted
// markdown-string node labels (`id("`…`")`), plain shapes (`A[x]`, `A(x)`,
// `A{x}`), edge chains with `-->`/`---`/`-.->`/`==>` and either label style
// (`A -- "l" --> B` or `A -->|l| B`). Not a full mermaid engine — a pragmatic
// flowchart reader.
// ---------------------------------------------------------------------------
const HTML_ENTITIES: Record<string, string> = {
  '&gt;': '>', '&lt;': '<', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '#quot;': '"',
};
const cleanLabel = (raw: string) => {
  let s = raw.trim().replace(/^`+|`+$/g, '').trim();
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(h[1-6]|p|li|ul|ol|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '');
  s = s.replace(/&#\d+;|#quot;|&[a-z]+;/gi, m => HTML_ENTITIES[m.toLowerCase()] ?? HTML_ENTITIES[m] ?? m);
  return s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
};
const splitLabel = (raw: string) => {
  const text = cleanLabel(raw);
  const lines = text.split('\n');
  return { title: lines[0] ?? '', description: lines.slice(1).join('\n') || undefined };
};

const SHAPE_CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}', '>': ']' };
type Parsed = { id: string; label?: string; end: number };
const IDENT = /[A-Za-z0-9_.-]/;

const parseNode = (s: string, start: number): Parsed | null => {
  let i = start;
  while (i < s.length && /\s/.test(s[i])) i++;
  const idStart = i;
  while (i < s.length && IDENT.test(s[i])) i++;
  if (i === idStart) return null;
  const id = s.slice(idStart, i);
  const open = s[i];
  if (open && SHAPE_CLOSE[open]) {
    // read matched shape content, respecting `"` quotes and nested openers
    const close = SHAPE_CLOSE[open];
    let depth = 0, inQuote = false, j = i;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (ch === '"') inQuote = !inQuote;
      else if (!inQuote && (ch === open || (open === '(' && ch === '('))) depth++;
      else if (!inQuote && ch === close) { depth--; if (depth === 0) { j++; break; } }
    }
    const inner = s.slice(i, j).replace(/^[[({>]+/, '').replace(/[\])}]+$/, '').replace(/^"|"$/g, '');
    return { id, label: inner, end: j };
  }
  return { id, end: i };
};

const LINK = /^\s*(?:--+\s*(?:"((?:[^"]|\n)*?)"|([^|>\n]*?))\s*)?(<--+>|--+>|--+|-\.-+>|-\.-+|==+>|==+|--[xo])\s*(?:\|\s*(?:"((?:[^"]|\n)*?)"|([^|]*))\s*\|)?/;

type MermaidNode = { id: string; label?: string };
type MermaidEdge = { from: string; to: string; label?: string };

const parseMermaid = (source: string): { nodes: MermaidNode[]; edges: MermaidEdge[]; invalid: boolean } => {
  // Strip frontmatter (--- … ---) and split into statements, keeping quoted
  // multi-line labels intact (newlines inside `"` don't end a statement).
  let src = source.replace(/^﻿/, '');
  src = src.replace(/^\s*---[\s\S]*?---\s*/, '');
  const statements: string[] = [];
  let depth = 0, inQuote = false, buf = '';
  for (const ch of src) {
    if (ch === '"') { inQuote = !inQuote; buf += ch; continue; }
    if (!inQuote) {
      if (ch === '[' || ch === '(' || ch === '{') depth++;
      else if (ch === ']' || ch === ')' || ch === '}') depth = Math.max(0, depth - 1);
      if ((ch === '\n' || ch === ';') && depth === 0) { statements.push(buf); buf = ''; continue; }
    }
    buf += ch;
  }
  statements.push(buf);

  const SKIP = /^\s*(flowchart|graph|sequenceDiagram|subgraph|end\b|classDef|class\s|style\s|linkStyle|click\s|direction\s|%%|title:|accTitle|accDescr)/;
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  let invalid = false;
  const note = (id: string, label?: string) => {
    const existing = nodes.get(id);
    if (!existing) nodes.set(id, { id, label });
    else if (label && !existing.label) existing.label = label;
  };

  for (const stmt of statements) {
    const line = stmt.trim();
    if (!line || SKIP.test(line)) continue;
    let cur = parseNode(stmt, 0);
    if (!cur) { invalid = true; continue; }
    note(cur.id, cur.label);
    let cursor = cur.end;
    while (cursor < stmt.length) {
      const rest = stmt.slice(cursor);
      const link = LINK.exec(rest);
      if (!link) { if (rest.trim()) invalid = true; break; }
      const next = parseNode(stmt, cursor + link[0].length);
      if (!next) { invalid = true; break; }
      note(next.id, next.label);
      // Groups: 1 dash-quote label, 2 dash bare label, 3 arrow, 4 pipe-quote, 5 pipe bare.
      const label = link[1] ?? link[2] ?? link[4] ?? link[5];
      edges.push({ from: cur.id, to: next.id, label: label?.trim() || undefined });
      cur = next;
      cursor = next.end;
    }
  }
  return { nodes: [...nodes.values()], edges, invalid };
};

/** mermaid text (or link) -> snapshot with a simple grid layout so it lands
 *  laid-out; caller fits + tidies. Returns null when nothing parseable. */
export const mermaidToSnapshot = async (input: string): Promise<GraphSnapshot | null> => {
  const source = mermaidLivePayload(input) ? await decodeMermaidLive(input) : input;
  if (!source) return null;
  const { nodes, edges, invalid } = parseMermaid(source);
  if (!nodes.length || invalid) return null;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const CW = 300, CH = 200;
  const snapshot: GraphSnapshot = {
    nodes: nodes.map((node, i) => {
      const { title, description } = splitLabel(node.label ?? node.id);
      return {
        id: node.id,
        Label: { text: title || node.id },
        NodeType: 'text',
        Position: { x: (i % cols) * CW, y: Math.floor(i / cols) * CH },
        Size: { w: 220, h: 120 },
        ...(description ? { Description: description } : {}),
      };
    }),
    edges: edges.map((edge, i) => ({
      id: `m-e-${i}`,
      From: edge.from,
      To: edge.to,
      // Explicit kind so the store doesn't default EdgeKind to the label text.
      EdgeKind: 'sync' as const,
      ...(edge.label ? { Label: { text: cleanLabel(edge.label) } } : {}),
    })),
  };
  return snapshot;
};

const looksLikeMermaid = (text: string) =>
  /(^|\n)\s*(flowchart|graph\s+(TD|TB|BT|LR|RL))/i.test(text) ||
  !!mermaidLivePayload(text) ||
  (/-->|---|-\.->|==>/.test(text) && /[A-Za-z0-9_]/.test(text));

export const SHARE_URL_LIMIT = 7500;
export const shareUrlTooLarge = (url: string) => url.length > SHARE_URL_LIMIT;

export function registerShare(system: Registry) {
  system('share', ({ on, emit, contexts, graphs, contribute }) => {
    let pendingImport: { snapshot: GraphSnapshot; format: 'JSON' | 'Mermaid'; tidy: boolean } | null = null;
    contexts.commands.register([
      { id: 'graph.share.copy', label: 'Share current graph', group: 'graph' },
      {
        id: 'graph.share.clipboard', label: 'Copy share link', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-share-copy]' },
        payload: ({ target }) => ({
          url: (target?.closest('.share-link-panel')?.querySelector('[data-share-url]') as HTMLInputElement | null)?.value ?? '',
        }),
      },
      { id: 'graph.import.paste', label: 'Import graph from clipboard', group: 'graph' },
      {
        id: 'graph.import.submit', label: 'Preview Mermaid import', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-submit]' },
        payload: ({ target }) => ({
          source: (target?.closest('.import-source')?.querySelector('[data-import-source]') as HTMLTextAreaElement | null)?.value ?? '',
        }),
      },
      {
        id: 'graph.import.confirm', label: 'Replace graph with import', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-confirm]' },
      },
      {
        id: 'graph.import.cancel', label: 'Cancel graph import', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-cancel]' },
      },
      {
        id: 'graph.import.mermaid.paste-event',
        label: 'Import pasted mermaid graph',
        event: 'graph.import.mermaid',
        group: 'graph',
        hidden: true,
        input: {
          on: 'paste',
          global: true,
          prevent: true,
          when: event => {
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) return false;
            const text = (event as ClipboardEvent).clipboardData?.getData('text') ?? '';
            return !!text && looksLikeMermaid(text);
          },
        },
        payload: ({ event }) => ({ source: (event as ClipboardEvent).clipboardData?.getData('text') ?? '' }),
      },
    ]);

    // `?g=` carries real positions → keep them. Mermaid has none → tidy first.
    const importSnapshot = (snapshot: GraphSnapshot, tidy = false) => {
      emit('graph.import.snapshot', snapshot);
      if (tidy) emit('layout.apply.tidy');
      emit('view.fit.all');
    };

    const shareBody = (url: string) => () => {
      const panel = document.createElement('section');
      panel.className = 'share-link-panel';
      const tooLarge = shareUrlTooLarge(url);
      const intro = document.createElement('p');
      intro.textContent = tooLarge
        ? 'This snapshot is too large for a reliable browser link. Export a file instead.'
        : 'Portable snapshot link. Anyone with this URL can open an editable copy; changes do not sync back.';
      if (tooLarge) {
        intro.className = 'share-size-warning';
        panel.dataset.shareTooLarge = '';
      }
      const field = document.createElement('div');
      field.className = 'share-link-field';
      const input = document.createElement('input');
      input.readOnly = true;
      input.value = url;
      input.dataset.shareUrl = '';
      input.setAttribute('aria-label', 'Share link');
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'primary share-copy';
      copy.dataset.shareCopy = '';
      copy.dataset.command = 'graph.share.clipboard';
      copy.setAttribute('aria-label', 'Copy share link');
      copy.textContent = '⧉ Copy';
      copy.disabled = tooLarge;
      field.append(input, copy);
      const meta = document.createElement('small');
      meta.className = 'share-size';
      meta.textContent = `${url.length.toLocaleString()} characters · graph data is embedded in the URL`;
      panel.append(intro, field, meta);
      if (tooLarge) {
        const fallback = document.createElement('button');
        fallback.type = 'button';
        fallback.className = 'primary';
        fallback.dataset.command = 'graph.export.json';
        fallback.textContent = 'Export a file instead';
        panel.append(fallback);
      }
      return panel;
    };

    const importPreviewBody = (snapshot: GraphSnapshot, format: 'JSON' | 'Mermaid') => () => {
      const panel = document.createElement('section');
      panel.className = 'import-preview';
      const summary = document.createElement('p');
      const nodes = `${snapshot.nodes.length} node${snapshot.nodes.length === 1 ? '' : 's'}`;
      const edges = `${snapshot.edges.length} edge${snapshot.edges.length === 1 ? '' : 's'}`;
      summary.textContent = `${format}: ${nodes} and ${edges} are ready to import.`;
      const warning = document.createElement('p');
      warning.className = 'import-warning';
      warning.textContent = 'This replaces the current graph. You can undo after importing.';
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.command = 'graph.import.cancel';
      cancel.dataset.importCancel = '';
      cancel.textContent = 'Keep current graph';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary import-confirm';
      confirm.dataset.command = 'graph.import.confirm';
      confirm.dataset.importConfirm = '';
      confirm.textContent = 'Replace graph';
      actions.append(cancel, confirm);
      panel.append(summary, warning, actions);
      return panel;
    };

    const importSourceBody = (source = '') => () => {
      const panel = document.createElement('section');
      panel.className = 'import-source';
      const intro = document.createElement('p');
      intro.textContent = 'Paste Canvas Graph JSON, Mermaid flowchart source, or a mermaid.live link. You will review changes before replacement.';
      const textarea = document.createElement('textarea');
      textarea.dataset.importSource = '';
      textarea.setAttribute('aria-label', 'Graph JSON or Mermaid source');
      textarea.placeholder = 'Paste exported JSON or: flowchart LR\n  A[Draft] --> B[Published]';
      textarea.value = source;
      textarea.autofocus = true;
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'primary import-confirm';
      preview.dataset.command = 'graph.import.submit';
      preview.dataset.importSubmit = '';
      preview.textContent = 'Preview import';
      actions.append(preview);
      panel.append(intro, textarea, actions);
      return panel;
    };

    on('graph.share.copy', () => {
      void (async () => {
        const encoded = await encodeGraph(graphs.current.snapshot());
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.delete('in');
        url.searchParams.set('g', encoded);
        emit('graph.shared', { url: url.toString() });
        emit('modal.open', { title: 'Share graph', visual: 'properties', body: shareBody(url.toString()) });
      })();
    });
    on('graph.share.clipboard', ({ url }) => {
      if (!url) return;
      void navigator.clipboard?.writeText?.(url).then(
        () => emit('app.notice', { message: 'Share link copied.' }),
        () => emit('app.notice', { message: 'Select the link and copy it manually.', level: 'warn' }),
      );
    });

    on('graph.import.mermaid', ({ source }) => {
      void (async () => {
        const snapshot = await mermaidToSnapshot(source);
        if (!snapshot) {
          emit('app.notice', { message: 'Mermaid has incomplete or unsupported syntax. Nothing was changed.', level: 'warn' });
          return;
        }
        pendingImport = { snapshot, format: 'Mermaid', tidy: true };
        emit('modal.open', { title: 'Review Mermaid import', visual: 'properties', body: importPreviewBody(snapshot, 'Mermaid') });
      })();
    });
    on('graph.import.submit', ({ source }) => {
      if (!source.trim()) {
        emit('app.notice', { message: 'Paste graph JSON or Mermaid before previewing.', level: 'warn' });
        return;
      }
      if (source.trimStart().startsWith('{')) {
        const snapshot = jsonToSnapshot(source);
        if (!snapshot) {
          emit('app.notice', { message: 'JSON is not a valid Canvas Graph export. Nothing was changed.', level: 'warn' });
          return;
        }
        pendingImport = { snapshot, format: 'JSON', tidy: false };
        emit('modal.open', { title: 'Review JSON import', visual: 'properties', body: importPreviewBody(snapshot, 'JSON') });
        return;
      }
      emit('graph.import.mermaid', { source });
    });
    on('graph.import.confirm', () => {
      const pending = pendingImport;
      if (!pending) return;
      pendingImport = null;
      importSnapshot(pending.snapshot, pending.tidy);
      emit('modal.close');
      emit('app.notice', { message: `Imported ${pending.snapshot.nodes.length} nodes from ${pending.format}.` });
    });
    on('graph.import.cancel', () => { pendingImport = null; emit('modal.close'); });
    on('modal.closed', () => { pendingImport = null; });

    on('graph.import.paste', () => {
      // Open immediately: clipboard permission prompts may stay pending until
      // user interaction. The manual path must never wait behind that promise.
      emit('modal.open', { title: 'Import graph', visual: 'properties', body: importSourceBody() });
      const read = navigator.clipboard?.readText?.();
      if (read) void read.then(text => {
        if (!text) return;
        const textarea = contexts.places.el('modal')?.querySelector<HTMLTextAreaElement>('[data-import-source]');
        if (textarea && !textarea.value) textarea.value = text;
      }).catch(() => undefined);
    });

    const bootFromUrl = () => {
      const params = new URLSearchParams(location.search);
      const g = params.get('g');
      const incoming = params.get('in');
      if (g) {
        void decodeGraph(g).then(snapshot => {
          if (snapshot) importSnapshot(snapshot);
          else emit('app.notice', { message: 'Share link graph could not be decoded.', level: 'warn' });
        });
        return;
      }
      if (incoming) emit('graph.import.mermaid', { source: incoming });
    };

    on('app.start', bootFromUrl);
    contribute({ surface: 'top', command: 'graph.import.paste', kind: 'button', text: 'Import', order: 23, group: 'file' });
    contribute({ surface: 'top', command: 'graph.share.copy', kind: 'button', text: 'Share', order: 24, group: 'file' });
  }, { requires: ['graph', 'modal'] });
}
