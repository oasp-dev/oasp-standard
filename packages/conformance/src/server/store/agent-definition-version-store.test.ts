import type { AgentDefinition } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { getAgentDefinitionVersion, snapshotAgentDefinitionVersion } from './agent-definition-version-store';
import { createServerState } from './server-state';

function buildDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agentdef_1',
    name: 'Test',
    instructions: 'x',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [],
    guardrails: [],
    draftVersion: 1,
    publishedVersion: null,
    scope: { level: 'workspace', id: 'workspace_1' },
    ...overrides,
  };
}

describe('agent-definition-version-store', () => {
  it('returns undefined for a version that was never snapshotted', () => {
    const state = createServerState();
    expect(getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 })).toBeUndefined();
  });

  it('round-trips a snapshot written by snapshotAgentDefinitionVersion', () => {
    const state = createServerState();
    const definition = buildDefinition({ tools: [{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }] });

    snapshotAgentDefinitionVersion(state, definition, 1);

    expect(getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 })).toEqual({
      agentDefinitionId: 'agentdef_1',
      version: 1,
      instructions: definition.instructions,
      provider: definition.provider,
      model: definition.model,
      tools: definition.tools,
      guardrails: definition.guardrails,
    });
  });

  it('excludes name — a display label, not versioned content', () => {
    const state = createServerState();
    snapshotAgentDefinitionVersion(state, buildDefinition({ name: 'Support Assistant' }), 1);
    const snapshot = getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 });
    expect(snapshot).not.toHaveProperty('name');
  });

  it('keys by the (agentDefinitionId, version) pair — two different AgentDefinitions may each reach version 1 without colliding', () => {
    const state = createServerState();
    snapshotAgentDefinitionVersion(state, buildDefinition({ id: 'agentdef_1', instructions: 'first' }), 1);
    snapshotAgentDefinitionVersion(state, buildDefinition({ id: 'agentdef_2', instructions: 'second' }), 1);

    expect(getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 })?.instructions).toBe('first');
    expect(getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_2', version: 1 })?.instructions).toBe('second');
  });

  it('keeps distinct versions of the same AgentDefinition independently addressable', () => {
    const state = createServerState();
    snapshotAgentDefinitionVersion(state, buildDefinition({ instructions: 'v1 instructions' }), 1);
    snapshotAgentDefinitionVersion(state, buildDefinition({ instructions: 'v2 instructions', draftVersion: 2 }), 2);

    expect(getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 })?.instructions).toBe('v1 instructions');
    expect(getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 2 })?.instructions).toBe('v2 instructions');
  });
});
