import { agentDefinitionInputFactory } from '../../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../../factories/caller-context-factory';
import { createConversationInputFactory } from '../../../factories/create-conversation-input-factory';
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

async function checkDrainResolvesPendingToolCalls(server: ReferenceServer): Promise<CheckResult> {
  const name = 'server: drain enumerates and resolves pending tool calls, returning the session to idle';
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  const sessionResult = await server.createBuilderSession(definition.id);
  if (!sessionResult.ok) return failed(name, sessionResult.error.message);
  await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, caller);

  const drainResult = await server.drain(sessionResult.value.id, caller);
  if (!drainResult.ok) return failed(name, drainResult.error.message);
  return drainResult.value.status === 'idle' && drainResult.value.resolvedToolUseIds.length > 0
    ? passed(name)
    : failed(name, `expected idle with resolved tool uses, got ${JSON.stringify(drainResult.value)}`);
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
 * empty seed instead. Uses the mock provider's induced-failure control
 * (`MockProviderControls.induceTranscriptFetchFailureOnce`) to force
 * exactly that failure deterministically — there is no black-box way
 * to provoke a transient adapter failure otherwise.
 */
async function checkDegradesToFreshStartOnTranscriptFetchFailure(server: ReferenceServer, controls: MockProviderControls): Promise<CheckResult> {
  const name = 'server: migrate degrades to an empty (fresh-start) seed, rather than failing, when the outgoing transcript fetch fails';
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
  return seeded.value.events.length === 0
    ? passed(name)
    : failed(name, `expected an empty seed (fresh start) after an induced transcript-fetch failure, got ${seeded.value.events.length} stored events`);
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
 * version pinning preserved, lineage append-only oldest-first across
 * repeated migrations, migrate non-compounding (measured via the true
 * stored history), drain resolving pending tool calls, `send`'s
 * current-session enforcement, degrade-to-fresh-start on transcript
 * fetch failure, publish not disturbing live conversations, migrate's
 * resource re-attachment, and never-published target-version handling.
 * This is the "Server" conformance level's executable check — see
 * `verify-self-report.ts` for how a server's `selfReport()` claim of
 * `'server'` is checked against this.
 *
 * `controls` is the mock provider's test-only control surface (see
 * `mock/mock-provider-controls.types.ts`) — required here (not
 * optional) because the transcript-fetch-failure check has no other
 * black-box way to provoke that failure deterministically.
 */
export async function runServerChecks(server: ReferenceServer, controls: MockProviderControls): Promise<CheckResult[]> {
  return Promise.all([
    checkVersionPinningPreserved(server),
    checkLineageAppendOnlyOldestFirst(server),
    checkMigrateNonCompounding(server),
    checkDrainResolvesPendingToolCalls(server),
    checkSendRejectsSupersededSession(server),
    checkDegradesToFreshStartOnTranscriptFetchFailure(server, controls),
    checkPublishDoesNotDisturbLiveConversations(server),
    checkMigrateReattachesResources(server),
    checkCreateConversationRejectsNeverPublishedDefinition(server),
  ]);
}
