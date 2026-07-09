import { z } from 'zod';
import { getSchemaId } from './get-schema-id';
import type { JsonObject } from './json-object.types';
import { rewriteDefsRefsToComponents } from './rewrite-refs';

/**
 * The result of converting one id-tagged Zod schema into OpenAPI
 * component form: its own body, plus every shared sub-schema it
 * transitively references (each keyed by its own registered id).
 */
export interface OpenApiComponentExtraction {
  /** The schema's own registered id — its `components.schemas` key. */
  readonly name: string;
  /** The schema's own Schema Object body, with `$ref`s pointed at sibling components. */
  readonly body: JsonObject;
  /** Every shared sub-schema transitively referenced, keyed by their own registered ids. */
  readonly defs: ReadonlyMap<string, JsonObject>;
}

/**
 * Converts one id-tagged Zod schema (a resource or a shared
 * sub-schema) into OpenAPI `components.schemas` form.
 *
 * Generating a schema in isolation bundles everything it references
 * as local `$defs` (see `buildResourceJsonSchema`). OpenAPI instead
 * wants shared sub-schemas as named, top-level components reused by
 * `$ref` across every resource — so this pulls each `$defs` entry out
 * to be registered separately, and rewrites every `$ref` in the body
 * (and in the extracted defs themselves, which may reference each
 * other) to point at `#/components/schemas/<id>` instead of
 * `#/$defs/<id>`.
 */
export function extractOpenApiComponent(schema: z.ZodType): OpenApiComponentExtraction {
  const name = getSchemaId(schema);

  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonObject;
  const { $schema: _schema, $defs, ...rest } = generated;

  const body = rewriteDefsRefsToComponents(rest) as JsonObject;

  const defs = new Map<string, JsonObject>();
  if ($defs && typeof $defs === 'object') {
    for (const [defName, defBody] of Object.entries($defs as Record<string, JsonObject>)) {
      defs.set(defName, rewriteDefsRefsToComponents(defBody) as JsonObject);
    }
  }

  return { name, body, defs };
}
