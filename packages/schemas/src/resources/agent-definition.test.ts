import { describe, expect, expectTypeOf, it } from 'vitest';
import { type AgentDefinition, agentDefinitionSchema } from './agent-definition';

const validAgentDefinition = {
  resourceType: 'AgentDefinition',
  id: 'agentdef_1',
  name: 'Support Assistant',
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
  draftVersion: 2,
  publishedVersion: 1,
  scope: { level: 'workspace', id: 'workspace_1' },
};

describe('agentDefinitionSchema', () => {
  it('parses a valid AgentDefinition, including every tools variant', () => {
    const result = agentDefinitionSchema.safeParse(validAgentDefinition);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts a never-published Definition (publishedVersion: null)', () => {
    const result = agentDefinitionSchema.safeParse({ ...validAgentDefinition, publishedVersion: null });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized tool discriminant', () => {
    const result = agentDefinitionSchema.safeParse({
      ...validAgentDefinition,
      tools: [{ type: 'shell_exec', command: 'rm -rf /' }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['tools', 0, 'type']);
  });

  it('infers a discriminated tools union', () => {
    expectTypeOf<AgentDefinition['tools'][number]['type']>().toEqualTypeOf<'builtin_toolset' | 'custom' | 'mcp'>();
  });
});
