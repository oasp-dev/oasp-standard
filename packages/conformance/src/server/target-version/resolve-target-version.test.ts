import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@oasp/schemas';
import { resolveTargetVersion } from './resolve-target-version';

function buildDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agentdef_1',
    name: 'Test',
    instructions: 'x',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [],
    guardrails: [],
    draftVersion: 3,
    publishedVersion: 2,
    scope: { level: 'workspace', id: 'workspace_1' },
    ...overrides,
  };
}

describe('resolveTargetVersion', () => {
  it('builder resolves to draftVersion', () => {
    const definition = buildDefinition();
    expect(resolveTargetVersion('builder', definition)).toEqual({ agentDefinitionId: 'agentdef_1', version: 3 });
  });

  it('test-session resolves to draftVersion', () => {
    const definition = buildDefinition();
    expect(resolveTargetVersion('test-session', definition)).toEqual({ agentDefinitionId: 'agentdef_1', version: 3 });
  });

  it('real conversation resolves to publishedVersion when set', () => {
    const definition = buildDefinition();
    expect(resolveTargetVersion('real', definition)).toEqual({ agentDefinitionId: 'agentdef_1', version: 2 });
  });

  it('real conversation resolves to null ("leave in place") when publishedVersion is null, never falling back to draftVersion', () => {
    const definition = buildDefinition({ publishedVersion: null });
    expect(resolveTargetVersion('real', definition)).toBeNull();
  });
});
