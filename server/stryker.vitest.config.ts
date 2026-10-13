import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Stryker runs this config from a sandbox copy two levels below the package, where
// `../reviewer-core` does not exist: the sibling package is resolved from the real root.
const packageRoot = __dirname.includes(`${path.sep}.stryker-tmp${path.sep}`)
  ? path.resolve(__dirname, '../..')
  : __dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, 'src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(packageRoot, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/eval-helpers.test.ts', 'test/eval-case-editor.test.ts'],
    env: { DATABASE_URL: 'postgres://isolated:isolated@127.0.0.1:1/isolated' },
  },
});
