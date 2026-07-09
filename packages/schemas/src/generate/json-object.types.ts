/**
 * A generic JSON object, keyed by string with unknown-typed values.
 * Used throughout `src/generate/` for JSON Schema documents, OpenAPI
 * Schema Objects, and the OpenAPI document itself — none of these
 * need a fully structural type for what this package does with them
 * (read/write a handful of well-known keys), and a full structural
 * JSON Schema type would fight `exactOptionalPropertyTypes` for no
 * benefit here.
 */
export type JsonObject = Record<string, unknown>;
