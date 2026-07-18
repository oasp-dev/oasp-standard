import { describe, expect, expectTypeOf, it } from 'vitest';
import { type AgentDefinitionVersion, agentDefinitionVersionSchema } from './agent-definition-version';

const validAgentDefinitionVersion = {
  resourceType: 'AgentDefinitionVersion',
  agentDefinitionId: 'agentdef_1',
  version: 1,
  instructions: 'Help members with their support tickets.',
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  tools: [
    { type: 'builtin_toolset', toolset: 'coding' },
    { type: 'custom', name: 'lookup_ticket', description: 'Looks up a ticket by id.', inputSchema: { type: 'object' } },
    {
      type: 'mcp',
      serverUrl: 'https://mcp.example.com/support',
      label: 'Support MCP',
      auth: 'credential',
      permissionPolicy: 'always_ask',
    },
  ],
  guardrails: ['no-pii-in-logs'],
};

describe('agentDefinitionVersionSchema', () => {
  it('parses a valid AgentDefinitionVersion, including every tools variant', () => {
    const result = agentDefinitionVersionSchema.safeParse(validAgentDefinitionVersion);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('rejects a non-positive version', () => {
    const result = agentDefinitionVersionSchema.safeParse({ ...validAgentDefinitionVersion, version: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['version']);
  });

  it('rejects an unrecognized tool discriminant', () => {
    const result = agentDefinitionVersionSchema.safeParse({
      ...validAgentDefinitionVersion,
      tools: [{ type: 'shell_exec', command: 'rm -rf /' }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['tools', 0, 'type']);
  });

  it('has no name field: a version snapshot captures content, not the Definition\'s display label (an incidental extra `name` is stripped, not carried through)', () => {
    const result = agentDefinitionVersionSchema.safeParse({ ...validAgentDefinitionVersion, name: 'Support Assistant' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty('name');
  });

  it('infers a discriminated tools union', () => {
    expectTypeOf<AgentDefinitionVersion['tools'][number]['type']>().toEqualTypeOf<'builtin_toolset' | 'custom' | 'mcp'>();
  });

  it('infers the same { agentDefinitionId, version } identity fields AgentVersionRef pins', () => {
    expectTypeOf<Pick<AgentDefinitionVersion, 'agentDefinitionId' | 'version'>>().toEqualTypeOf<{
      agentDefinitionId: string;
      version: number;
    }>();
  });
});
