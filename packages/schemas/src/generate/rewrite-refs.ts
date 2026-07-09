/**
 * Recursively rewrites every `$ref` pointing at a local `#/$defs/<id>`
 * fragment to instead point at an OpenAPI `#/components/schemas/<id>`
 * fragment.
 *
 * Used when promoting a self-contained resource JSON Schema (which
 * bundles shared sub-schemas as local `$defs`) into the OpenAPI
 * document, where those same shared sub-schemas are instead named,
 * top-level components shared across every resource — see
 * `extractOpenApiComponent`.
 *
 * Pure and side-effect-free: returns a new value, never mutates its
 * input.
 */
export function rewriteDefsRefsToComponents(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteDefsRefsToComponents(item));
  }

  if (node !== null && typeof node === 'object') {
    const entries = Object.entries(node as Record<string, unknown>).map(([key, value]): [string, unknown] => {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
        return [key, `#/components/schemas/${value.slice('#/$defs/'.length)}`];
      }
      return [key, rewriteDefsRefsToComponents(value)];
    });
    return Object.fromEntries(entries);
  }

  return node;
}
