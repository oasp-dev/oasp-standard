import { agentDefinitionInputFactory } from '../../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../../factories/caller-context-factory';
import { createConversationInputFactory } from '../../../factories/create-conversation-input-factory';
import { registerCredentialInputFactory } from '../../../factories/register-credential-input-factory';
import type { MockProviderControls } from '../../../mock/mock-provider-controls.types';
import type { ReferenceServer } from '../../../server/reference-server.types';
import { mockSentinels } from '../../../mock/mock-sentinels';
import { failed, passed, type CheckResult } from '../../check-result.types';

/** Counts the TRUE stored history of a Session via the server's own `listSessionEvents` — the full-history read `docs/spec/interactions.md` § `stream` names as the normative derive-on-read fallback/audit source. Deliberately never uses `stream()`: that primitive reproduces SSE semantics and terminates at the session's first `status: 'idle'` Event, so it is blind to content stored after that point — see the non-compounding check below for why that distinction has teeth. */
async function countStoredEvents(server: ReferenceServer, sessionId: string): Promise<number> {
  const result = await server.listSessionEvents(sessionId);
  return result.ok ? result.value.events.length : -1;
}

async function checkVersionPinningPreserved(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: Conversation.pinnedAgentVersion matches its current Session.pinnedAgentVersion';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);

  const session = server.getSession(conversationResult.value.currentSessionId);
  if (!session) return failed(name, 'session not found');
  return session.pinnedAgentVersion.version === conversationResult.value.pinnedAgentVersion.version
    ? passed(name)
    : failed(name, `session pinned to v${session.pinnedAgentVersion.version}, conversation reports v${conversationResult.value.pinnedAgentVersion.version}`);
}

/**
 * `docs/spec/resources.md`'s core normative requirement, exercised
 * black-box against a real server rather than only at the schema level
 * (`resource-type-guard.test.ts` in `@oasp/schemas` already guards the
 * schema *sources*; this proves a running server actually emits the
 * discriminator on its wire responses, which a schema-level guard alone
 * cannot catch — e.g. a server that hand-assembles a response object
 * bypassing the schema entirely). Every resource this drive touches —
 * the created `AgentDefinition`, the `Conversation` `createConversation`
 * returns, and the `Session` it mints — MUST carry `resourceType` equal
 * to its own PascalCase resource name.
 */
async function checkResourceTypeDiscriminator(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: every resource response carries a resourceType equal to its own resource name';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  if (definition.resourceType !== 'AgentDefinition') {
    return failed(name, `AgentDefinition.resourceType was ${JSON.stringify(definition.resourceType)}, expected "AgentDefinition"`);
  }

  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  if (conversationResult.value.resourceType !== 'Conversation') {
    return failed(name, `Conversation.resourceType was ${JSON.stringify(conversationResult.value.resourceType)}, expected "Conversation"`);
  }

  const session = server.getSession(conversationResult.value.currentSessionId);
  if (!session) return failed(name, 'session not found');
  if (session.resourceType !== 'Session') {
    return failed(name, `Session.resourceType was ${JSON.stringify(session.resourceType)}, expected "Session"`);
  }

  return passed(name);
}

/**
 * Drives a Conversation through TWO migrations (not one) and asserts
 * the FULL ordered `previousSessionIds` — append vs. prepend are
 * indistinguishable with a single-element list, so one migration alone
 * cannot catch a server that reorders the lineage instead of appending
 * to it.
 */
async function checkLineageAppendOnlyOldestFirst(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: migrate appends to previousSessionIds, oldest-first, across repeated migrations (never reordered)';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  const originalSessionId = conversationResult.value.currentSessionId;

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const first = await server.migrate(conversationResult.value.id, caller);
  if (!first.ok) return failed(name, first.error.message);
  const secondSessionId = first.value.currentSessionId;

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const second = await server.migrate(conversationResult.value.id, caller);
  if (!second.ok) return failed(name, second.error.message);

  const expected = [originalSessionId, secondSessionId];
  return JSON.stringify(second.value.previousSessionIds) === JSON.stringify(expected)
    ? passed(name)
    : failed(name, `expected previousSessionIds=${JSON.stringify(expected)}, got ${JSON.stringify(second.value.previousSessionIds)}`);
}

