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
  const longest = [...titleLines, ...bodyLines].reduce((max, line) => Math.max(max, line.length), 1);
  const width = clamp(longest * 7.2 + 36, input.minWidth ?? 112, input.maxWidth ?? 360);
  const height = clamp(titleLines.length * 20 + bodyLines.length * 15 + 28, input.minHeight ?? 56, input.maxHeight ?? 260);
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
