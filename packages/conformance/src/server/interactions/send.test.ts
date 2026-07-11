import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { createConversationInputFactory } from '../../factories/create-conversation-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';
import { computeContentDigest } from '../audit/compute-content-digest';

describe('send', () => {
  it('posts content into the target session', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.send(sessionResult.value.id, 'hello', callerContextFactory());
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('allows send against a builder/test-session (no bound Conversation) unconditionally', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const testSessionResult = await server.createTestSession(definition.id);
    if (!testSessionResult.ok) throw new Error('setup failed');

    const result = await server.send(testSessionResult.value.id, 'hello', callerContextFactory());
    expect(result.ok).toBe(true);
  });

  it('accepts send against the Conversation\'s current session', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());
    const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');

    const result = await server.send(conversationResult.value.currentSessionId, 'hello', callerContextFactory());
    expect(result.ok).toBe(true);
  });

  it('rejects send against a session superseded by migrate (no longer currentSessionId)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());
    const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');
    const originalSessionId = conversationResult.value.currentSessionId;

    // Advance the definition to a genuinely new published version, then migrate the
    // conversation onto it — this is what actually supersedes originalSessionId.
    await server.editAgentDefinitionDraft(definition.id);
    await server.publish(definition.id, callerContextFactory());
    const migrateResult = await server.migrate(conversationResult.value.id, callerContextFactory());
    if (!migrateResult.ok) throw new Error('setup failed');
    expect(migrateResult.value.currentSessionId).not.toBe(originalSessionId);

    const result = await server.send(originalSessionId, 'hello', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.SessionNotCurrent');
  });

  it('rejects an unknown sessionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.send('does_not_exist', 'hello', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.SessionNotFound');
  });

  // Issue #11 Tranche A: a not-found probe MUST NOT vanish from the trail.
  // The caller-supplied content is known regardless of whether a Session
  // exists to receive it, so evidence.contentDigest is populated even here.
  it('emits a not_found AuditEvent (not silence) naming the caller-asserted sessionId, with no fabricated scope, but still carrying the content digest', async () => {
    const { server } = testHarnessFactory();
    await server.send('does_not_exist', 'hello', callerContextFactory());

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      what: 'send',
      outcome: 'not_found',
      refs: { sessionId: 'does_not_exist' },
      evidence: { contentDigest: computeContentDigest('hello') },
    });
    expect(events[0] && 'scope' in events[0]).toBe(false);
  });

  it('emits exactly one AuditEvent{ what: "send" } scoped to the Conversation when bound', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());
    const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');

    await server.send(conversationResult.value.currentSessionId, 'hello', callerContextFactory());

    const sendEvents = server.listAuditEvents().filter((e) => e.what === 'send');
    expect(sendEvents).toHaveLength(1);
    expect(sendEvents[0]).toMatchObject({
      outcome: 'success',
      scope: conversationResult.value.scope,
      refs: { sessionId: conversationResult.value.currentSessionId },
      evidence: { contentDigest: computeContentDigest('hello'), agentVersionRef: conversationResult.value.pinnedAgentVersion },
    });
  });
});