/**
 * Drives three migrations with no genuine turns in between and asserts
 * the TRUE stored history (via `listSessionEvents`, never `stream()`)
 * stays constant. Measuring via `stream()` is exactly what made the
 * prior version of this check toothless: `stream()` terminates at the
 * session's first `status: 'idle'` Event, whose *position* in a
 * compounding transcript stays constant even while the transcript's
 * *total stored length* silently doubles on every migration — so a
 * server that nests/duplicates seed content on each migrate reports
 * the same small stream-event count every time and slips through.
 */
async function checkMigrateNonCompounding(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: migrate is non-compounding across repeated calls with no intervening genuine turns (measured via the true stored history, not stream — which halts at idle)';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  await server.send(conversationResult.value.currentSessionId, 'hello', caller);

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const first = await server.migrate(conversationResult.value.id, caller);
  if (!first.ok) return failed(name, first.error.message);
  const firstCount = await countStoredEvents(server, first.value.currentSessionId);

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const second = await server.migrate(conversationResult.value.id, caller);
  if (!second.ok) return failed(name, second.error.message);
  const secondCount = await countStoredEvents(server, second.value.currentSessionId);

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const third = await server.migrate(conversationResult.value.id, caller);
  if (!third.ok) return failed(name, third.error.message);
  const thirdCount = await countStoredEvents(server, third.value.currentSessionId);

  return firstCount === secondCount && secondCount === thirdCount
    ? passed(name)
    : failed(name, `seeded transcript grew across no-op-content migrations: ${firstCount} -> ${secondCount} -> ${thirdCount} stored events`);
}

/**
 * `docs/spec/interactions.md` § `drain` (L355-362): success MUST
 * mean the session is confirmed `idle`, never merely "no error was seen."
 * Exercises both halves of that MUST: the happy path (a parked session
 * drains to idle with its pending tool call resolved), and — the exact
 * Issue #13 defect — a session forced (via `MockProviderControls`) to
 * remain `'running'` even after every one of its pending tool calls has
 * been posted, simulating a chained tool call re-parking it. A server
 * whose `drain` reports success in that second scenario fails this check;
 * without it, the portable kit could not catch the very defect it now
 * exists to certify against.
 */
async function checkDrainResolvesPendingToolCalls(server: ReferenceServer, controls: MockProviderControls): Promise<CheckResult> {
  const name = 'server: drain enumerates and resolves pending tool calls, returning the session to idle — and never reports success while the session remains running';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  const sessionResult = await server.createBuilderSession(definition.id);
  if (!sessionResult.ok) return failed(name, sessionResult.error.message);
  await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, caller);

  const drainResult = await server.drain(sessionResult.value.id, caller);
  if (!drainResult.ok) return failed(name, drainResult.error.message);
  if (drainResult.value.status !== 'idle' || drainResult.value.resolvedToolUseIds.length === 0) {
    return failed(name, `expected idle with resolved tool uses, got ${JSON.stringify(drainResult.value)}`);
  }

  controls.forceNextSessionToStayRunningAfterDrain();
  const stillRunningSession = await server.createBuilderSession(definition.id);
  if (!stillRunningSession.ok) return failed(name, stillRunningSession.error.message);
  await server.send(stillRunningSession.value.id, `${mockSentinels.toolUsePrefix}lookup`, caller);

  const stillRunningDrain = await server.drain(stillRunningSession.value.id, caller);
  return !stillRunningDrain.ok
    ? passed(name)
    : failed(name, `expected drain to fail for a session that remains running after its pending calls are posted, got ${JSON.stringify(stillRunningDrain)}`);
}

/**
 * `docs/spec/interactions.md` § `drain`'s authorization clause (issue
 * #9): a server MUST reject — before ever invoking a tool dispatcher —
 * a pending tool call not covered by the Session's pinned
 * `AgentDefinition` version's granted `tools`: entirely unlisted, from
 * an MCP server not granted at all, or excluded by a granted MCP
 * server's `toolAllowlist`. Exercises all three rejection paths plus
 * two authorized baselines: (d) a genuinely granted MCP call still
 * drains to idle, and (e) — the clause's builtin-toolset carve-out —
 * a granted `builtin_toolset` authorizes ANY unattributed call (one
 * reporting no MCP origin) regardless of its name, because OASP v0
 * does not enumerate the concrete tool names a provider's builtin
 * toolsets expose. Both baselines are load-bearing: without (e), a
 * third-party server could unknowingly diverge by rejecting builtin
 * calls the clause requires it to allow, and the very same call
 * rejected in (a) (no grants at all) succeeding in (e) (builtin
 * granted) is what pins the carve-out boundary down exactly. A server
 * that (incorrectly) executes every enumerated call regardless of the
 * pinned Definition's grants would pass every OTHER check in this
 * file yet fail this one.
 */
