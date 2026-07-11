import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('editAgentDefinitionDraftSetup (via ReferenceServer.editAgentDefinitionDraft)', () => {
  it('advances draftVersion by one and leaves content unchanged when called with no overrides (pre-#10 behaviour, preserved as the default)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());

    const result = await server.editAgentDefinitionDraft(definition.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draftVersion).toBe(definition.draftVersion + 1);
    expect(result.value.tools).toEqual(definition.tools);
    expect(result.value.instructions).toEqual(definition.instructions);
  });

  it('applies contentOverrides to the live AgentDefinition (issue #10: makes a genuine content change possible)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory({ instructions: 'v1 instructions' }));

    const newTools = [{ type: 'custom' as const, name: 'new_tool', description: 'A materially different tool.', inputSchema: {} }];
    const result = await server.editAgentDefinitionDraft(definition.id, { instructions: 'v2 instructions', tools: newTools });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instructions).toBe('v2 instructions');
    expect(result.value.tools).toEqual(newTools);
    // Untouched fields are preserved from the prior draft, not reset.
    expect(result.value.name).toBe(definition.name);
  });

  it('freezes the new draftVersion as an immutable AgentDefinitionVersion snapshot distinct from the prior version', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory({ instructions: 'v1 instructions' }));
    const v1Snapshot = server.getAgentDefinitionVersion({ agentDefinitionId: definition.id, version: 1 });
    expect(v1Snapshot?.instructions).toBe('v1 instructions');

    const result = await server.editAgentDefinitionDraft(definition.id, { instructions: 'v2 instructions' });
    if (!result.ok) throw new Error('setup failed');

    const v2Snapshot = server.getAgentDefinitionVersion({ agentDefinitionId: definition.id, version: 2 });
    expect(v2Snapshot?.instructions).toBe('v2 instructions');
    // The v1 snapshot is untouched by the v2 edit — proves the store records
    // per-version rows rather than overwriting a single "latest" entry.
    expect(server.getAgentDefinitionVersion({ agentDefinitionId: definition.id, version: 1 })?.instructions).toBe('v1 instructions');
  });

  it('rejects an unknown definitionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.editAgentDefinitionDraft('does_not_exist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DefinitionNotFound');
  });
});
