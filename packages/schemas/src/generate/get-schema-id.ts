import { z } from 'zod';

/**
 * Reads the stable `id` a resource or shared sub-schema was
 * registered under via `.meta({ id })`. This id is reused verbatim as
 * the JSON Schema filename/`$id` and the OpenAPI
 * `components.schemas` key, so it is the one place each schema's name
 * is spelled out — every schema passed into the generator must have
 * one.
 */
export function getSchemaId(schema: z.ZodType): string {
  const id = z.globalRegistry.get(schema)?.id;
  if (!id) {
    throw new Error('getSchemaId: schema is missing a registered `id` — call `.meta({ id })` on it.');
  }
  return id;
}
