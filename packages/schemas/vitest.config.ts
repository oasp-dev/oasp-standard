import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@oasp/schemas`. This package has no shared external
 * resource (no DB, no network) so files run in parallel — the
 * `fileParallelism: false` workaround needed for Testcontainers-backed
 * packages does not apply here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'fixtures/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/generate/cli.ts'],
    },
  },
});
