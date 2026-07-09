import { extractOpenApiComponent } from './extract-openapi-component';
import { INTERACTION_PATHS } from './interaction-paths';
import type { JsonObject } from './json-object.types';
import { RESOURCE_SCHEMAS } from './resource-registry';

const OPENAPI_VERSION = '3.1.0';
const DOCUMENT_TITLE = 'OASP — Open Agent Session Protocol (v0)';
/** Matches the `v1alpha1` JSON Schema publication path, not semver — this is a spec draft stage, not a package release. */
const DOCUMENT_VERSION = 'v1alpha1';

/** The generated OpenAPI 3.1 document shape this package produces. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly components: { readonly schemas: Record<string, JsonObject> };
  readonly paths: JsonObject;
}

/**
 * Builds the OASP v0 OpenAPI 3.1 document from the same Zod resource
 * schemas the JSON Schema files are generated from — the single-source
 * invariant this package exists to enforce.
 *
 * Targets OpenAPI **3.1**, not 3.0: 3.1 Schema Objects are proper
 * JSON Schema Draft 2020-12, so the exact same `$defs`/`$ref`
 * machinery `buildResourceJsonSchema` uses applies here too (just
 * promoted to named `components.schemas` entries — see
 * `extractOpenApiComponent`). OpenAPI 3.0's Schema Object is a
 * different, more restrictive dialect (no `$defs`, `nullable: true`
 * instead of type unions); targeting it would mean either a lossier
 * translation or leaning on zod's `external` registry-linking option,
 * which has no test coverage in zod's own suite as of this package's
 * zod version. 3.1 sidesteps both.
 *
 * Every resource contributes its own component plus every shared
 * sub-schema (Scope, Provider, …) it transitively references;
 * `registerComponent` de-duplicates those shared components across
 * resources and throws if two schemas ever registered the same id
 * with different shapes — a tripwire against id collisions.
 */
export function buildOpenApiDocument(): OpenApiDocument {
  const schemas: Record<string, JsonObject> = {};

  for (const schema of RESOURCE_SCHEMAS) {
    const extraction = extractOpenApiComponent(schema);
    registerComponent(schemas, extraction.name, extraction.body);
    for (const [defName, defBody] of extraction.defs) {
      registerComponent(schemas, defName, defBody);
    }
  }

  return {
    openapi: OPENAPI_VERSION,
    info: { title: DOCUMENT_TITLE, version: DOCUMENT_VERSION },
    components: { schemas },
    paths: INTERACTION_PATHS,
  };
}

function registerComponent(schemas: Record<string, JsonObject>, name: string, body: JsonObject): void {
  const existing = schemas[name];
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(body)) {
    throw new Error(`buildOpenApiDocument: conflicting definitions registered for component "${name}".`);
  }
  schemas[name] = body;
}
