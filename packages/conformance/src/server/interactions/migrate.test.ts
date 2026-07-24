import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { authenticatedActorFactory } from '../../factories/authenticated-actor-factory';
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
    await server.publish(definition.id, authenticatedActorFactory(server));
    const conversationResult = await server.createConversation(createConversationInputFactory(server, definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');
    const before = conversationResult.value; // already pinned to publishedVersion

    const result = await server.migrate(before.id, authenticatedActorFactory(server));
    expect(result).toEqual({ ok: true, value: before });
  });

  it('rejects an unknown conversationId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.migrate('does_not_exist', authenticatedActorFactory(server));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.ConversationNotFound');
  });

  // Issue #11 Tranche A: a not-found probe MUST NOT vanish from the trail.
  it('emits a not_found AuditEvent (not silence) naming the caller-asserted conversationId, with no fabricated scope', async () => {
    const { server } = testHarnessFactory();
    await server.migrate('does_not_exist', authenticatedActorFactory(server));

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ what: 'migrate', outcome: 'not_found', refs: { conversationId: 'does_not_exist' } });
    expect(events[0] && 'scope' in events[0]).toBe(false);
  });

  it('emits exactly one AuditEvent{ what: "migrate" } even for a no-op invocation', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    await server.publish(definition.id, authenticatedActorFactory(server));
    const conversationResult = await server.createConversation(createConversationInputFactory(server, definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');

    // No intervening draft edit/publish — the conversation is already pinned to the
    // resolved target version, so this is the "already at target" no-op branch.
    await server.migrate(conversationResult.value.id, authenticatedActorFactory(server));

    const events = server.listAuditEvents().filter((e) => e.what === 'migrate');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'success',
      scope: conversationResult.value.scope,
      evidence: { agentVersionRef: conversationResult.value.pinnedAgentVersion },
    });
  });
});

async function setUpConversationReadyToMigrate() {
  const { server, provider, controls } = testHarnessFactory();
  const definition = await server.createAgentDefinition(
    agentDefinitionInputFactory({
      // The mcp grant exercises credential re-resolution (Stage 1); the
      // custom 'resume' grant authorizes the pending tool call some Stage-3
      // tests below carry onto the newly minted session via
      // `queuePendingToolCallForNextSession` — `drain` now authorizes every
      // pending call against the pinned AgentDefinition's granted tools
      // (issue #9), so this override (which replaces the factory's own
      // default 'lookup' grant entirely) must grant what it actually uses.
      tools: [
        { type: 'mcp', serverUrl: 'https://mcp.example.com/a', label: 'A', auth: 'credential', permissionPolicy: 'always_allow' },
        { type: 'custom', name: 'resume', description: 'Resumes a prior task.', inputSchema: {} },
      ],
    }),
  );
  server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/a' }));
  await server.publish(definition.id, authenticatedActorFactory(server));

  const conversationResult = await server.createConversation(
    createConversationInputFactory(server, definition.id, { resources: [{ type: 'file', fileId: 'file_shared' }] }),
  );
  if (!conversationResult.ok) throw new Error('setup failed');

  // Exchange one genuine turn before migrating, so the transcript has real content to seed.
  await server.send(conversationResult.value.currentSessionId, 'hello', authenticatedActorFactory(server));

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, authenticatedActorFactory(server));

  return { server, provider, controls, definition, conversation: conversationResult.value };
}

