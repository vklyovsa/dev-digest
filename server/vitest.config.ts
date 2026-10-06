import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, 'src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // A test that boots the app without its own `db` would otherwise open the dev database
    // from `.env`, and boot writes to it (the stale-run reaper). Integration tests pass a
    // testcontainers `db`, so they never read this.
    env: { DATABASE_URL: 'postgres://isolated:isolated@127.0.0.1:1/isolated' },
    // Testcontainers integration tests can be slow to spin up Postgres.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
