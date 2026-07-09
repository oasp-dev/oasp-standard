import type { JsonObject } from './json-object.types';

/**
 * The single serialization format every generated JSON Schema file
 * uses: two-space-indented JSON with a trailing newline. Both the
 * write step and the drift test go through this function, so there is
 * exactly one place that could introduce a formatting mismatch
 * between them.
 */
export function stringifyJsonSchemaDoc(doc: JsonObject): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