async function checkDrainRejectsUnauthorizedToolCalls(server: ReferenceServer, controls: MockProviderControls): Promise<CheckResult> {
  const name = "server: drain rejects a pending tool call not authorized by the pinned AgentDefinition (unlisted tool, wrong MCP server origin, or toolAllowlist exclusion), before any dispatch — and still drains a granted MCP call and, via the builtin-toolset carve-out, any unattributed call";
  const caller = callerContextFactory();

  // (a) Entirely unlisted: nothing granted at all.
  const bareDefinition = await server.createAgentDefinition(agentDefinitionInputFactory({ tools: [] }));
  controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_unlisted', name: 'delete_everything', input: {} });
  const unlistedSession = await server.createBuilderSession(bareDefinition.id);
  if (!unlistedSession.ok) return failed(name, unlistedSession.error.message);
  const unlistedDrain = await server.drain(unlistedSession.value.id, caller);
  if (unlistedDrain.ok) return failed(name, 'expected rejection of an entirely unlisted tool call, drain reported success');

  const mcpDefinition = await server.createAgentDefinition(
    agentDefinitionInputFactory({
      tools: [
        {
          type: 'mcp',
          serverUrl: 'https://mcp.example.com/granted',
          label: 'Granted',
          auth: 'none',
          permissionPolicy: 'always_allow',
          toolAllowlist: ['search'],
        },
      ],
    }),
  );

  // (b) MCP call reporting a serverUrl that does not match any granted mcp server.
  controls.queuePendingToolCallForNextSession({
    toolUseId: 'tooluse_wrong_server',
    name: 'search',
    input: {},
    mcpServerUrl: 'https://attacker.example.com/evil',
  });
  const wrongServerSession = await server.createBuilderSession(mcpDefinition.id);
  if (!wrongServerSession.ok) return failed(name, wrongServerSession.error.message);
  const wrongServerDrain = await server.drain(wrongServerSession.value.id, caller);
  if (wrongServerDrain.ok) return failed(name, 'expected rejection of a call from an ungranted MCP server, drain reported success');

  // (c) MCP call to the granted server, but excluded by its toolAllowlist.
  controls.queuePendingToolCallForNextSession({
    toolUseId: 'tooluse_excluded',
    name: 'delete_repo',
    input: {},
    mcpServerUrl: 'https://mcp.example.com/granted',
  });
  const excludedSession = await server.createBuilderSession(mcpDefinition.id);
  if (!excludedSession.ok) return failed(name, excludedSession.error.message);
  const excludedDrain = await server.drain(excludedSession.value.id, caller);
  if (excludedDrain.ok) return failed(name, 'expected rejection of a toolAllowlist-excluded call, drain reported success');

  // (d) Baseline: a genuinely granted MCP call still drains to idle.
  controls.queuePendingToolCallForNextSession({
    toolUseId: 'tooluse_granted',
    name: 'search',
    input: {},
    mcpServerUrl: 'https://mcp.example.com/granted',
  });
  const grantedSession = await server.createBuilderSession(mcpDefinition.id);
  if (!grantedSession.ok) return failed(name, grantedSession.error.message);
  const grantedDrain = await server.drain(grantedSession.value.id, caller);
  if (!grantedDrain.ok) return failed(name, `expected a genuinely granted tool call to still drain successfully, got: ${grantedDrain.error.message}`);
  if (grantedDrain.value.status !== 'idle') return failed(name, `expected idle, got ${JSON.stringify(grantedDrain.value)}`);

  // (e) Builtin-toolset carve-out baseline: the SAME unattributed call
  // rejected in (a) MUST be authorized once a builtin_toolset is granted —
  // OASP v0 does not enumerate builtin tool names, so a granted toolset
  // authorizes any call reporting no MCP origin, regardless of its name
  // (docs/spec/interactions.md § drain's authorization clause). A server
  // rejecting this call would diverge from the clause just as surely as
  // one executing the unauthorized ones above.
  const builtinDefinition = await server.createAgentDefinition(
    agentDefinitionInputFactory({ tools: [{ type: 'builtin_toolset', toolset: 'coding' }] }),
  );
  controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_builtin', name: 'delete_everything', input: {} });
  const builtinSession = await server.createBuilderSession(builtinDefinition.id);
  if (!builtinSession.ok) return failed(name, builtinSession.error.message);
  const builtinDrain = await server.drain(builtinSession.value.id, caller);
  if (!builtinDrain.ok) {
    return failed(name, `expected the builtin-toolset carve-out to authorize an unattributed call, got: ${builtinDrain.error.message}`);
  }
  if (builtinDrain.value.status !== 'idle') return failed(name, `expected idle, got ${JSON.stringify(builtinDrain.value)}`);

  return passed(name);
}

