import { describe, expect, expectTypeOf, it } from 'vitest';
import { type AgentVersionRef, agentVersionRefSchema } from './agent-version-ref';

describe('agentVersionRefSchema', () => {
  it('accepts a valid pin', () => {
    expect(agentVersionRefSchema.safeParse({ agentDefinitionId: 'agentdef_1', version: 3 }).success).toBe(true);
  });

  it('rejects a non-positive version', () => {
    const result = agentVersionRefSchema.safeParse({ agentDefinitionId: 'agentdef_1', version: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['version']);
  });

  it('rejects a fractional version', () => {
    expect(agentVersionRefSchema.safeParse({ agentDefinitionId: 'agentdef_1', version: 1.5 }).success).toBe(false);
  });

  it('infers the expected shape', () => {
    expectTypeOf<AgentVersionRef>().toEqualTypeOf<{ agentDefinitionId: string; version: number }>();
  });
});
