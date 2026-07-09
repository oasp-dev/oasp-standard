import { writeArtifacts } from './write-artifacts';

/**
 * Executable entry point for `pnpm generate`. Not imported by
 * anything else in the package — this is the thin CLI wrapper around
 * the pure/side-effecting split in `write-artifacts.ts`.
 */
writeArtifacts()
  .then(() => {
    console.log('Generated JSON Schema + OpenAPI artifacts for @oasp/schemas.');
  })
  .catch((error: unknown) => {
    console.error('Failed to generate @oasp/schemas artifacts:', error);
    process.exitCode = 1;
  });
