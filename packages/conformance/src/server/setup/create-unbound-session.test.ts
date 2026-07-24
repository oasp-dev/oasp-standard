import { sessionSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { authenticatedActorFactory } from '../../factories/authenticated-actor-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('createUnboundSessionSetup (via ReferenceServer.createBuilderSession / createTestSession)', () => {
  it('createBuilderSession creates a schema-valid Session pinned to draftVersion, with no Conversation', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const result = await server.createBuilderSession(definition.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sessionSchema.safeParse(result.value).success).toBe(true);
    expect(result.value.pinnedAgentVersion).toEqual({ agentDefinitionId: definition.id, version: definition.draftVersion });
  });

  it('createTestSession also pins to draftVersion, with no Conversation', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const result = await server.createTestSession(definition.id);
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.pinnedAgentVersion.version).toBe(definition.draftVersion);
  });

  it('createBuilderSession still pins to draftVersion even after publish (builder always tracks latest draft)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, authenticatedActorFactory(server));
    const result = await server.createBuilderSession(definition.id);
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.pinnedAgentVersion.version).toBe(definition.draftVersion);
  });

  it('rejects an unknown agentDefinitionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.createBuilderSession('does_not_exist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DefinitionNotFound');
  });
});