/**
 * `docs/spec/target-version-resolution.md` § Resolving to content, not
 * only a pointer (issue #10): `drain`'s pre-dispatch authorization MUST
 * resolve the pinned version's OWN granted tools from its immutable
 * content snapshot, never from the live, still-editable
 * `AgentDefinition`. Publishes v1 granting one custom tool, parks a
 * v1-pinned real Conversation's session on a pending call for exactly
 * that tool, then — deliberately WITHOUT publishing — edits the draft
 * to revoke every grant, and asserts `drain` still succeeds: the
 * pinned v1's grants are what authorize the call, whatever the live
 * draft now says. A live-reading server (the pre-#10 defect) rejects
 * the call as unauthorized here and fails this check — and passes
 * every OTHER check in this file, because no other check interposes a
 * draft content edit between pinning a session and driving a pinned
 * interaction against it (`checkDrainRejectsUnauthorizedToolCalls`
 * never edits after pinning; `checkPublishDoesNotDisturbLiveConversations`
 * only asserts the stored integer pin). This check is what makes the
 * spec's snapshot-resolution MUST portably certifiable rather than
 * merely asserted in this reference implementation's own unit tests.
 */
async function checkDrainVersionIsolation(server: ReferenceServer): Promise<CheckResult> {
  const name = "server: drain authorizes against the pinned version's own snapshotted grants — an unpublished draft edit revoking them cannot affect a session pinned to the published version";
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(
    agentDefinitionInputFactory({ tools: [{ type: 'custom', name: 'resume', description: 'Resumes a prior task.', inputSchema: {} }] }),
  );
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  const sessionId = conversationResult.value.currentSessionId;

  // Park the v1-pinned session on a pending call for the tool v1 grants.
  await server.send(sessionId, `${mockSentinels.toolUsePrefix}resume`, caller);

  // Revoke every grant on the draft (v2) — deliberately NOT published: the
  // Conversation/Session above remain pinned to published v1.
  const edited = await server.editAgentDefinitionDraft(definition.id, { tools: [] });
  if (!edited.ok) return failed(name, edited.error.message);

  const drained = await server.drain(sessionId, caller);
  if (!drained.ok) {
    return failed(
      name,
      `expected the v1-pinned session to drain using v1's own snapshotted grants despite the unpublished draft revoking them (a live-reading server rejects here), got: ${drained.error.message}`,
    );
  }
  return drained.value.status === 'idle' ? passed(name) : failed(name, `expected idle, got ${JSON.stringify(drained.value)}`);
}

/**
 * Companion to {@link checkDrainVersionIsolation}, for `migrate`'s
 * Stage 1 (`docs/spec/interactions.md`): the newly minted session's
 * `vaultIds` MUST be re-resolved against the TARGET version's own
 * snapshotted `mcp` tool grants — never against whatever the live
 * `AgentDefinition` holds when `migrate` runs. Builds three versions
 * with pairwise-disjoint credential-requiring grants — v1 (the
 * outgoing pin), v2 (published: the migrate target), v3 (drafted but
 * deliberately never published: what the LIVE definition holds at
 * migrate time) — and asserts the minted session resolves exactly
 * v2's credential. A live-reading server resolves v3's credential
 * instead and fails; the explicit not-v3 assertion distinguishes that
 * exact defect from any other wrong answer in the failure message.
 */
