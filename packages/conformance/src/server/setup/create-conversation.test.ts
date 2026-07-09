import { conversationSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { createConversationInputFactory } from '../../factories/create-conversation-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('createConversationSetup (via ReferenceServer.createConversation)', () => {
  it('creates a schema-valid Conversation riding on a freshly minted Session', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, { principal: { kind: 'user', id: 'user_1' } });
    const result = await server.createConversation(createConversationInputFactory(definition.id));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(conversationSchema.safeParse(result.value).success).toBe(true);
    expect(result.value.previousSessionIds).toEqual([]);
    expect(server.getSession(result.value.currentSessionId)).toBeDefined();
  });

  it('rejects creating a real Conversation when the definition has never been published, rather than pinning to draftVersion (target-version-resolution.md\'s MUST NOT)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const result = await server.createConversation(createConversationInputFactory(definition.id));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.NeverPublished');
  });

  it('pins to publishedVersion once the definition has been published', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, { principal: { kind: 'user', id: 'user_1' } });
    const result = await server.createConversation(createConversationInputFactory(definition.id));
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.pinnedAgentVersion.version).toBe(definition.draftVersion);
  });

  it('rejects an unknown agentDefinitionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.createConversation(createConversationInputFactory('does_not_exist'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DefinitionNotFound');
  });

  it('emits no AuditEvent (documented v0 gap — initial session creation has no audited interaction)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, { principal: { kind: 'user', id: 'user_1' } }); // itself audited — captured below, not part of what we're asserting
    const before = server.listAuditEvents().length;

    await server.createConversation(createConversationInputFactory(definition.id));

    expect(server.listAuditEvents()).toHaveLength(before);
  });
});