describe('migrate — Stage 1: mint session at target version', () => {
  it('mints a new session pinned to exactly the resolved target version (version pinning preserved)', async () => {
    const { server, definition, conversation } = await setUpConversationReadyToMigrate();

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.pinnedAgentVersion).toEqual({ agentDefinitionId: definition.id, version: definition.draftVersion + 1 });
    const newSession = server.getSession(result.value.currentSessionId);
    expect(newSession?.pinnedAgentVersion).toEqual(result.value.pinnedAgentVersion);
  });

  it('re-attaches the outgoing session\'s resources fresh (mount count increases — not aliased)', async () => {
    const { server, controls, conversation } = await setUpConversationReadyToMigrate();
    const before = controls.getResourceMountCount('file:file_shared');

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
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

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newSession = server.getSession(result.value.currentSessionId);
    expect(newSession?.vaultIds).toHaveLength(1);
    expect(newSession?.vaultIds).toEqual(outgoingSession?.vaultIds); // same credential still matches; re-resolved, not aliased
  });

  // Issue #10: before the per-version content snapshot store existed, Stage 1
  // re-resolved vaultIds against the LIVE `AgentDefinition.tools` — which,
  // before this slice, could never actually differ between the outgoing and
  // target version, because `editAgentDefinitionDraftSetup` only ever bumped
  // the integer and never changed content (see that setup helper's pre-#10
  // doc comment). This test exercises a migrate where v1 and v2 grant
  // MATERIALLY DIFFERENT — entirely disjoint — mcp servers/credentials, AND
  // leaves an UNPUBLISHED v3 draft edit in place (granting yet a THIRD,
  // disjoint server) before calling migrate — so the migrate-to-v2 call's
  // target (v2, published) and the LIVE `AgentDefinition` (v3, draft-only)
  // genuinely diverge at the moment migrate runs. A live-read implementation
  // (the pre-#10 bug) would resolve v3's credential here; a snapshot-based
  // one resolves v2's — this is what actually discriminates the fix from the
  // bug, not just "content differs somewhere."
  it('resolves a MATERIALLY DIFFERENT tool grant/credential for the target version, not the outgoing version\'s — and not a later unpublished draft\'s either (AC#6: a genuine content change across versions)', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(
      agentDefinitionInputFactory({
        tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/v1-only', label: 'V1', auth: 'credential', permissionPolicy: 'always_allow' }],
      }),
    );
    const credentialV1 = server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/v1-only' }));
    await server.publish(definition.id, authenticatedActorFactory(server));

    const conversationResult = await server.createConversation(createConversationInputFactory(server, definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');
    const outgoingSession = server.getSession(conversationResult.value.currentSessionId);
    expect(outgoingSession?.vaultIds).toEqual([credentialV1.id]);

    // v2 grants a DIFFERENT mcp server entirely — v1's grant is gone, not merely added-to.
    const credentialV2 = server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/v2-only' }));
    await server.editAgentDefinitionDraft(definition.id, {
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/v2-only', label: 'V2', auth: 'credential', permissionPolicy: 'always_allow' }],
    });
    await server.publish(definition.id, authenticatedActorFactory(server));

    // v3: a THIRD, disjoint grant — drafted but deliberately never published.
    // The migrate below targets v2 (the current publishedVersion); the LIVE
    // AgentDefinition is now v3. If migrate resolved live content instead of
    // v2's snapshot, it would wrongly pick up v3's credential here.
    const credentialV3 = server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/v3-draft-only' }));
    await server.editAgentDefinitionDraft(definition.id, {
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/v3-draft-only', label: 'V3', auth: 'credential', permissionPolicy: 'always_allow' }],
    });
    expect(server.getAgentDefinition(definition.id)?.publishedVersion).toBe(2); // v3 is drafted, not published

    const result = await server.migrate(conversationResult.value.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.pinnedAgentVersion.version).toBe(2);
    const newSession = server.getSession(result.value.currentSessionId);
    expect(newSession?.vaultIds).toEqual([credentialV2.id]);
    expect(newSession?.vaultIds).not.toEqual(outgoingSession?.vaultIds);
    expect(newSession?.vaultIds).not.toEqual([credentialV3.id]);

    // The OUTGOING (v1-pinned) session is untouched: still resolves only to
    // v1's credential, confirming the version snapshot the outgoing session
    // was minted against was never itself mutated by later draft edits.
    expect(server.getSession(conversationResult.value.currentSessionId)?.vaultIds).toEqual([credentialV1.id]);
  });
});

