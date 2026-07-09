import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './build-openapi-document';
import { buildResourceJsonSchema } from './build-resource-json-schema';
import { getSchemaId } from './get-schema-id';
import { REPO_PATHS } from './repo-paths';
import { RESOURCE_SCHEMAS } from './resource-registry';
import { stringifyJsonSchemaDoc } from './stringify-json-schema-doc';
import { stringifyOpenApiDocument } from './stringify-openapi-document';

/**
 * The drift gate: regenerates every artifact in memory from the Zod
 * source and asserts it is byte-identical to what's committed under
 * `schemas/` and `openapi/`. If someone edits a resource schema
 * without running `pnpm generate`, this test fails — CI catches the
 * un-regenerated drift without needing to shell out to `git diff`.
 */
describe('generated artifacts match the committed source of truth (drift gate)', () => {
  it.each(RESOURCE_SCHEMAS.map((schema) => [getSchemaId(schema), schema] as const))(
    'schemas/v1alpha1/%s.json matches in-memory generation',
    (name, schema) => {
      const committed = readFileSync(path.join(REPO_PATHS.schemasDir, `${name}.json`), 'utf8');
      const regenerated = stringifyJsonSchemaDoc(buildResourceJsonSchema(schema));
      expect(regenerated).toBe(committed);
    },
  );

  it('openapi/oasp-v1alpha1.yaml matches in-memory generation', () => {
    const committed = readFileSync(REPO_PATHS.openapiFile, 'utf8');
    const regenerated = stringifyOpenApiDocument(buildOpenApiDocument());
    expect(regenerated).toBe(committed);
  });
});

describe('regeneration is deterministic', () => {
  it('produces byte-identical JSON Schema output across repeated runs', () => {
    for (const schema of RESOURCE_SCHEMAS) {
      const first = stringifyJsonSchemaDoc(buildResourceJsonSchema(schema));
      const second = stringifyJsonSchemaDoc(buildResourceJsonSchema(schema));
      expect(second).toBe(first);
    }
  });

  it('produces byte-identical OpenAPI output across repeated runs', () => {
    const first = stringifyOpenApiDocument(buildOpenApiDocument());
    const second = stringifyOpenApiDocument(buildOpenApiDocument());
    expect(second).toBe(first);
  });
});
