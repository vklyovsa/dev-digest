import { describe, it, expect } from 'vitest';
import { backoffDelay } from '../src/platform/backoff.js';

describe('backoffDelay', () => {
  it('works', () => {
    expect(backoffDelay(1)).toBe(250);
  });
});
