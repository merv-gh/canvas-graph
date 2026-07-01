import { clamp, type Registry } from '../core';
import type { Size } from '../types';

export type TextLayoutInput = {
  title: string;
  description?: string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

export type TextFit = {
  fontSize: number;
  lineHeight: number;
  lines: number;
  overflow: boolean;
};

export type TextLayoutApi = {
  estimate(input: TextLayoutInput): Size;
  fit(text: string, box: Size): TextFit;
};

declare module '../types' {
  interface CustomExposable {
    textLayout?: TextLayoutApi;
  }
}

const linesOf = (text: string) => text.split(/\r?\n/).flatMap(line => {
  const trimmed = line.trim();
  return trimmed ? [trimmed] : [];
});

export const estimateTextSize = (input: TextLayoutInput): Size => {
  const titleLines = linesOf(input.title);
  const bodyLines = linesOf(input.description ?? '');
  const CHAR_W = 7.2, PAD_X = 32;
  const longest = [...titleLines, ...bodyLines].reduce((max, line) => Math.max(max, line.length), 1);
  const maxWidth = input.maxWidth ?? 320;
  // Width tracks the longest line, capped — then height accounts for lines that
  // wrap at that width AND every explicit newline, so the box fits its text.
  const width = clamp(longest * CHAR_W + PAD_X, input.minWidth ?? 120, maxWidth);
  const capacity = Math.max(6, Math.floor((width - PAD_X) / CHAR_W));
  const wrappedRows = (lines: string[]) =>
    lines.reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / capacity)), 0);
  const titleRows = Math.max(1, wrappedRows(titleLines));
  const bodyRows = wrappedRows(bodyLines);
  const height = clamp(titleRows * 22 + bodyRows * 16 + 24, input.minHeight ?? 56, input.maxHeight ?? 280);
  return { w: Math.round(width), h: Math.round(height) };
};

export const fitText = (text: string, box: Size): TextFit => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chars = Math.max(1, words.join(' ').length);
  const lineCapacity = Math.max(8, Math.floor(box.w / 7));
  const lines = Math.max(1, Math.ceil(chars / lineCapacity));
  const lineHeight = 1.25;
  const maxFont = 14;
  const fontSize = clamp(Math.floor(box.h / (lines * lineHeight)), 10, maxFont);
  return { fontSize, lineHeight, lines, overflow: lines * fontSize * lineHeight > box.h };
};

export function registerTextLayout(system: Registry) {
  system('text.layout', (ctx) => {
    ctx.expose('textLayout', { estimate: estimateTextSize, fit: fitText });
  });
}
