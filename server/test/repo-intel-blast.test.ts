import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CodeReference, CodeSymbol } from '@devdigest/shared';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type {
  FullSymbolRow,
  IndexerFileFactsRow,
  RepoBasics,
  RepoIntelRepository,
  ResolvedCallerRow,
} from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { Container } from '../src/platform/container.js';

const DECL_FILE = 'src/decl.ts';

function fullState(): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'sha-1',
    indexerVersion: 2,
    updatedAt: new Date(),
  };
}

function makeService(opts: {
  enabled: boolean;
  repo: Record<string, unknown>;
  codeIndex?: { symbols: () => Promise<CodeSymbol[]>; references: (r: unknown, s: string) => Promise<CodeReference[]> };
}) {
  const container = {
    config: { repoIntelEnabled: opts.enabled },
    db: {},
    codeIndex: opts.codeIndex ?? { symbols: async () => [], references: async () => [] },
  } as unknown as Container;
  const service = new RepoIntelService(container);
  (service as unknown as { repo: unknown }).repo = opts.repo;
  return service;
}

function symbolRow(path: string, name: string): FullSymbolRow {
  return { path, name, kind: 'function', line: 1, endLine: 20, exported: true, signature: null };
}

describe('getBlastRadius — persistent path', () => {
  it('caps callers per changed symbol by rank and reads facts for the survivors only', async () => {
    const callers: ResolvedCallerRow[] = [
      { fromPath: 'src/b-low.ts', toSymbol: 'b', line: 10, rank: 0.1 },
      { fromPath: 'src/b-mid.ts', toSymbol: 'b', line: 10, rank: 0.2 },
      ...Array.from({ length: 25 }, (_, i) => ({
        fromPath: `src/a${i}.ts`,
        toSymbol: 'a',
        line: 10,
        rank: 0.5 + i / 100,
      })),
    ];
    const factsCalls: string[][] = [];
    const service = makeService({
      enabled: true,
      repo: {
        tryGetIndexState: async () => fullState(),
        getSymbolRows: async (_id: string, paths: string[]): Promise<FullSymbolRow[]> =>
          paths.includes(DECL_FILE)
            ? [symbolRow(DECL_FILE, 'a'), symbolRow(DECL_FILE, 'b')]
            : paths.map((p) => symbolRow(p, `fn_${p}`)),
        getResolvedCallers: async () => callers,
        getFileFacts: async (_id: string, files: string[]): Promise<IndexerFileFactsRow[]> => {
          factsCalls.push(files);
          return [{ filePath: 'src/a24.ts', endpoints: ['GET /a'], crons: ['0 * * * *'] }];
        },
      },
    });

    const out = await service.getBlastRadius('r1', [DECL_FILE]);

    const a = out.callers.filter((c) => c.viaSymbol === 'a');
    const b = out.callers.filter((c) => c.viaSymbol === 'b');
    expect(a).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(a.map((c) => c.file)).toEqual(
      Array.from({ length: 20 }, (_, i) => `src/a${24 - i}.ts`),
    );
    expect(b.map((c) => c.file)).toEqual(['src/b-mid.ts', 'src/b-low.ts']);
    expect(out.degraded).toBe(false);

    expect(factsCalls).toHaveLength(1);
    expect([...factsCalls[0]!].sort()).toEqual([...new Set(out.callers.map((c) => c.file))].sort());
    expect(factsCalls[0]).not.toContain('src/a0.ts');
    expect(out.factsByFile).toEqual({ 'src/a24.ts': { endpoints: ['GET /a'], crons: ['0 * * * *'] } });
  });
});

describe('getBlastRadius — fallback path', () => {
  let clone: string;
  const callerFile = (i: number) => `src/c${String(i).padStart(2, '0')}.ts`;

  beforeAll(async () => {
    clone = await mkdtemp(join(tmpdir(), 'blast-fallback-'));
    const files: Record<string, string> = {
      [callerFile(0)]: "app.get('/x', h);\ncron.schedule('0 * * * *', run);\n",
      [callerFile(24)]: "app.get('/cut', h);\n",
    };
    for (const [path, body] of Object.entries(files)) {
      await mkdir(dirname(join(clone, path)), { recursive: true });
      await writeFile(join(clone, path), body);
    }
  });

  afterAll(async () => {
    await rm(clone, { recursive: true, force: true });
  });

  function fallbackService(enabled: boolean, opts: { referencesOutsideDecl?: number } = {}) {
    const basics: RepoBasics = {
      id: 'r1',
      owner: 'acme',
      name: 'app',
      defaultBranch: 'main',
      clonePath: clone,
    };
    const count = opts.referencesOutsideDecl ?? 25;
    return makeService({
      enabled,
      repo: { tryGetIndexState: async () => null, getRepoBasics: async () => basics },
      codeIndex: {
        symbols: async () => [{ path: DECL_FILE, name: 'sym', kind: 'function', line: 1 }],
        references: async () => [
          { fromPath: DECL_FILE, toSymbol: 'sym', line: 5 },
          ...Array.from({ length: count }, (_, i) => ({
            fromPath: callerFile(i),
            toSymbol: 'sym',
            line: 3,
          })),
        ],
      },
    });
  }

  it('caps callers per symbol, never lists the declaring file, and reads facts once per kept file', async () => {
    const out = await fallbackService(true).getBlastRadius('r1', [DECL_FILE]);

    expect(out.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(out.callers.map((c) => c.file)).not.toContain(DECL_FILE);
    expect(out.callers.map((c) => c.file)).not.toContain(callerFile(24));
    expect(out.factsByFile).toEqual({
      [callerFile(0)]: { endpoints: ['GET /x'], crons: ['0 * * * *'] },
    });
    expect(out.impactedEndpoints).toEqual(['GET /x']);
    expect(out.degraded).toBe(true);
    expect(out.reason).toBe('no_data');
  });

  it('answers flag_off, not no_data, when indexing is switched off — with callers', async () => {
    const out = await fallbackService(false).getBlastRadius('r1', [DECL_FILE]);
    expect(out.callers.length).toBeGreaterThan(0);
    expect(out.degraded).toBe(true);
    expect(out.reason).toBe('flag_off');
  });

  it('answers flag_off for the empty result too', async () => {
    const service = makeService({
      enabled: false,
      repo: { tryGetIndexState: async () => null, getRepoBasics: async () => null },
    });
    const out = await service.getBlastRadius('r1', [DECL_FILE]);
    expect(out).toMatchObject({ callers: [], changedSymbols: [], degraded: true, reason: 'flag_off' });
  });

  it('keeps no_data for an enabled repo that is not indexed yet', async () => {
    const service = makeService({
      enabled: true,
      repo: { tryGetIndexState: async () => null, getRepoBasics: async () => null },
    });
    const out = await service.getBlastRadius('r1', [DECL_FILE]);
    expect(out).toMatchObject({ degraded: true, reason: 'no_data' });
  });
});
