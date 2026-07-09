import { agentDefinitionSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('createAgentDefinitionSetup (via ReferenceServer.createAgentDefinition)', () => {
  it('creates a schema-valid AgentDefinition starting at draftVersion 1, unpublished', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());

    expect(agentDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(definition.draftVersion).toBe(1);
    expect(definition.publishedVersion).toBeNull();
  });

  it('assigns distinct ids across successive calls', async () => {
    const { server } = testHarnessFactory();
    const first = await server.createAgentDefinition(agentDefinitionInputFactory());
    const second = await server.createAgentDefinition(agentDefinitionInputFactory());
    expect(first.id).not.toBe(second.id);
  });

  it('is retrievable via getAgentDefinition', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    expect(server.getAgentDefinition(definition.id)).toEqual(definition);
  });
});
