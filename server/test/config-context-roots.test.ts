import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTEXT_ROOTS, loadConfig } from '../src/platform/config.js';

describe('PROJECT_CONTEXT_ROOTS', () => {
  it('defaults to specs, docs and insights when nothing is set', () => {
    expect(loadConfig({}).contextRoots).toEqual(['specs', 'docs', 'insights']);
    expect([...DEFAULT_CONTEXT_ROOTS]).toEqual(['specs', 'docs', 'insights']);
  });

  it('splits on commas, trims and keeps the configured order', () => {
    expect(loadConfig({ PROJECT_CONTEXT_ROOTS: 'adr, specs' }).contextRoots).toEqual([
      'adr',
      'specs',
    ]);
  });

  it('drops empty entries', () => {
    expect(loadConfig({ PROJECT_CONTEXT_ROOTS: ' ,adr,, ,specs,' }).contextRoots).toEqual([
      'adr',
      'specs',
    ]);
  });

  it('falls back to the defaults for an empty or blank value', () => {
    expect(loadConfig({ PROJECT_CONTEXT_ROOTS: '' }).contextRoots).toEqual([
      'specs',
      'docs',
      'insights',
    ]);
    expect(loadConfig({ PROJECT_CONTEXT_ROOTS: ' , ' }).contextRoots).toEqual([
      'specs',
      'docs',
      'insights',
    ]);
  });

  it('hands out a fresh list, so a caller cannot change the defaults', () => {
    loadConfig({}).contextRoots.push('mutated');
    expect(loadConfig({}).contextRoots).toEqual(['specs', 'docs', 'insights']);
  });
});
