import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { createConversationInputFactory } from '../../factories/create-conversation-input-factory';
import { registerCredentialInputFactory } from '../../factories/register-credential-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('migrate — preconditions', () => {
  // NOTE on the "leave in place" precondition (a never-published AgentDefinition):
  // `resolveTargetVersion('real', definition)` returning `null` for this case — and
  // `migrateInteraction`'s handling of that `null` as a successful no-op — are still
  // fully covered: see `target-version/resolve-target-version.test.ts` ("resolves to
  // null... never falling back to draftVersion") for the pure-function coverage, and
  // `conformance/checks/server/run-server-checks.ts`'s
  // `checkCreateConversationRejectsNeverPublishedDefinition` for the enforcement point.
  // An integration-level test *here* that constructs a real Conversation pinned to a
  // never-published definition is no longer possible to write: per the dev lead's
  // sign-off on `create-conversation.ts` (SHOULD-fix, aligning with
  // target-version-resolution.md's MUST NOT), `createConversation` now REJECTS that
  // exact state instead of falling back to `draftVersion`. Since `publishedVersion` is
  // monotonically non-decreasing and v0 has no "unpublish", no real Conversation this
  // server ever successfully creates can later reach this precondition — the branch in
  // `migrate.ts` remains as defensive code (a third-party server's own creation path
  // could still produce this state) but is provably unreachable through this reference
  // server's own public contract, so it is deliberately not exercised via `migrate`
  // here anymore.

  it('is a successful no-op when already pinned to the resolved target version', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());
    const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');
    const before = conversationResult.value; // already pinned to publishedVersion

    const result = await server.migrate(before.id, callerContextFactory());
    expect(result).toEqual({ ok: true, value: before });
  });

  it('rejects an unknown conversationId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.migrate('does_not_exist', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.ConversationNotFound');
  });

  it('emits exactly one AuditEvent{ what: "migrate" } even for a no-op invocation', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, callerContextFactory());
    const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');

    // No intervening draft edit/publish — the conversation is already pinned to the
    // resolved target version, so this is the "already at target" no-op branch.
    await server.migrate(conversationResult.value.id, callerContextFactory());

    const events = server.listAuditEvents().filter((e) => e.what === 'migrate');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'success', scope: conversationResult.value.scope });
  });
});

async function setUpConversationReadyToMigrate() {
  const { server, provider, controls } = testHarnessFactory();
  const definition = await server.createAgentDefinition(
    agentDefinitionInputFactory({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' }],
    }),
  );
  server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/a' }));
  await server.publish(definition.id, callerContextFactory());

  const conversationResult = await server.createConversation(
    createConversationInputFactory(definition.id, { resources: [{ type: 'file', fileId: 'file_shared' }] }),
  );
  if (!conversationResult.ok) throw new Error('setup failed');

  // Exchange one genuine turn before migrating, so the transcript has real content to seed.
  await server.send(conversationResult.value.currentSessionId, 'hello', callerContextFactory());

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, callerContextFactory());

  return { server, provider, controls, definition, conversation: conversationResult.value };
}

describe('migrate — Stage 1: mint session at target version', () => {
  it('mints a new session pinned to exactly the resolved target version (version pinning preserved)', async () => {
    const { server, definition, conversation } = await setUpConversationReadyToMigrate();

    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.pinnedAgentVersion).toEqual({ agentDefinitionId: definition.id, version: definition.draftVersion + 1 });
    const newSession = server.getSession(result.value.currentSessionId);
    expect(newSession?.pinnedAgentVersion).toEqual(result.value.pinnedAgentVersion);
  });

  it('re-attaches the outgoing session\'s resources fresh (mount count increases — not aliased)', async () => {
    const { server, controls, conversation } = await setUpConversationReadyToMigrate();
    const before = controls.getResourceMountCount('file:file_shared');

    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);

    expect(controls.getResourceMountCount('file:file_shared')).toBe(before + 1);
    if (!result.ok) return;
    const newSession = server.getSession(result.value.currentSessionId);
    expect(newSession?.resources).toEqual([{ type: 'file', fileId: 'file_shared' }]);
  });

  it('re-resolves vaultIds against the target version\'s tool grants (not copied from the outgoing session)', async () => {
    const { server, conversation } = await setUpConversationReadyToMigrate();
    const outgoingSession = server.getSession(conversation.currentSessionId);
    expect(outgoingSession?.vaultIds).toHaveLength(1); // the credential-requiring mcp grant resolved at creation

    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newSession = server.getSession(result.value.currentSessionId);
    expect(newSession?.vaultIds).toHaveLength(1);
    expect(newSession?.vaultIds).toEqual(outgoingSession?.vaultIds); // same credential still matches; re-resolved, not aliased
  });
});

