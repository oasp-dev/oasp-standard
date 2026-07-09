import { stringify } from 'yaml';
import type { OpenApiDocument } from './build-openapi-document';

/**
 * The single serialization format the OpenAPI document uses:
 * two-space-indented YAML. Both the write step and the drift test go
 * through this function, so there is exactly one place that could
 * introduce a formatting mismatch between them.
 */
export function stringifyOpenApiDocument(doc: OpenApiDocument): string {
  return stringify(doc, { indent: 2 });
}
