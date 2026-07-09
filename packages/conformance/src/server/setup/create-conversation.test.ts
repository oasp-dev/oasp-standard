import { conversationSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { createConversationInputFactory } from '../../factories/create-conversation-input-factory';
import { registerCredentialInputFactory } from '../../factories/register-credential-input-factory';
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

  it('emits a createConversation AuditEvent naming the conversation, session, and initiating principal (S4: closes the v0 gap)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const initiatingPrincipal = { kind: 'user' as const, id: 'user_42' };
    await server.publish(definition.id, { principal: { kind: 'user', id: 'user_1' } }); // itself audited — captured below, not part of what we're asserting
    const before = server.listAuditEvents().length;

    const result = await server.createConversation(createConversationInputFactory(definition.id, { initiatingPrincipal }));
    if (!result.ok) throw new Error('setup failed');

    const emitted = server.listAuditEvents().slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      who: { principal: initiatingPrincipal },
      what: 'createConversation',
      scope: result.value.scope,
      outcome: 'success',
      refs: { conversationId: result.value.id, sessionId: result.value.currentSessionId },
    });
  });

  it('names every attached Credential via refs.credentialIds on the emitted createConversation AuditEvent', async () => {
    const { server } = testHarnessFactory();
    const mcpServerUrl = 'https://mcp.example.com/create-conversation-test';
    const definition = await server.createAgentDefinition(
      agentDefinitionInputFactory({
        tools: [{ type: 'mcp', serverUrl: mcpServerUrl, label: 'Test MCP', auth: 'credential', permissionPolicy: 'always_allow' }],
      }),
    );
    const credential = server.registerCredential(registerCredentialInputFactory({ scope: definition.scope, mcpServerUrl }));
    await server.publish(definition.id, { principal: { kind: 'user', id: 'user_1' } });
    const before = server.listAuditEvents().length;

    await server.createConversation(createConversationInputFactory(definition.id));

    const emitted = server.listAuditEvents().slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.refs.credentialIds).toEqual([credential.id]);
  });

  it('emits a failure-outcome createConversation AuditEvent, not silence, when rejecting a never-published definition', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const before = server.listAuditEvents().length;

    const result = await server.createConversation(createConversationInputFactory(definition.id));
    expect(result.ok).toBe(false);

    const emitted = server.listAuditEvents().slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ what: 'createConversation', outcome: 'failure' });
  });
});
