/**
 * Converts a PascalCase resource id (e.g. `"AgentDefinition"`) to the
 * kebab-case filename fixtures are stored under (e.g.
 * `"agent-definition"`). Lets `fixtures.test.ts` map `RESOURCE_SCHEMAS`
 * entries to their fixture files without hand-maintaining a second
 * name list that could drift from the schemas' own registered ids.
 */
export function pascalToKebab(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
