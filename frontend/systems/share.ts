import type { Registry } from '../core';
import type { GraphSnapshot } from '../model';

declare module '../types' {
  interface CustomEvents {
    /** Copy a share link (`?g=`) for the current graph to the clipboard. */
    'graph.share.copy': void;
    'graph.shared': { url: string };
    /** Import a mermaid flowchart from a string (raw source, a mermaid.live
     *  link, or an http(s) URL) — the paste/`?in=` entry point. */
    'graph.import.mermaid': { source: string };
    /** Read the clipboard and import it as mermaid (palette action). */
    'graph.import.paste': void;
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
type CompactGraph = { v: 3; n: CompactNode[]; e: CompactEdge[] };

const toCompact = (snapshot: GraphSnapshot): CompactGraph => ({
  v: 3,
  n: snapshot.nodes.map(node => [
    node.id,
    node.Label?.text ?? node.id,
    node.NodeType ?? 'text',
    Math.round(node.Position?.x ?? 0),
    Math.round(node.Position?.y ?? 0),
    Math.round(node.Size?.w ?? 200),
    Math.round(node.Size?.h ?? 120),
    node.Description || undefined,
  ] as CompactNode),
  e: snapshot.edges.map(edge => [
    edge.id,
    edge.From,
    edge.To,
    edge.EdgeKind || undefined,
    edge.Label?.text || undefined,
  ] as CompactEdge),
});
const fromCompact = (compact: CompactGraph): GraphSnapshot => ({
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
    if (encoded.startsWith('~')) {
      const bytes = await inflateRaw(base64UrlToBytes(encoded.slice(1)));
      return fromCompact(JSON.parse(new TextDecoder().decode(bytes)) as CompactGraph);
    }
    // Legacy: base64url(JSON) — either the new compact shape or the old
    // system-design shape (both carry {n,e}). Read the fields we understand.
    const raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as CompactGraph;
    if (!Array.isArray(raw.n) || !Array.isArray(raw.e)) return null;
    return fromCompact(raw);
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

const parseMermaid = (source: string): { nodes: MermaidNode[]; edges: MermaidEdge[] } => {
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
  const note = (id: string, label?: string) => {
    const existing = nodes.get(id);
    if (!existing) nodes.set(id, { id, label });
    else if (label && !existing.label) existing.label = label;
  };

  for (const stmt of statements) {
    const line = stmt.trim();
    if (!line || SKIP.test(line)) continue;
    let cur = parseNode(stmt, 0);
    if (!cur) continue;
    note(cur.id, cur.label);
    let cursor = cur.end;
    let matched = false;
    while (cursor < stmt.length) {
      const rest = stmt.slice(cursor);
      const link = LINK.exec(rest);
      if (!link) break;
      const next = parseNode(stmt, cursor + link[0].length);
      if (!next) break;
      note(next.id, next.label);
      // Groups: 1 dash-quote label, 2 dash bare label, 3 arrow, 4 pipe-quote, 5 pipe bare.
      const label = link[1] ?? link[2] ?? link[4] ?? link[5];
      edges.push({ from: cur.id, to: next.id, label: label?.trim() || undefined });
      cur = next;
      cursor = next.end;
      matched = true;
    }
    void matched;
  }
  return { nodes: [...nodes.values()], edges };
};

/** mermaid text (or link) -> snapshot with a simple grid layout so it lands
 *  laid-out; caller fits + tidies. Returns null when nothing parseable. */
export const mermaidToSnapshot = async (input: string): Promise<GraphSnapshot | null> => {
  const source = mermaidLivePayload(input) ? await decodeMermaidLive(input) : input;
  if (!source) return null;
  const { nodes, edges } = parseMermaid(source);
  if (!nodes.length) return null;
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

export function registerShare(system: Registry) {
  system('share', ({ on, emit, contexts, graphs }) => {
    contexts.commands.register([
      { id: 'graph.share.copy', label: 'Copy share link', group: 'graph' },
      { id: 'graph.import.paste', label: 'Import graph from clipboard', group: 'graph' },
    ]);

    // `?g=` carries real positions → keep them. Mermaid has none → tidy first.
    const importSnapshot = (snapshot: GraphSnapshot, tidy = false) => {
      emit('graph.import.snapshot', snapshot);
      if (tidy) emit('layout.apply.tidy');
      emit('view.fit.all');
    };

    on('graph.share.copy', () => {
      void (async () => {
        const encoded = await encodeGraph(graphs.current.snapshot());
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.delete('in');
        url.searchParams.set('g', encoded);
        await navigator.clipboard?.writeText?.(url.toString()).catch(() => {});
        emit('graph.shared', { url: url.toString() });
        emit('app.notice', { message: 'Share link copied.' });
      })();
    });

    on('graph.import.mermaid', ({ source }) => {
      void (async () => {
        const snapshot = await mermaidToSnapshot(source);
        if (!snapshot) { emit('app.notice', { message: 'Could not read a mermaid graph from that.', level: 'warn' }); return; }
        importSnapshot(snapshot, true);
        emit('app.notice', { message: `Imported ${snapshot.nodes.length} nodes from mermaid.` });
      })();
    });

    on('graph.import.paste', () => {
      void (async () => {
        const text = await navigator.clipboard?.readText?.().catch(() => '');
        if (text) emit('graph.import.mermaid', { source: text });
      })();
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

    // Paste a mermaid graph (or a mermaid.live link) anywhere outside an input
    // to import it — the zero-friction path the `?in=` param mirrors.
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text || !looksLikeMermaid(text)) return;
      event.preventDefault();
      emit('graph.import.mermaid', { source: text });
    };
    document.addEventListener('paste', onPaste);

    on('app.start', bootFromUrl);
    return () => document.removeEventListener('paste', onPaste);
  }, { requires: ['graph'] });
}