async function checkMigrateVersionIsolation(server: ReferenceServer): Promise<CheckResult> {
  const name = "server: migrate re-resolves vaultIds from the TARGET version's snapshotted grants — never from a later unpublished draft's live content";
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(
    agentDefinitionInputFactory({
      tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/isolation-v1', label: 'V1', auth: 'credential', permissionPolicy: 'always_allow' }],
    }),
  );
  server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/isolation-v1' }));
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);

  // v2 — the published migrate target: a disjoint grant/credential.
  const credentialV2 = server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/isolation-v2' }));
  const v2 = await server.editAgentDefinitionDraft(definition.id, {
    tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/isolation-v2', label: 'V2', auth: 'credential', permissionPolicy: 'always_allow' }],
  });
  if (!v2.ok) return failed(name, v2.error.message);
  await server.publish(definition.id, caller);

  // v3 — drafted but never published: a third disjoint grant/credential the
  // LIVE AgentDefinition carries while the migrate target remains v2.
  const credentialV3 = server.registerCredential(registerCredentialInputFactory({ mcpServerUrl: 'https://mcp.example.com/isolation-v3' }));
  const v3 = await server.editAgentDefinitionDraft(definition.id, {
    tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/isolation-v3', label: 'V3', auth: 'credential', permissionPolicy: 'always_allow' }],
  });
  if (!v3.ok) return failed(name, v3.error.message);

  const migrated = await server.migrate(conversationResult.value.id, caller);
  if (!migrated.ok) return failed(name, migrated.error.message);

  const newSession = server.getSession(migrated.value.currentSessionId);
  if (!newSession) return failed(name, 'newly minted session not retrievable via getSession');
  if (JSON.stringify(newSession.vaultIds) === JSON.stringify([credentialV3.id])) {
    return failed(name, `newly minted session resolved the LIVE unpublished draft's (v3) credential instead of the pinned target version's (v2) — the live-reading defect issue #10 closes`);
  }
  return JSON.stringify(newSession.vaultIds) === JSON.stringify([credentialV2.id])
    ? passed(name)
    : failed(name, `expected the target version's own credential [${credentialV2.id}], got ${JSON.stringify(newSession.vaultIds)}`);
}

async function checkSendRejectsSupersededSession(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: send rejects a session superseded by migrate';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  const originalSessionId = conversationResult.value.currentSessionId;

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const migrated = await server.migrate(conversationResult.value.id, caller);
  if (!migrated.ok) return failed(name, migrated.error.message);

  const rejected = await server.send(originalSessionId, 'hello', caller);
  return !rejected.ok && rejected.error.code === 'Server.SessionNotCurrent'
    ? passed(name)
    : failed(name, `expected Server.SessionNotCurrent, got ${JSON.stringify(rejected)}`);
}

/**
 * `docs/spec/interactions.md` § Degrade-to-fresh-start on
 * transcript-fetch failure: `migrate` MUST NOT fail because the
 * outgoing Session's transcript fetch failed — it MUST proceed with an
 * empty seed instead, AND (issue #12) that degradation MUST be
 * recorded distinguishably in the emitted `migrate` `AuditEvent`'s
 * `degraded` field. A conformance kit that only checked the empty seed
 * would certify silent context loss: the audit trail would show the
 * exact same `outcome: 'success'` shape as a routine, full-seed
 * migrate, leaving an auditor unable to answer whether continuity was
 * actually lost. Uses the mock provider's induced-failure control
 * (`MockProviderControls.induceTranscriptFetchFailureOnce`) to force
 * exactly that failure deterministically — there is no black-box way
 * to provoke a transient adapter failure otherwise.
 */
