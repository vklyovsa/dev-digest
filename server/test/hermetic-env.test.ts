import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

describe('test environment', () => {
  it('never resolves the database URL to the dev database', () => {
    expect(loadConfig().databaseUrl).toBe('postgres://isolated:isolated@127.0.0.1:1/isolated');
  });
});