describe('migrate — Stage 4: atomic swap + lineage append', () => {
  it('appends the outgoing session id to previousSessionIds, oldest-first', async () => {
    const { server, conversation } = await setUpConversationReadyToMigrate();
    const originalSessionId = conversation.currentSessionId;

    const first = await server.migrate(conversation.id, callerContextFactory());
    if (!first.ok) throw new Error('migrate failed');
    expect(first.value.previousSessionIds).toEqual([originalSessionId]);

    const secondSessionId = first.value.currentSessionId;
    const definitionId = conversation.pinnedAgentVersion.agentDefinitionId;
    await server.editAgentDefinitionDraft(definitionId);
    await server.publish(definitionId, callerContextFactory());

    const second = await server.migrate(conversation.id, callerContextFactory());
    if (!second.ok) throw new Error('migrate failed');
    expect(second.value.previousSessionIds).toEqual([originalSessionId, secondSessionId]);
  });

  it('never disturbs currentSessionId until the new session is idle: a caller only ever observes the fully-swapped state', async () => {
    const { server, conversation } = await setUpConversationReadyToMigrate();
    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // getConversation returns either the pre- or fully-post-migrate state, never a partial one.
    const stored = server.getConversation(conversation.id);
    expect(stored?.currentSessionId).toBe(result.value.currentSessionId);
    expect(stored?.pinnedAgentVersion).toEqual(result.value.pinnedAgentVersion);
  });

  it('serializes two concurrent migrate calls on the same Conversation without losing a lineage entry', async () => {
    const { server, conversation, definition } = await setUpConversationReadyToMigrate();
    const originalSessionId = conversation.currentSessionId;

    // Prepare a second version bump so the second migrate (once it runs) has somewhere to go too.
    await server.editAgentDefinitionDraft(definition.id);
    await server.publish(definition.id, callerContextFactory());

    const [first, second] = await Promise.all([
      server.migrate(conversation.id, callerContextFactory()),
      server.migrate(conversation.id, callerContextFactory()),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const finalConversation = server.getConversation(conversation.id);
    // Exactly one lineage entry per genuine session change; the outgoing original session
    // must appear exactly once, never duplicated or dropped by the race.
    expect(finalConversation?.previousSessionIds.filter((id) => id === originalSessionId)).toHaveLength(1);
  });
});

describe('migrate — Stage 2: transcript seeding, non-compounding, degrade-to-fresh-start', () => {
  it('seeds the new session\'s transcript from the outgoing session\'s content, without an unsolicited fresh assistant turn', async () => {
    const { server, provider, conversation } = await setUpConversationReadyToMigrate();

    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seeded = await provider.listSessionEvents(result.value.currentSessionId);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    // The seeded transcript carries the prior exchange's content...
    expect(seeded.value.events.some((e) => e.type === 'assistant_message_end')).toBe(true);
    // ...but produced no *new* unsolicited assistant_message_start beyond what was seeded:
    // the mock provider never appends a spontaneous reply to a seed-only session, so the
    // seeded count matches exactly what the outgoing transcript held.
    const outgoing = await provider.listSessionEvents(conversation.currentSessionId);
    if (!outgoing.ok) return;
    expect(seeded.value.events).toHaveLength(outgoing.value.events.length);
  });

  it('is non-compounding: repeated migrations with no intervening genuine turns keep a constant seed size', async () => {
    const { server, provider, conversation, definition } = await setUpConversationReadyToMigrate();

    const first = await server.migrate(conversation.id, callerContextFactory());
    if (!first.ok) throw new Error('migrate failed');
    const firstSeeded = await provider.listSessionEvents(first.value.currentSessionId);
    if (!firstSeeded.ok) throw new Error('setup failed');
    const firstCount = firstSeeded.value.events.length;

    await server.editAgentDefinitionDraft(definition.id);
    await server.publish(definition.id, callerContextFactory());
    const second = await server.migrate(conversation.id, callerContextFactory());
    if (!second.ok) throw new Error('migrate failed');
    const secondSeeded = await provider.listSessionEvents(second.value.currentSessionId);
    if (!secondSeeded.ok) throw new Error('setup failed');

    await server.editAgentDefinitionDraft(definition.id);
    await server.publish(definition.id, callerContextFactory());
    const third = await server.migrate(conversation.id, callerContextFactory());
    if (!third.ok) throw new Error('migrate failed');
    const thirdSeeded = await provider.listSessionEvents(third.value.currentSessionId);
    if (!thirdSeeded.ok) throw new Error('setup failed');

    // No new genuine turns were sent between migrations — the seed must not grow.
    expect(secondSeeded.value.events).toHaveLength(firstCount);
    expect(thirdSeeded.value.events).toHaveLength(firstCount);
  });

  it('degrades to a fresh start (empty seed) when the transcript fetch fails, without failing migrate', async () => {
    const { server, provider, controls, conversation } = await setUpConversationReadyToMigrate();
    controls.induceTranscriptFetchFailureOnce(conversation.currentSessionId);

    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seeded = await provider.listSessionEvents(result.value.currentSessionId);
    expect(seeded.ok && seeded.value.events).toEqual([]);

    const events = server.listAuditEvents().filter((e) => e.what === 'migrate');
    expect(events[events.length - 1]?.outcome).toBe('success');
  });
});

describe('migrate — Stage 3: drain to idle', () => {
  it('confirms the newly minted session is idle before exposing it (baseline: no pending tool calls after a clean seed)', async () => {
    const { server, provider, conversation } = await setUpConversationReadyToMigrate();
    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const status = await provider.getSessionStatus(result.value.currentSessionId);
    expect(status).toEqual({ ok: true, value: 'idle' });
  });

  it('runs drain against a newly minted session that starts parked on a pending tool call, resolving it before the swap', async () => {
    const { server, provider, controls, conversation } = await setUpConversationReadyToMigrate();
    controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_carried', name: 'resume', input: {} });

    const result = await server.migrate(conversation.id, callerContextFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const status = await provider.getSessionStatus(result.value.currentSessionId);
    expect(status).toEqual({ ok: true, value: 'idle' });
    const pending = await provider.getPendingToolCalls(result.value.currentSessionId);
    expect(pending).toEqual({ ok: true, value: [] });
  });
});
