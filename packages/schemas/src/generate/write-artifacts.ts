import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOpenApiDocument } from './build-openapi-document';
import { buildResourceJsonSchema } from './build-resource-json-schema';
import { getSchemaId } from './get-schema-id';
import { REPO_PATHS } from './repo-paths';
import { RESOURCE_SCHEMAS } from './resource-registry';
import { stringifyJsonSchemaDoc } from './stringify-json-schema-doc';
import { stringifyOpenApiDocument } from './stringify-openapi-document';

/**
 * Writes every generated artifact — one JSON Schema file per
 * resource, plus the bundled OpenAPI document — to disk.
 *
 * This is the only side-effecting module in `src/generate/`; every
 * other module here is a pure function operating on Zod schemas in
 * memory. That split is what lets the drift test regenerate and
 * compare against the committed files without needing to shell out to
 * git or touch the filesystem itself.
 */
export async function writeArtifacts(): Promise<void> {
  await mkdir(REPO_PATHS.schemasDir, { recursive: true });
  await mkdir(REPO_PATHS.openapiDir, { recursive: true });

  for (const schema of RESOURCE_SCHEMAS) {
    const name = getSchemaId(schema);
    const doc = buildResourceJsonSchema(schema);
    await writeFile(path.join(REPO_PATHS.schemasDir, `${name}.json`), stringifyJsonSchemaDoc(doc), 'utf8');
  }

  await writeFile(REPO_PATHS.openapiFile, stringifyOpenApiDocument(buildOpenApiDocument()), 'utf8');
}
