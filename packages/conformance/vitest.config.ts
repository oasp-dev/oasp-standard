import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `@oasp/conformance`. Every test in this package is
 * in-memory (the mock provider and reference server hold state in
 * plain Maps) — no shared external resource, no DB, no network — so
 * files run in parallel; the `fileParallelism: false` workaround
 * needed for Testcontainers-backed packages does not apply here.
 *
 * Determinism (required by the package's own charter — see the root
 * README) is a property of the code under test, not of this config:
 * the mock provider and reference server take an injected clock and
 * seed rather than reading `Date.now()`/`Math.random()`, so re-running
 * `vitest run` twice produces byte-identical assertions every time.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
