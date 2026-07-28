import { afterEach, beforeEach, vi } from 'vitest';
import { teardownBoots } from './testkit';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  teardownBoots();
  vi.restoreAllMocks();
});