describe('migrate — Stage 4: atomic swap + lineage append', () => {
  it('appends the outgoing session id to previousSessionIds, oldest-first', async () => {
    const { server, conversation } = await setUpConversationReadyToMigrate();
    const originalSessionId = conversation.currentSessionId;

    const first = await server.migrate(conversation.id, authenticatedActorFactory(server));
    if (!first.ok) throw new Error('migrate failed');
    expect(first.value.previousSessionIds).toEqual([originalSessionId]);

    const secondSessionId = first.value.currentSessionId;
    const definitionId = conversation.pinnedAgentVersion.agentDefinitionId;
    await server.editAgentDefinitionDraft(definitionId);
    await server.publish(definitionId, authenticatedActorFactory(server));

    const second = await server.migrate(conversation.id, authenticatedActorFactory(server));
    if (!second.ok) throw new Error('migrate failed');
    expect(second.value.previousSessionIds).toEqual([originalSessionId, secondSessionId]);
  });

  it('never disturbs currentSessionId until the new session is idle: a caller only ever observes the fully-swapped state', async () => {
    const { server, conversation } = await setUpConversationReadyToMigrate();
    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
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
    await server.publish(definition.id, authenticatedActorFactory(server));

    const [first, second] = await Promise.all([
      server.migrate(conversation.id, authenticatedActorFactory(server)),
      server.migrate(conversation.id, authenticatedActorFactory(server)),
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

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
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

    // A normal, full-seed migrate MUST NOT be flagged degraded — issue #12's
    // companion assertion: only an induced transcript-fetch failure sets it.
    const events = server.listAuditEvents().filter((e) => e.what === 'migrate');
    expect(events[events.length - 1]?.degraded).not.toBe(true);
  });

  it('is non-compounding: repeated migrations with no intervening genuine turns keep a constant seed size', async () => {
    const { server, provider, conversation, definition } = await setUpConversationReadyToMigrate();

    const first = await server.migrate(conversation.id, authenticatedActorFactory(server));
    if (!first.ok) throw new Error('migrate failed');
    const firstSeeded = await provider.listSessionEvents(first.value.currentSessionId);
    if (!firstSeeded.ok) throw new Error('setup failed');
    const firstCount = firstSeeded.value.events.length;

    await server.editAgentDefinitionDraft(definition.id);
    await server.publish(definition.id, authenticatedActorFactory(server));
    const second = await server.migrate(conversation.id, authenticatedActorFactory(server));
    if (!second.ok) throw new Error('migrate failed');
    const secondSeeded = await provider.listSessionEvents(second.value.currentSessionId);
    if (!secondSeeded.ok) throw new Error('setup failed');

    await server.editAgentDefinitionDraft(definition.id);
    await server.publish(definition.id, authenticatedActorFactory(server));
    const third = await server.migrate(conversation.id, authenticatedActorFactory(server));
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

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seeded = await provider.listSessionEvents(result.value.currentSessionId);
    expect(seeded.ok && seeded.value.events).toEqual([]);

    // Issue #12: a degraded migrate MUST be distinguishable from a normal one
    // in the audit trail — `outcome: 'success'` alone is ambiguous between the two.
    const events = server.listAuditEvents().filter((e) => e.what === 'migrate');
    expect(events[events.length - 1]?.outcome).toBe('success');
    expect(events[events.length - 1]?.degraded).toBe(true);
  });
});

describe('migrate — Stage 3: drain to idle', () => {
  it('confirms the newly minted session is idle before exposing it (baseline: no pending tool calls after a clean seed)', async () => {
    const { server, provider, conversation } = await setUpConversationReadyToMigrate();
    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const status = await provider.getSessionStatus(result.value.currentSessionId);
    expect(status).toEqual({ ok: true, value: 'idle' });
  });

  it('runs drain against a newly minted session that starts parked on a pending tool call, resolving it before the swap', async () => {
    const { server, provider, controls, conversation } = await setUpConversationReadyToMigrate();
    controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_carried', name: 'resume', input: {} });

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const status = await provider.getSessionStatus(result.value.currentSessionId);
    expect(status).toEqual({ ok: true, value: 'idle' });
    const pending = await provider.getPendingToolCalls(result.value.currentSessionId);
    expect(pending).toEqual({ ok: true, value: [] });
  });

  it('rejects the swap when the newly minted session remains "running" after drain, leaving currentSessionId unchanged', async () => {
    const { server, controls, conversation } = await setUpConversationReadyToMigrate();
    const outgoingSessionId = conversation.currentSessionId;
    controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_carried', name: 'resume', input: {} });
    controls.forceNextSessionToStayRunningAfterDrain();

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DrainFailed');

    // The still-running newly minted session must never have been swapped in.
    const stored = server.getConversation(conversation.id);
    expect(stored?.currentSessionId).toBe(outgoingSessionId);
  });

  // Issue #9 landed pre-dispatch tool-call authorization for `drain`, reused
  // by migrate's Stage 3 (see migrate.ts's Stage 3 doc comment). This proves
  // that failure path — new since the #11 brief was scoped — was already
  // audited before this slice (`migrateInteraction`'s `drainResult.ok`
  // failure branch unconditionally emits before returning): a carried-over
  // pending tool call the target version does NOT grant must reject the
  // migrate and still leave a failure AuditEvent, never silence.
  it('rejects (and audits) a carried-over pending tool call the target version does not grant, leaving currentSessionId unchanged', async () => {
    const { server, controls, conversation } = await setUpConversationReadyToMigrate();
    const outgoingSessionId = conversation.currentSessionId;
    // 'delete_everything' is not among setUpConversationReadyToMigrate's granted
    // tools (mcp 'a' and custom 'resume') — an unauthorized call, not a mere
    // "still running" drain failure like the sibling test above.
    controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_unlisted', name: 'delete_everything', input: {} });

    const result = await server.migrate(conversation.id, authenticatedActorFactory(server));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');

    const stored = server.getConversation(conversation.id);
    expect(stored?.currentSessionId).toBe(outgoingSessionId);

    const events = server.listAuditEvents().filter((e) => e.what === 'migrate');
    expect(events[events.length - 1]?.outcome).toBe('failure');
  });
});
