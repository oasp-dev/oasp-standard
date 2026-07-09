import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSchemaId } from '../src/generate/get-schema-id';
import { RESOURCE_SCHEMAS } from '../src/generate/resource-registry';
import { pascalToKebab } from './pascal-to-kebab';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The shape of a `fixtures/invalid/*.expected.json` entry: the issue's path and zod error code, nothing more brittle. */
interface ExpectedIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
}

function readJsonFixture(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

const NAMED_SCHEMAS = RESOURCE_SCHEMAS.map((schema) => [pascalToKebab(getSchemaId(schema)), schema] as const);

/**
 * Round-trips every fixture through its resource schema. `valid/`
 * fixtures must parse; `invalid/` fixtures must fail with (at least)
 * the issue(s) recorded in their paired `.expected.json` file, keyed
 * loosely on `path` + `code` so fixture intent stays legible without
 * pinning to zod's exact message wording.
 */
describe('fixtures round-trip through their resource schema', () => {
  it.each(NAMED_SCHEMAS)('%s: fixtures/valid fixture parses successfully', (name, schema) => {
    const input = readJsonFixture(path.join(FIXTURES_DIR, 'valid', `${name}.json`));
    const result = schema.safeParse(input);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues, null, 2)).toBe(true);
  });

  it.each(NAMED_SCHEMAS)('%s: fixtures/invalid fixture fails with the expected issue(s)', (name, schema) => {
    const input = readJsonFixture(path.join(FIXTURES_DIR, 'invalid', `${name}.json`));
    const expected = readJsonFixture(path.join(FIXTURES_DIR, 'invalid', `${name}.expected.json`)) as ExpectedIssue[];

    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) return;

    const actualIssues = result.error.issues.map((issue) => ({ path: issue.path, code: issue.code }));
    for (const expectedIssue of expected) {
      expect(actualIssues).toContainEqual({ path: expectedIssue.path, code: expectedIssue.code });
    }
  });
});
