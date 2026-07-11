import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('publish', () => {
  it('sets publishedVersion to the current draftVersion', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    expect(definition.publishedVersion).toBeNull();

    const result = await server.publish(definition.id, callerContextFactory());
    expect(result).toEqual({ ok: true, value: { ...definition, publishedVersion: definition.draftVersion } });
  });

  it('does not disturb any live Conversation pinned to a different version', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());
    const conversationResult = await server.createConversation({
      agentDefinitionId: definition.id,
      scope: { level: 'workspace', id: 'workspace_1' },
      initiatingPrincipal: { kind: 'user', id: 'user_1' },
    });
    if (!conversationResult.ok) throw new Error('setup failed');
    const before = server.getConversation(conversationResult.value.id);

    // Publish again (draftVersion unchanged) — must not touch the live conversation.
    await server.publish(definition.id, callerContextFactory());

    expect(server.getConversation(conversationResult.value.id)).toEqual(before);
  });

  it('is idempotent: repeat calls with no intervening draft edit do not error and keep publishedVersion stable', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const first = await server.publish(definition.id, callerContextFactory());
    const second = await server.publish(definition.id, callerContextFactory());
    expect(first.ok && second.ok && first.value.publishedVersion === second.value.publishedVersion).toBe(true);
  });

  it('rejects an unknown definitionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.publish('does_not_exist', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DefinitionNotFound');
  });

  it('emits exactly one AuditEvent{ what: "publish" } with refs.definitionId and the definition scope', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ what: 'publish', outcome: 'success', scope: definition.scope, refs: { definitionId: definition.id } });
  });

  // Issue #11 Tranche A: a not-found probe MUST NOT vanish from the trail.
  it('emits a not_found AuditEvent (not silence) naming the caller-asserted definitionId, with no fabricated scope', async () => {
    const { server } = testHarnessFactory();

    const result = await server.publish('does_not_exist', callerContextFactory());
    expect(result.ok).toBe(false);

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ what: 'publish', outcome: 'not_found', refs: { definitionId: 'does_not_exist' } });
    expect(events[0] && 'scope' in events[0]).toBe(false);
  });
});
