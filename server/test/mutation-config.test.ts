import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const stryker = JSON.parse(read('stryker.config.json')) as { mutate: string[] };
const pkg = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('mutation run configuration', () => {
  it('AC-1: mutates exactly one existing source file that is not a test', () => {
    expect(stryker.mutate).toHaveLength(1);
    const target = stryker.mutate[0]!;
    expect(existsSync(path.join(root, target))).toBe(true);
    expect(target.endsWith('.test.ts')).toBe(false);
  });

  it('AC-2: runs only hermetic test files that import the mutated file', async () => {
    const narrowed = (await import('../stryker.vitest.config')).default;
    const include = narrowed.test?.include ?? [];
    expect(include.length).toBeGreaterThan(0);
    const target = path.join(root, stryker.mutate[0]!);
    for (const entry of include) {
      expect(entry).not.toMatch(/[*?{}[\]]/);
      expect(entry.endsWith('.it.test.ts')).toBe(false);
      const file = path.join(root, entry);
      expect(existsSync(file)).toBe(true);
      const imports = [...readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)].map((m) =>
        path.resolve(path.dirname(file), m[1]!.replace(/\.js$/, '.ts')),
      );
      expect(imports).toContain(target);
    }
  });

  it('AC-3: keeps the unreachable database pin and the aliases of the unit lane', async () => {
    const narrowed = (await import('../stryker.vitest.config')).default;
    const unit = (await import('../vitest.config')).default;
    expect(narrowed.test?.env?.DATABASE_URL).toBe(unit.test?.env?.DATABASE_URL);
    expect(narrowed.test?.env?.DATABASE_URL).toBeTruthy();
    expect(narrowed.resolve?.alias).toEqual(unit.resolve?.alias);
  });

  it('AC-20: pins both mutation packages to one exact version', () => {
    expect(pkg.devDependencies['@stryker-mutator/core']).toBe('9.6.1');
    expect(pkg.devDependencies['@stryker-mutator/vitest-runner']).toBe('9.6.1');
  });

  it('AC-21: exposes the run as one script', () => {
    expect(pkg.scripts['mutation:eval-helpers']).toBe('stryker run stryker.config.json');
  });
});
