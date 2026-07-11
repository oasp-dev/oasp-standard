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

  // The round-trip test above cannot distinguish a genuinely decoupled
  // snapshot from one aliasing the source's arrays — immediately after the
  // write, an aliased copy reads back identical too. The two tests below are
  // the regression pair for exactly that defect (dev-lead-required N2): the
  // store's immutability must be a runtime fact, not a naming convention.
  it('write-side decoupling: mutating the source definition\'s tools/guardrails in place after snapshotting does not alter the stored snapshot', () => {
    const state = createServerState();
    const definition = buildDefinition({
      tools: [{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }],
      guardrails: ['original-guardrail'],
    });
    snapshotAgentDefinitionVersion(state, definition, 1);

    // Mutate the SAME array instances the live record keeps using — the
    // aliasing bug would leak both pushes straight into the stored snapshot.
    definition.tools.push({ type: 'custom', name: 'injected_after_snapshot', description: 'Added after the snapshot was taken.', inputSchema: {} });
    definition.guardrails.push('injected-after-snapshot');

    const snapshot = getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 });
    expect(snapshot?.tools).toEqual([{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }]);
    expect(snapshot?.guardrails).toEqual(['original-guardrail']);
  });

  it('read-side decoupling: mutating a returned snapshot does not alter what the store hands back on re-read', () => {
    const state = createServerState();
    snapshotAgentDefinitionVersion(
      state,
      buildDefinition({
        instructions: 'pristine instructions',
        tools: [{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }],
        guardrails: ['pristine-guardrail'],
      }),
      1,
    );

    const first = getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 });
    if (!first) throw new Error('setup failed');
    first.instructions = 'tampered';
    first.tools.push({ type: 'custom', name: 'tampered_tool', description: 'Pushed into a returned snapshot.', inputSchema: {} });
    first.guardrails.push('tampered-guardrail');

    const second = getAgentDefinitionVersion(state, { agentDefinitionId: 'agentdef_1', version: 1 });
    expect(second?.instructions).toBe('pristine instructions');
    expect(second?.tools).toEqual([{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }]);
    expect(second?.guardrails).toEqual(['pristine-guardrail']);
  });
});
