import { z } from 'zod';
import { getSchemaId } from './get-schema-id';
import type { JsonObject } from './json-object.types';

/**
 * Base URL every OASP JSON Schema is published under. Required to be
 * the `oasp.dev` domain — never a workspec/fieldstate URL — because
 * this `$id` is what a conformant server or client editor resolves
 * against.
 */
const SCHEMA_BASE_URL = 'https://schema.oasp.dev/v1alpha1';

/**
 * Converts one resource's Zod schema into a self-contained JSON
 * Schema document. Shared sub-schemas the resource references
 * (Scope, Provider, …) are bundled inline as `$defs`, keyed by their
 * own registered `id`s — so the file resolves standalone, without
 * needing to fetch anything else from schema.oasp.dev.
 *
 * `$id` is always `${SCHEMA_BASE_URL}/<name>.json`, where `<name>` is
 * the schema's own registered id. This is the one function that spells
 * out that URL convention; everything else (the write step, the
 * drift test) goes through it.
 */
export function buildResourceJsonSchema(schema: z.ZodType): JsonObject {
  const name = getSchemaId(schema);
  // zod's `toJSONSchema` return type is a JSON-Schema-shaped payload
  // plus a non-enumerable `~standard` property; treating it as a plain
  // JSON object is exactly what every consumer here does with it.
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonObject;
  const { $schema, ...rest } = generated;

  return {
    $schema,
    $id: `${SCHEMA_BASE_URL}/${name}.json`,
    title: name,
    ...rest,
  };
}