async function checkDegradesToFreshStartOnTranscriptFetchFailure(server: ReferenceServer, controls: MockProviderControls): Promise<CheckResult> {
  const name = 'server: migrate degrades to an empty (fresh-start) seed, rather than failing, when the outgoing transcript fetch fails, and flags the AuditEvent degraded';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  await server.send(conversationResult.value.currentSessionId, 'hello', caller);

  controls.induceTranscriptFetchFailureOnce(conversationResult.value.currentSessionId);

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const migrated = await server.migrate(conversationResult.value.id, caller);
  if (!migrated.ok) return failed(name, `migrate MUST NOT fail on a transcript-fetch failure, but got: ${migrated.error.message}`);

  const seeded = await server.listSessionEvents(migrated.value.currentSessionId);
  if (!seeded.ok) return failed(name, seeded.error.message);
  if (seeded.value.events.length !== 0) {
    return failed(name, `expected an empty seed (fresh start) after an induced transcript-fetch failure, got ${seeded.value.events.length} stored events`);
  }

  const migrateEvent = server
    .listAuditEvents()
    .find((e) => e.what === 'migrate' && e.outcome === 'success' && e.refs.conversationId === conversationResult.value.id);
  if (!migrateEvent) return failed(name, 'expected a successful migrate AuditEvent to have been emitted for this conversation');
  return migrateEvent.degraded === true
    ? passed(name)
    : failed(name, `expected the degraded migrate's AuditEvent to carry degraded: true, got degraded=${JSON.stringify(migrateEvent.degraded)}`);
}

/**
 * Companion to {@link checkDegradesToFreshStartOnTranscriptFetchFailure}
 * (issue #12): a *normal*, full-seed migrate — no induced
 * transcript-fetch failure — MUST NOT have its `AuditEvent` flagged
 * `degraded`. Without this check, a server that stamps `degraded: true`
 * on every migrate unconditionally (rather than only on an actually
 * degraded one) could pass the check above by accident, defeating the
 * distinguishability the field exists to provide.
 */
async function checkNormalMigrateNotFlaggedDegraded(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: a normal, full-seed migrate is NOT flagged degraded in its AuditEvent';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  await server.send(conversationResult.value.currentSessionId, 'hello', caller);

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const migrated = await server.migrate(conversationResult.value.id, caller);
  if (!migrated.ok) return failed(name, migrated.error.message);

  const migrateEvent = server
    .listAuditEvents()
    .find((e) => e.what === 'migrate' && e.outcome === 'success' && e.refs.conversationId === conversationResult.value.id);
  if (!migrateEvent) return failed(name, 'expected a successful migrate AuditEvent to have been emitted for this conversation');
  return migrateEvent.degraded === undefined
    ? passed(name)
    : failed(name, `expected a normal migrate's AuditEvent to omit degraded entirely (docs/spec/audit.md: MUST be omitted, never false), got degraded=${JSON.stringify(migrateEvent.degraded)}`);
}

/**
 * `docs/spec/interactions.md` § `publish`: "Publish MUST NOT mutate any
 * existing Session or Conversation... live conversations are NOT
 * disturbed." Publishes a definition, pins a Conversation to that
 * version, then publishes again (a genuine version bump) and asserts
 * the already-pinned Conversation — and its Session — are byte-for-byte
 * unchanged. `migrate` is the only interaction permitted to move a
 * Conversation onto a new version; `publish` deliberately does not
 * cascade into one.
 */
