import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './build-openapi-document';
import { buildResourceJsonSchema } from './build-resource-json-schema';
import { getSchemaId } from './get-schema-id';
import { RESOURCE_SCHEMAS } from './resource-registry';
import { stringifyJsonSchemaDoc } from './stringify-json-schema-doc';
import { stringifyOpenApiDocument } from './stringify-openapi-document';

/**
 * Guards the load-bearing S0 acceptance criterion directly (not just via
 * the drift snapshot): every `$id` must resolve under the vendor-neutral
 * `schema.oasp.dev` domain, and no artifact may leak a `workspec` or
 * `fieldstate` URL — the whole point of the standard/implementation
 * boundary is that OASP's schemas do not live under a product domain.
 */
const OASP_ID_PREFIX = 'https://schema.oasp.dev/v1alpha1/';

describe('generated $ids use the vendor-neutral oasp.dev domain', () => {
  it.each(RESOURCE_SCHEMAS.map((schema) => [getSchemaId(schema), schema] as const))(
    '%s.json has an oasp.dev $id',
    (name, schema) => {
      const doc = buildResourceJsonSchema(schema);
      expect(doc.$id).toBe(`${OASP_ID_PREFIX}${name}.json`);
    },
  );

  it.each(RESOURCE_SCHEMAS.map((schema) => [getSchemaId(schema), schema] as const))(
    '%s.json leaks no product-domain (workspec/fieldstate) URL',
    (_name, schema) => {
      const serialized = stringifyJsonSchemaDoc(buildResourceJsonSchema(schema));
      expect(serialized).not.toMatch(/workspec|fieldstate/i);
    },
  );

  it('the OpenAPI document leaks no product-domain (workspec/fieldstate) URL', () => {
    const serialized = stringifyOpenApiDocument(buildOpenApiDocument());
    expect(serialized).not.toMatch(/workspec|fieldstate/i);
  });
});
