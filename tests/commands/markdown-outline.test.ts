import { describe, expect, it } from 'vitest';
import { parseMarkdownOutline, type OutlineEntry } from '../../frontend/core/markdown';

const headings = (entries: OutlineEntry[]) =>
  entries.filter((entry): entry is Extract<OutlineEntry, { kind: 'heading' }> => entry.kind === 'heading');

describe('parseMarkdownOutline', () => {
  it('keeps headings in document order with their levels', () => {
    const entries = parseMarkdownOutline('# Alpha\n## Beta\n### Gamma');
    expect(entries).toHaveLength(3);
    expect(headings(entries).map(entry => [entry.level, entry.text])).toEqual([
      [1, 'Alpha'],
      [2, 'Beta'],
      [3, 'Gamma'],
    ]);
    expect(entries.every(entry => entry.kind === 'heading')).toBe(true);
  });

  it('nests items via 2-space indents and attaches the run to its heading', () => {
    const entries = parseMarkdownOutline('# Plan\n- a\n  - b\n  - c\n- d');
    expect(entries).toHaveLength(1);
    const heading = headings(entries)[0];
    expect(heading.items.map(item => item.text)).toEqual(['a', 'd']);
    expect(heading.items[0].children.map(item => item.text)).toEqual(['b', 'c']);
    expect(heading.items[1].children).toEqual([]);
  });

  it('treats a tab as one indentation level', () => {
    const entries = parseMarkdownOutline('- a\n\t- b\n\t- c\n- d');
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('items');
    expect(entries[0].items.map(item => item.text)).toEqual(['a', 'd']);
    expect(entries[0].items[0].children.map(item => item.text)).toEqual(['b', 'c']);
  });

  it('parses ordered lists with the same nesting rules', () => {
    const entries = parseMarkdownOutline('1. one\n2. two\n   1. nested\n3. three');
    expect(entries[0].items.map(item => item.text)).toEqual(['one', 'two', 'three']);
    expect(entries[0].items[1].children.map(item => item.text)).toEqual(['nested']);
  });

  it('uses the first paragraph after a heading as its description', () => {
    const entries = parseMarkdownOutline('# Title\nSome intro text\n- item');
    const heading = headings(entries)[0];
    expect(heading.description).toBe('Some intro text');
    expect(heading.items.map(item => item.text)).toEqual(['item']);
  });

  it('joins multi-line paragraphs and ignores later paragraphs', () => {
    const entries = parseMarkdownOutline('# Title\nline one\nline two\n\nsecond paragraph');
    expect(headings(entries)[0].description).toBe('line one line two');
  });

  it('uses the first paragraph after an item as its description', () => {
    const entries = parseMarkdownOutline('- a\n  details here\n- b');
    expect(entries[0].items[0].description).toBe('details here');
    expect(entries[0].items[1].description).toBeUndefined();
  });

  it('collects lists before the first heading into a leading items entry', () => {
    const entries = parseMarkdownOutline('- x\n- y\n# Head\n- z');
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('items');
    expect(entries[0].items.map(item => item.text)).toEqual(['x', 'y']);
    expect(entries[1].kind).toBe('heading');
    expect(headings(entries)[0].items.map(item => item.text)).toEqual(['z']);
  });

  it('ignores code fences, quotes, and rules entirely', () => {
    const entries = parseMarkdownOutline([
      '# H',
      '```',
      '# not a heading',
      '- not an item',
      '```',
      '> a quoted line',
      '---',
      '- real',
    ].join('\n'));
    expect(entries).toHaveLength(1);
    const heading = headings(entries)[0];
    expect(heading.items.map(item => item.text)).toEqual(['real']);
    expect(heading.description).toBeUndefined();
  });

  it('clamps indent jumps deeper than one level instead of skipping', () => {
    const entries = parseMarkdownOutline('- a\n        - b\n            - c');
    const [a] = entries[0].items;
    expect(a.children.map(item => item.text)).toEqual(['b']);
    expect(a.children[0].children.map(item => item.text)).toEqual(['c']);
  });

  it('starts a fresh nesting stack at each heading', () => {
    const entries = parseMarkdownOutline('# A\n  - indented\n# B\n- root');
    expect(headings(entries)[0].items.map(item => item.text)).toEqual(['indented']);
    expect(headings(entries)[1].items.map(item => item.text)).toEqual(['root']);
    expect(headings(entries)[1].items[0].children).toEqual([]);
  });
});
