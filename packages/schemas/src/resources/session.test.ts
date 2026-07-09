import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Session, sessionSchema } from './session';

const validSession = {
  id: 'sess_1',
  pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 4 },
  resources: [
    { type: 'file', fileId: 'file_1' },
    { type: 'memory_store', storeId: 'mem_1' },
    { type: 'github_repository', owner: 'fieldstate-labs', repo: 'lucidbrain' },
  ],
  vaultIds: ['cred_1'],
};

describe('sessionSchema', () => {
  it('parses a valid Session, including every resources variant', () => {
    const result = sessionSchema.safeParse(validSession);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts a github_repository resource without a ref (defaults to the default branch)', () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      resources: [{ type: 'github_repository', owner: 'fieldstate-labs', repo: 'lucidbrain' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized mounted resource type', () => {
    const result = sessionSchema.safeParse({ ...validSession, resources: [{ type: 'database', dsn: 'x' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['resources', 0, 'type']);
  });

  it('infers a discriminated resources union', () => {
    expectTypeOf<Session['resources'][number]['type']>().toEqualTypeOf<'file' | 'memory_store' | 'github_repository'>();
  });
});
