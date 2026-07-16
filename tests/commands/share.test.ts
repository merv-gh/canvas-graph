import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';
import { decodeGraph, encodeGraph, mermaidToSnapshot, SHARE_URL_LIMIT, shareUrlTooLarge } from '../../frontend/systems/share';
import type { GraphSnapshot } from '../../frontend/model';

const sample: GraphSnapshot = {
  schemaVersion: 1,
  name: 'Release map',
  nodes: [
    { id: 'a', Label: { text: 'Alpha' }, NodeType: 'text', Position: { x: 0, y: 0 }, Size: { w: 200, h: 120 }, Description: 'first' },
    { id: 'b', Label: { text: 'Beta' }, NodeType: 'text', Position: { x: 300, y: 0 }, Size: { w: 200, h: 120 } },
  ],
  edges: [{ id: 'e0', From: 'a', To: 'b', EdgeKind: 'sync', Label: { text: 'calls' } }],
  extensions: { containers: [{ id: 'c1', Label: { text: 'System' }, Children: [{ kind: 'node', id: 'a' }] }] },
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
    expect(decoded?.name).toBe('Release map');
    expect(decoded?.extensions?.containers).toEqual(sample.extensions?.containers);
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

  it('guards links beyond the reliable browser URL budget', () => {
    expect(shareUrlTooLarge(`https://canvas.test/?g=${'x'.repeat(SHARE_URL_LIMIT)}`)).toBe(true);
    expect(shareUrlTooLarge('https://canvas.test/?g=small')).toBe(false);
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

  it('imports a Mermaid Live pako link without an external fixture', async () => {
    const code = `flowchart LR
  mobile["Mobile app"] --> api["API gateway"]
  api --> auth["Auth service"]
  api --> upload["Upload service"]
  upload --> photo[("Photo store")]
  upload --> queue["Work queue"]
  queue --> worker["Image worker"]
  worker --> photo
  worker --> db[("Metadata DB")]
  photo --> cdn["CDN"]
  cdn --> mobile
  api --> metrics["Metrics"]
  auth --> metrics
  upload --> metrics
  worker --> metrics
  db --> metrics`;
    const payload = deflateSync(JSON.stringify({ code })).toString('base64url');
    const link = `https://mermaid.live/edit#pako:${payload}`;
    const snapshot = await mermaidToSnapshot(link);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nodes.length).toBeGreaterThanOrEqual(10);
    expect(snapshot!.edges.length).toBeGreaterThanOrEqual(15);
    // Markdown-string labels are cleaned to plain text.
    expect(snapshot!.nodes.some(n => /mobile app/i.test(n.Label?.text ?? ''))).toBe(true);
    expect(snapshot!.nodes.every(n => !/[<>]/.test(n.Label?.text ?? ''))).toBe(true);
  });

  it('previews and confirms mermaid before replacing the graph', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.import.mermaid', { source: 'flowchart\nA[One] --> B[Two]\nB --> C[Three]' });
    await tick();
    expect(ctx.graphs.current.nodes()).toHaveLength(0);
    expect(document.querySelector('.import-preview')?.textContent).toContain('3 nodes and 2 edges');
    ctx.bus.emit('graph.import.confirm');
    await tick();
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
    expect(ctx.graphs.current.edges()).toHaveLength(2);
  });

  it('rejects incomplete mermaid atomically', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'Keep me' } });
    await tick();
    ctx.bus.emit('graph.import.mermaid', { source: 'flowchart LR\nA -->' });
    await tick();
    expect(ctx.graphs.current.nodes().map(node => node.Label.text)).toEqual(['Keep me']);
    expect(document.querySelector('.import-preview')).toBeNull();
  });
});
