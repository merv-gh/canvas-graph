import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';
import { decodeGraph, encodeGraph, mermaidToSnapshot } from '../../frontend/systems/share';
import type { GraphSnapshot } from '../../frontend/model';

const RepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const sample: GraphSnapshot = {
  nodes: [
    { id: 'a', Label: { text: 'Alpha' }, NodeType: 'text', Position: { x: 0, y: 0 }, Size: { w: 200, h: 120 }, Description: 'first' },
    { id: 'b', Label: { text: 'Beta' }, NodeType: 'text', Position: { x: 300, y: 0 }, Size: { w: 200, h: 120 } },
  ],
  edges: [{ id: 'e0', From: 'a', To: 'b', EdgeKind: 'sync', Label: { text: 'calls' } }],
};

const tick = async () => { await settle(); await new Promise(r => setTimeout(r, 0)); await settle(); };

describe('graph share codec', () => {
  it('round-trips a graph through the compressed ?g= payload', async () => {
    const encoded = await encodeGraph(sample);
    expect(encoded.startsWith('~')).toBe(true);           // compressed marker
    const decoded = await decodeGraph(encoded);
    expect(decoded?.nodes).toHaveLength(2);
    expect(decoded?.edges).toHaveLength(1);
    expect(decoded?.nodes[0].Label?.text).toBe('Alpha');
    expect(decoded?.nodes[0].Description).toBe('first');
    expect(decoded?.edges[0]).toMatchObject({ From: 'a', To: 'b', EdgeKind: 'sync' });
  });

  it('compresses better than raw base64 JSON for a large graph', async () => {
    const big: GraphSnapshot = {
      nodes: Array.from({ length: 200 }, (_, i) => ({
        id: `n${i}`, Label: { text: `Service node number ${i}` }, NodeType: 'text' as const,
        Position: { x: i * 10, y: i * 5 }, Size: { w: 200, h: 120 }, Description: 'a repeated description string that compresses well',
      })),
      edges: Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, From: `n${i}`, To: `n${(i + 1) % 200}`, EdgeKind: 'sync' as const })),
    };
    const compressed = await encodeGraph(big);
    const raw = JSON.stringify(big).length;
    expect(compressed.length).toBeLessThan(raw / 2);       // deflate wins on big graphs
  });

  it('still decodes a legacy uncompressed base64 payload', async () => {
    const compact = { v: 3, n: [['x', 'Legacy', 'text', 0, 0, 200, 120]], e: [] };
    const b64 = Buffer.from(JSON.stringify(compact)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const decoded = await decodeGraph(b64);
    expect(decoded?.nodes[0].Label?.text).toBe('Legacy');
  });
});

describe('mermaid import', () => {
  it('parses a flowchart with labeled edges and shape nodes', async () => {
    const snapshot = await mermaidToSnapshot(`flowchart TD
  A["Mobile app"] --> B[(Photo s3)]
  A -->|presign| C{Image upload}
  C --> B`);
    expect(snapshot).not.toBeNull();
    const titles = snapshot!.nodes.map(n => n.Label?.text);
    expect(titles).toContain('Mobile app');
    expect(titles).toContain('Photo s3');
    expect(snapshot!.edges).toHaveLength(3);
    expect(snapshot!.edges.find(e => e.From === 'A' && e.To === 'C')?.Label?.text).toBe('presign');
  });

  it('imports the real mermaid.txt (mermaid.live pako link)', async () => {
    const link = readFileSync(join(RepoRoot, 'mermaid.txt'), 'utf8').trim();
    const snapshot = await mermaidToSnapshot(link);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nodes.length).toBeGreaterThanOrEqual(10);
    expect(snapshot!.edges.length).toBeGreaterThanOrEqual(15);
    // Markdown-string labels are cleaned to plain text.
    expect(snapshot!.nodes.some(n => /mobile app/i.test(n.Label?.text ?? ''))).toBe(true);
    expect(snapshot!.nodes.every(n => !/[<>]/.test(n.Label?.text ?? ''))).toBe(true);
  });

  it('imports mermaid through the graph.import.mermaid event', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.import.mermaid', { source: 'flowchart\nA[One] --> B[Two]\nB --> C[Three]' });
    await tick();
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
    expect(ctx.graphs.current.edges()).toHaveLength(2);
  });
});