async function checkPublishDoesNotDisturbLiveConversations(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: publish does not disturb a live Conversation pinned to a different version (no cascade into migrate)';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);
  const before = conversationResult.value;

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);

  const after = server.getConversation(before.id);
  const sessionAfter = server.getSession(before.currentSessionId);
  const unchanged =
    after?.currentSessionId === before.currentSessionId &&
    after?.pinnedAgentVersion.version === before.pinnedAgentVersion.version &&
    after?.previousSessionIds.length === 0 &&
    sessionAfter?.pinnedAgentVersion.version === before.pinnedAgentVersion.version;

  return unchanged
    ? passed(name)
    : failed(name, `conversation was disturbed by a subsequent publish: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
}

/**
 * `docs/spec/interactions.md` § Stage 1: the new Session's `resources`
 * MUST be the outgoing Session's `resources`, re-attached fresh — never
 * dropped or reduced. Creates a Conversation with a non-empty
 * `resources` set, migrates it, and asserts the newly minted Session
 * carries the same resources.
 */
async function checkMigrateReattachesResources(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: migrate Stage 1 re-attaches the outgoing session\'s resources onto the newly minted session (never dropped or reduced)';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  await server.publish(definition.id, caller);
  const resources = [{ type: 'file' as const, fileId: 'file_check' }];
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id, { resources }));
  if (!conversationResult.ok) return failed(name, conversationResult.error.message);

  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const migrated = await server.migrate(conversationResult.value.id, caller);
  if (!migrated.ok) return failed(name, migrated.error.message);

  const newSession = server.getSession(migrated.value.currentSessionId);
  return newSession && JSON.stringify(newSession.resources) === JSON.stringify(resources)
    ? passed(name)
    : failed(name, `expected resources ${JSON.stringify(resources)} carried onto the new session, got ${JSON.stringify(newSession?.resources)}`);
}

/**
 * `docs/spec/target-version-resolution.md`: "A resolver MUST NOT
 * substitute draftVersion for a real conversation merely because
 * publishedVersion happens to be unset." Since `publishedVersion` is
 * monotonically non-decreasing and v0 has no "unpublish" (see
 * `docs/spec/interactions.md` § `publish`), the only place this
 * invariant can actually be enforced for good is at Conversation
 * *creation* time — once a real Conversation exists it can never again
 * point at a never-published definition, so `migrate`'s "leave in
 * place" branch for that case (see `docs/spec/interactions.md` §
 * Preconditions) is unreachable through a server that guards creation
 * correctly. This check asserts that guard: creating a real
 * Conversation against a never-published `AgentDefinition` MUST be
 * rejected, never silently pinned to `draftVersion`.
 */
async function checkCreateConversationRejectsNeverPublishedDefinition(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: creating a real Conversation against a never-published AgentDefinition is rejected, never silently pinned to draftVersion';
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  // Deliberately never published.
  const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
  return !conversationResult.ok
    ? passed(name)
    : failed(name, `expected rejection for a never-published definition, got a Conversation pinned to v${conversationResult.value.pinnedAgentVersion.version}`);
}

/**
 * Drives a `ReferenceServer` through the seven interactions and asserts
 * the normative behaviours `docs/spec/interactions.md` requires:
 * version pinning preserved, every resource response carrying its
 * `resourceType` discriminator (`docs/spec/resources.md`), lineage
 * append-only oldest-first across
 * repeated migrations, migrate non-compounding (measured via the true
 * stored history), drain resolving pending tool calls, drain's
 * pre-dispatch pinned-grant authorization (issue #9), version isolation
 * — drain authorizing and migrate re-resolving credentials against the
 * pinned/target version's immutable content snapshot, never the live
 * `AgentDefinition` (issue #10) — `send`'s current-session enforcement,
 * degrade-to-fresh-start on transcript fetch failure (and that
 * degradation being flagged, and ONLY flagged, on the actually-degraded
 * migrate — issue #12), publish not disturbing live conversations,
 * migrate's resource re-attachment, and never-published target-version
 * handling. This is the "Server" conformance level's executable check —
 * see `verify-self-report.ts` for how a server's `selfReport()` claim
 * of `'server'` is checked against this.
 *
 * `controls` is the mock provider's test-only control surface (see
 * `mock/mock-provider-controls.types.ts`) — required here (not
 * optional) because the transcript-fetch-failure check has no other
 * black-box way to provoke that failure deterministically.
 */
export async function runServerChecks(server: ReferenceServer, controls: MockProviderControls): Promise<CheckResult[]> {
  return Promise.all([
    checkVersionPinningPreserved(server),
    checkResourceTypeDiscriminator(server),
    checkLineageAppendOnlyOldestFirst(server),
    checkMigrateNonCompounding(server),
    checkDrainResolvesPendingToolCalls(server, controls),
    checkDrainRejectsUnauthorizedToolCalls(server, controls),
    checkDrainVersionIsolation(server),
    checkMigrateVersionIsolation(server),
    checkSendRejectsSupersededSession(server),
    checkDegradesToFreshStartOnTranscriptFetchFailure(server, controls),
    checkNormalMigrateNotFlaggedDegraded(server),
    checkPublishDoesNotDisturbLiveConversations(server),
    checkMigrateReattachesResources(server),
    checkCreateConversationRejectsNeverPublishedDefinition(server),
  ]);
}
