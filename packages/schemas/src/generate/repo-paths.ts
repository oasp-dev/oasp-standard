import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../../..');

/**
 * The filesystem locations `generate` writes to and the drift test
 * reads from, resolved relative to this module's own file location
 * rather than `process.cwd()` — so both behave the same whether
 * invoked from the repo root, from `packages/schemas`, or via a
 * workspace-filtered pnpm script.
 */
export const REPO_PATHS = {
  /** Absolute path to the repo root. */
  root: repoRoot,
  /** Directory JSON Schema artifacts are written to / read from. */
  schemasDir: path.join(repoRoot, 'schemas', 'v1alpha1'),
  /** Directory the OpenAPI artifact is written to / read from. */
  openapiDir: path.join(repoRoot, 'openapi'),
  /** Full path to the generated OpenAPI document. */
  openapiFile: path.join(repoRoot, 'openapi', 'oasp-v1alpha1.yaml'),
} as const;
