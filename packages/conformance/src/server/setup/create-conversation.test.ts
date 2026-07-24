import { conversationSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { authenticatedActorFactory } from '../../factories/authenticated-actor-factory';
import { createConversationInputFactory } from '../../factories/create-conversation-input-factory';
import { registerCredentialInputFactory } from '../../factories/register-credential-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('createConversationSetup (via ReferenceServer.createConversation)', () => {
  it('creates a schema-valid Conversation riding on a freshly minted Session', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, authenticatedActorFactory(server));
    const result = await server.createConversation(createConversationInputFactory(server, definition.id));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(conversationSchema.safeParse(result.value).success).toBe(true);
    expect(result.value.previousSessionIds).toEqual([]);
    expect(server.getSession(result.value.currentSessionId)).toBeDefined();
  });

  it('rejects creating a real Conversation when the definition has never been published, rather than pinning to draftVersion (target-version-resolution.md\'s MUST NOT)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const result = await server.createConversation(createConversationInputFactory(server, definition.id));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.NeverPublished');
  });

  it('pins to publishedVersion once the definition has been published', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, authenticatedActorFactory(server));
    const result = await server.createConversation(createConversationInputFactory(server, definition.id));
    if (!result.ok) throw new Error('setup failed');
    expect(result.value.pinnedAgentVersion.version).toBe(definition.draftVersion);
  });

  it('rejects an unknown agentDefinitionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.createConversation(createConversationInputFactory(server, 'does_not_exist'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DefinitionNotFound');
  });

  // Issue #11 Tranche A: a not-found probe MUST NOT vanish from the trail —
  // this was the one interaction where the not-found precondition returned
  // BEFORE any resource was identified at all, yet still has a caller-supplied
  // `scope` (unlike the other six interactions) to attach to the event.
  it('emits a not_found AuditEvent (not silence) naming the caller-asserted agentDefinitionId, carrying the caller-supplied scope', async () => {
    const { server } = testHarnessFactory();
    const input = createConversationInputFactory(server, 'does_not_exist');

    const result = await server.createConversation(input);
    expect(result.ok).toBe(false);

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      what: 'createConversation',
      outcome: 'not_found',
      scope: input.scope,
      refs: { definitionId: 'does_not_exist' },
    });
  });

  // Issue #7 Tranche A: input.scope MUST be authorized against the actor
  // BEFORE the (nonexistent) definition is even looked up — an actor with
  // no standing in the asserted scope is rejected regardless of whether the
  // target definition exists, so this never reaches the not_found branch
  // above.
  it('rejects createConversation when the actor has no scopeMemberships entry matching input.scope, before the definition lookup', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, authenticatedActorFactory(server));
    const outOfScopeActor = authenticatedActorFactory(server, { registerInput: { scopeMemberships: [{ level: 'workspace', id: 'a_different_workspace' }] } });

    const result = await server.createConversation(createConversationInputFactory(server, definition.id, { actor: outOfScopeActor }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.Unauthorized');

    const events = server.listAuditEvents().filter((e) => e.what === 'createConversation');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('failure');
  });

  // Issue #7 Tranche A: even when the actor IS authorized for input.scope,
  // it must ALSO be authorized for the target AgentDefinition's own scope —
  // neither check substitutes for the other.
  it('rejects createConversation when the actor is authorized for input.scope but not for the target AgentDefinition\'s own scope', async () => {
    const { server } = testHarnessFactory();
    const definitionScope = { level: 'tenant' as const, id: 'tenant_definition_only' };
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory({ scope: definitionScope }));
    await server.publish(definition.id, authenticatedActorFactory(server));
    const conversationScope = { level: 'workspace' as const, id: 'workspace_conversation_only' };
    const actor = authenticatedActorFactory(server, { registerInput: { scopeMemberships: [conversationScope] } });

    const result = await server.createConversation(createConversationInputFactory(server, definition.id, { scope: conversationScope, actor }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.Unauthorized');
  });

  it('emits a createConversation AuditEvent naming the conversation, session, and initiating principal (S4: closes the v0 gap)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const principal = server.registerPrincipal({ kind: 'user', subject: 'user_42', scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }], roles: [] });
    const authenticated = server.authenticate({ principalId: principal.id });
    if (!authenticated.ok) throw new Error('setup failed');
    await server.publish(definition.id, authenticatedActorFactory(server)); // itself audited — captured below, not part of what we're asserting
    const before = server.listAuditEvents().length;

    const result = await server.createConversation(createConversationInputFactory(server, definition.id, { actor: authenticated.value }));
    if (!result.ok) throw new Error('setup failed');

    const emitted = server.listAuditEvents().slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      who: { principal: { kind: 'user', id: principal.id } },
      what: 'createConversation',
      scope: result.value.scope,
      outcome: 'success',
      refs: { conversationId: result.value.id, sessionId: result.value.currentSessionId },
      evidence: { agentVersionRef: result.value.pinnedAgentVersion },
    });
    // Conversation.initiatingPrincipal MUST equal the emitted who.principal — the
    // two identity sources can never independently drift (see create-conversation.ts).
    expect(result.value.initiatingPrincipal).toEqual({ kind: 'user', id: principal.id });
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
    await server.publish(definition.id, authenticatedActorFactory(server));
    const before = server.listAuditEvents().length;

    await server.createConversation(createConversationInputFactory(server, definition.id));

    const emitted = server.listAuditEvents().slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.refs.credentialIds).toEqual([credential.id]);
  });

  it('emits a failure-outcome createConversation AuditEvent, not silence, when rejecting a never-published definition', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const before = server.listAuditEvents().length;

    const result = await server.createConversation(createConversationInputFactory(server, definition.id));
    expect(result.ok).toBe(false);

    const emitted = server.listAuditEvents().slice(before);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ what: 'createConversation', outcome: 'failure' });
  });
});
