import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getSchemaId } from './get-schema-id';
import { RESOURCE_SCHEMAS } from './resource-registry';

/**
 * Every `resourceType` literal a resource schema actually declares,
 * resolved down to the plain object(s) that carry the field. Most
 * resources are a single `z.object({...})`, so this returns exactly
 * one literal; `Event` is a `z.discriminatedUnion('type', [...])`
 * whose `resourceType` lives on each branch (via the shared
 * `eventBaseSchema` every branch extends), so this recurses into
 * `.options` and returns one literal per branch — all of which must
 * still agree with each other and with the registered `.meta({ id })`.
 */
function collectResourceTypeLiterals(schema: unknown): readonly string[] {
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option) => collectResourceTypeLiterals(option));
  }
  if (schema instanceof z.ZodObject) {
    const resourceTypeField = schema.shape['resourceType'];
    if (!resourceTypeField) {
      return [];
    }
    if (!(resourceTypeField instanceof z.ZodLiteral)) {
      throw new Error("resourceType field is not a z.literal(...) — every resource must build it via the shared `resourceType()` helper.");
    }
    if (resourceTypeField.values.size !== 1) {
      throw new Error('resourceType field must be a single-value literal.');
    }
    return [resourceTypeField.value as string];
  }
  return [];
}

/**
 * Guards proposal 0001 / `docs/spec/resources.md`'s core normative
 * requirement at the schema level: every registered *resource*
 * (`RESOURCE_SCHEMAS`, the same list the JSON Schema / OpenAPI
 * generator walks) MUST carry a `resourceType` literal equal to its
 * own registered `.meta({ id })` name. A resource that forgot to add
 * `resourceType`, or added it with the wrong literal value (e.g. a
 * copy-paste of a sibling resource's name), fails here before it can
 * ever reach a generated artifact or a conformance run.
 */
describe('every resource schema carries a resourceType literal equal to its id', () => {
  it.each(RESOURCE_SCHEMAS.map((schema) => [getSchemaId(schema), schema] as const))('%s', (id, schema) => {
    const literals = collectResourceTypeLiterals(schema);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(literal).toBe(id);
    }
  });
});
