import { auditEventSchema, type AuditEvent } from '@oasp/schemas';
import { agentDefinitionInputFactory } from '../../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../../factories/caller-context-factory';
import { createConversationInputFactory } from '../../../factories/create-conversation-input-factory';
import { registerCredentialInputFactory } from '../../../factories/register-credential-input-factory';
import { scopeFactory } from '../../../factories/scope-factory';
import { mockSentinels } from '../../../mock/mock-sentinels';
import { computeContentDigest } from '../../../server/audit/compute-content-digest';
import type { CallerContext } from '../../../server/caller-context.types';
import type { ReferenceServer } from '../../../server/reference-server.types';
import type { Result } from '../../../shared/result';
import { failed, passed, type CheckResult } from '../../check-result.types';

/** The four interactions `docs/spec/audit.md` § Scope provenance treats as "session-bound": their `scope` MUST come from the bound Conversation, or — when the Session has no bound Conversation (builder/test-session) — MUST fall back to the pinned `AgentDefinition` version's own `scope`. */
const SESSION_BOUND_WHATS: readonly AuditEvent['what'][] = ['send', 'sendToolResult', 'drain', 'stream'];

/** A bare id no scenario in this file ever mints — guaranteed to be "not found" for every one of the seven interactions' not-found scenario below (issue #11). */
const NOT_FOUND_PROBE_ID = 'does_not_exist_audit_not_found_probe';

/** Which `refs` sub-field each interaction's not-found `AuditEvent` names the caller-asserted (nonexistent) target under — see `docs/spec/audit.md` § Not-found preconditions. */
const NOT_FOUND_REFS_FIELD: Record<AuditEvent['what'], 'definitionId' | 'conversationId' | 'sessionId'> = {
  publish: 'definitionId',
  createConversation: 'definitionId',
  migrate: 'conversationId',
  drain: 'sessionId',
  stream: 'sessionId',
  send: 'sessionId',
  sendToolResult: 'sessionId',
};

/**
 * The `mcp` tool grant's `serverUrl` and the registered `Credential`'s
 * `mcpServerUrl` this scenario matches them on — per
 * `docs/spec/interactions.md` § `createConversation` / § Stage 1, a
 * `Credential` is resolved into `vaultIds` by matching these two
 * fields. Registering a real Credential (rather than leaving `tools`
 * empty, as scenarios before S4 did) is what makes `refs.credentialIds`
 * non-empty and assertable below — see
 * `docs/spec/audit.md` § Credential attachment is audited.
 */
const CREDENTIAL_MCP_SERVER_URL = 'https://mcp.example.com/audit-scenario';

/**
 * Asserts every `what` in {@link SESSION_BOUND_WHATS} has an emitted
 * event (matching `sessionId`) whose `scope.id` equals `expectedScopeId`
 * — the teeth `docs/spec/audit.md` § Scope provenance's per-`what` table
 * requires: "present & non-empty" alone does not prove *correct*, only
 * that some value was set. Returns the list of `what` values that
 * mismatched or were missing entirely, for a precise failure detail.
 */
function findScopeProvenanceMismatches(emitted: readonly AuditEvent[], sessionId: string, expectedScopeId: string): readonly string[] {
  return SESSION_BOUND_WHATS.filter((what) => {
    const event = emitted.find((candidate) => candidate.what === what && candidate.refs.sessionId === sessionId);
    // `?.` on `scope` itself (not just on `event`): a `not_found` outcome may
    // legitimately omit `scope` entirely (issue #11) — none of the four
    // session-bound `what` values this helper checks can reach that outcome
    // in the scenarios that call it, but the type now reflects the schema.
    return !event || event.scope?.id !== expectedScopeId;
  });
}

/**
 * Drives `send`/`drain`/`stream`/`sendToolResult` against a Session
 * bound to no `Conversation` (a builder session) and returns the
 * emitted events — exercising `docs/spec/audit.md` § Scope
 * provenance's fourth table row (the fallback-to-`AgentDefinition`
 * case), which the conversation-bound scenario above never touches.
 */
async function runBuilderSessionScenario(server: ReferenceServer, definitionId: string, caller: CallerContext): Promise<Result<{ sessionId: string; emitted: readonly AuditEvent[] }, string>> {
  const builderSessionResult = await server.createBuilderSession(definitionId);
  if (!builderSessionResult.ok) return { ok: false, error: builderSessionResult.error.message };

  const sessionId = builderSessionResult.value.id;
  const before = server.listAuditEvents().length;
  await server.send(sessionId, `${mockSentinels.toolUsePrefix}lookup`, caller);
  await server.drain(sessionId, caller);
  await server.stream(sessionId, caller);
  await server.sendToolResult(sessionId, 'irrelevant_for_this_check', {}, caller); // failure outcome is still a valid emission

  return { ok: true, value: { sessionId, emitted: server.listAuditEvents().slice(before) } };
}

/**
 * Drives every one of the seven interactions against {@link NOT_FOUND_PROBE_ID}
 * — a bare id guaranteed never to resolve to a real `AgentDefinition` /
 * `Conversation` / `Session` — and returns the AuditEvents emitted for
 * each, keyed by `what`. Exercises `docs/spec/audit.md` § Not-found
 * preconditions (issue #11): before this fix, a not-found precondition
 * failure returned before `emitAuditEvent` ever ran, so a failed
 * enumeration probe left zero trace — the defect this scenario's checks
 * (below, in {@link runAuditChecks}) prove is closed.
 */
async function runNotFoundScenario(server: ReferenceServer, caller: CallerContext): Promise<ReadonlyMap<AuditEvent['what'], readonly AuditEvent[]>> {
  const before = server.listAuditEvents().length;

  await server.publish(NOT_FOUND_PROBE_ID, caller);
  await server.createConversation(createConversationInputFactory(NOT_FOUND_PROBE_ID));
  await server.migrate(NOT_FOUND_PROBE_ID, caller);
  await server.drain(NOT_FOUND_PROBE_ID, caller);
  await server.stream(NOT_FOUND_PROBE_ID, caller);
  await server.send(NOT_FOUND_PROBE_ID, 'not-found probe content', caller);
  await server.sendToolResult(NOT_FOUND_PROBE_ID, 'tooluse_not_found_probe', {}, caller);

  const byWhat = new Map<AuditEvent['what'], AuditEvent[]>();
  for (const event of server.listAuditEvents().slice(before)) {
    const list = byWhat.get(event.what) ?? [];
    list.push(event);
    byWhat.set(event.what, list);
  }
  return byWhat;
}

/**
 * Drives a `ReferenceServer` through all seven required-emission
 * interactions (`docs/spec/audit.md` § Required-emission set) and
 * asserts each produces exactly one schema-valid `AuditEvent` with the
 * correct `what` and a scope that is not just populated but *correct*
 * per § Scope provenance's total five-row table: `publish` →
 * definition scope, `createConversation` → the new Conversation's own
 * scope, `migrate` → conversation scope, the four session-bound
 * interactions → the bound Conversation's scope, or — for a Session
 * with no bound Conversation — the pinned `AgentDefinition`'s scope.
 *
 * **S4 addition:** `createConversation` — the emission point for a
 * Conversation's *initial* credential attachment — is now checked like
 * every other required `what` value, including that its
 * `refs.credentialIds` names the Credential actually resolved into the
 * new Session's `vaultIds` (not merely "the event exists"). `migrate`'s
 * `refs.credentialIds` (re-attachment) is checked the same way. Per
 * `docs/spec/audit.md` § Credential attachment is audited
 * (`createConversation` and `migrate`), this closes what used to be a
 * documented, deliberately-unchecked v0 gap.
 *
 * **Issue #11 Tranche A addition:** also drives {@link runNotFoundScenario}
 * — all seven interactions against a bare id guaranteed never to resolve —
 * and asserts each still emits exactly one `AuditEvent` with
 * `outcome: 'not_found'` naming the caller-asserted target, closing the
 * "failed enumeration probes leave zero trace" gap the previous suite
 * (happy paths only) could not have caught. Also asserts the two
 * action-specific `evidence` fields Tranche A adds: `send`'s
 * `evidence.contentDigest` matches the actual posted content, and every
 * interaction that resolves a Session/Conversation carries
 * `evidence.agentVersionRef` naming the correct pinned `AgentDefinition`.
 */
export async function runAuditChecks(server: ReferenceServer): Promise<CheckResult[]> {
  const caller = callerContextFactory();
  const definition = await server.createAgentDefinition(
    agentDefinitionInputFactory({
      // The mcp grant exercises credential attachment (below); the custom
      // 'lookup' grant is what authorizes the `mockSentinels.toolUsePrefix`
      // pending tool calls this scenario drains further down — `drain` now
      // authorizes every pending call against the pinned AgentDefinition's
      // granted tools (issue #9), so this override (which replaces the
      // factory's own default 'lookup' grant entirely) must re-declare it.
      tools: [
        { type: 'mcp', serverUrl: CREDENTIAL_MCP_SERVER_URL, label: 'Audit-scenario MCP', auth: 'credential', permissionPolicy: 'always_allow' },
        { type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} },
      ],
    }),
  );
  const credential = server.registerCredential(registerCredentialInputFactory({ scope: definition.scope, mcpServerUrl: CREDENTIAL_MCP_SERVER_URL }));
  const before = server.listAuditEvents().length;

  await server.publish(definition.id, caller);
  // Give the Conversation a scope id distinct from the AgentDefinition's own
  // (the factory default `workspace_1`) so the provenance rows below are
  // distinguishable by VALUE: a source-swap — stamping the definition's scope
  // where the bound Conversation's is required (or vice versa on the fallback
  // row) — is caught, not merely a wrong-but-populated stamp.
  const conversationResult = await server.createConversation(
    createConversationInputFactory(definition.id, { scope: scopeFactory({ id: 'workspace_conversation' }) }),
  ); // Audited since S4 — asserted below like every other required what value.
  if (!conversationResult.ok) return [failed('audit: scenario setup', conversationResult.error.message)];
  const conversationSessionId = conversationResult.value.currentSessionId;

  await server.send(conversationSessionId, `${mockSentinels.toolUsePrefix}lookup`, caller);
  await server.drain(conversationSessionId, caller);
  await server.stream(conversationSessionId, caller);
  await server.sendToolResult(conversationSessionId, 'irrelevant_for_this_check', {}, caller); // failure outcome is still a valid emission
  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, caller);
  const migrateResult = await server.migrate(conversationResult.value.id, caller);

  const emitted = server.listAuditEvents().slice(before);

  const requiredWhatValues: readonly AuditEvent['what'][] = ['publish', 'createConversation', 'migrate', 'drain', 'stream', 'send', 'sendToolResult'];
  const checks: CheckResult[] = [];

  for (const what of requiredWhatValues) {
    const name = `audit: ${what} emits at least one AuditEvent`;
    const matching = emitted.filter((event) => event.what === what);
    checks.push(matching.length >= 1 ? passed(name) : failed(name, `no AuditEvent with what:'${what}' was emitted`));
  }

  const shapeName = 'audit: every emitted AuditEvent validates against auditEventSchema';
  const invalid = emitted.find((event) => !auditEventSchema.safeParse(event).success);
  checks.push(invalid ? failed(shapeName, `AuditEvent ${invalid.id} failed schema validation`) : passed(shapeName));

  const scopeName = 'audit: every emitted AuditEvent carries a populated, non-empty scope';
  const missingScope = emitted.find((event) => !event.scope?.id);
  checks.push(missingScope ? failed(scopeName, `AuditEvent ${missingScope.id} has no populated scope`) : passed(scopeName));

  const createConversationEvent = emitted.find((event) => event.what === 'createConversation' && event.refs.conversationId === conversationResult.value.id);
  const publishEvent = emitted.find((event) => event.what === 'publish' && event.refs.definitionId === definition.id);
  const migrateEvent = emitted.find((event) => event.what === 'migrate' && event.refs.conversationId === conversationResult.value.id);

  const provenanceName = 'audit: publish/createConversation/migrate scope matches their primary resource\'s own scope';
  const publishScopeOk = publishEvent?.scope?.id === definition.scope.id;
  const createConversationScopeOk = createConversationEvent?.scope?.id === conversationResult.value.scope.id;
  const migrateScopeOk = migrateEvent?.scope?.id === conversationResult.value.scope.id;
  checks.push(
    publishScopeOk && createConversationScopeOk && migrateScopeOk
      ? passed(provenanceName)
      : failed(
          provenanceName,
          `publish scope match=${publishScopeOk}, createConversation scope match=${createConversationScopeOk}, migrate scope match=${migrateScopeOk}`,
        ),
  );

  // S4 teeth: createConversation's AuditEvent MUST name which
  // Credential(s) it attached via refs.credentialIds — not merely that
  // *an* attachment happened. Asserts the actual registered Credential's
  // id, not just "some non-empty array": a server that populates
  // credentialIds with a wrong or fabricated id must fail this too.
  const createConversationCredentialName = 'audit: createConversation names the attached Credential(s) via refs.credentialIds';
  const createConversationCredentialIds = createConversationEvent?.refs.credentialIds ?? [];
  checks.push(
    createConversationCredentialIds.includes(credential.id)
      ? passed(createConversationCredentialName)
      : failed(createConversationCredentialName, `expected refs.credentialIds to include '${credential.id}', got ${JSON.stringify(createConversationCredentialIds)}`),
  );

  // Same teeth for migrate's re-attachment: docs/spec/audit.md's migrate
  // case previously recorded THAT credentials were re-attached; refs.credentialIds
  // now also names WHICH.
  const migrateCredentialName = 'audit: migrate names the re-attached Credential(s) via refs.credentialIds';
  const migrateCredentialIds = migrateEvent?.refs.credentialIds ?? [];
  checks.push(
    migrateResult.ok && migrateCredentialIds.includes(credential.id)
      ? passed(migrateCredentialName)
      : failed(migrateCredentialName, `expected refs.credentialIds to include '${credential.id}', got ${JSON.stringify(migrateCredentialIds)}`),
  );

  // Issue #11 Tranche A teeth: send's AuditEvent MUST carry
  // evidence.contentDigest matching the actual posted content — not merely
  // that some digest-shaped string is present.
  const sendEvent = emitted.find((event) => event.what === 'send' && event.refs.sessionId === conversationSessionId);
  const contentDigestName = 'audit: send\'s AuditEvent carries evidence.contentDigest matching the posted content';
  const expectedContentDigest = computeContentDigest(`${mockSentinels.toolUsePrefix}lookup`);
  checks.push(
    sendEvent?.evidence?.contentDigest === expectedContentDigest
      ? passed(contentDigestName)
      : failed(contentDigestName, `expected evidence.contentDigest '${expectedContentDigest}', got ${JSON.stringify(sendEvent?.evidence)}`),
  );

  // Issue #11 Tranche A teeth: every interaction that resolves a Session or
  // Conversation MUST carry evidence.agentVersionRef naming the pinned
  // AgentDefinition version — asserts the actual id AND version, not just
  // "some ref is present". The five pre-migrate interactions all ran against
  // the Conversation's original pin; migrate's event records the TARGET
  // version it migrated toward (see audit-event.ts's `agentVersionRef` doc),
  // which after this scenario's successful migrate is the post-migrate pin.
  const agentVersionRefWhats: readonly AuditEvent['what'][] = ['createConversation', 'migrate', 'send', 'sendToolResult', 'drain', 'stream'];
  const agentVersionRefName = 'audit: createConversation/migrate/send/sendToolResult/drain/stream AuditEvents carry evidence.agentVersionRef naming the pinned AgentDefinition version';
  const expectedVersionFor = (what: AuditEvent['what']): number | undefined =>
    what === 'migrate'
      ? migrateResult.ok
        ? migrateResult.value.pinnedAgentVersion.version
        : undefined
      : conversationResult.value.pinnedAgentVersion.version;
  const wrongAgentVersionRef = agentVersionRefWhats.filter((what) => {
    const ref = emitted.find((candidate) => candidate.what === what)?.evidence?.agentVersionRef;
    return ref === undefined || ref.agentDefinitionId !== definition.id || ref.version !== expectedVersionFor(what);
  });
  checks.push(
    wrongAgentVersionRef.length === 0
      ? passed(agentVersionRefName)
      : failed(agentVersionRefName, `missing or wrong evidence.agentVersionRef for: ${wrongAgentVersionRef.join(', ')}`),
  );

  // B3 teeth: the four session-bound interactions' scope MUST equal the
  // bound Conversation's scope — not merely "present & non-empty".
  const conversationBoundName = 'audit: send/sendToolResult/drain/stream on a Conversation-bound session carry that Conversation\'s scope';
  const conversationMismatches = findScopeProvenanceMismatches(emitted, conversationSessionId, conversationResult.value.scope.id);
  checks.push(
    conversationMismatches.length === 0
      ? passed(conversationBoundName)
      : failed(conversationBoundName, `scope mismatch (or missing event) for: ${conversationMismatches.join(', ')}`),
  );

  // B3 teeth, fallback row: the same four interactions on a builder/test-session
  // (no bound Conversation) MUST carry the pinned AgentDefinition's own scope —
  // audit.md's total five-row table's previously-unexercised fallback row.
  const fallbackName = 'audit: send/sendToolResult/drain/stream on a builder/test-session (no Conversation) carry the pinned AgentDefinition\'s scope (fallback)';
  const builderScenario = await runBuilderSessionScenario(server, definition.id, caller);
  if (!builderScenario.ok) {
    checks.push(failed('audit: builder-session scenario setup', builderScenario.error));
  } else {
    const fallbackMismatches = findScopeProvenanceMismatches(builderScenario.value.emitted, builderScenario.value.sessionId, definition.scope.id);
    checks.push(
      fallbackMismatches.length === 0
        ? passed(fallbackName)
        : failed(fallbackName, `scope mismatch (or missing event) for: ${fallbackMismatches.join(', ')}`),
    );
  }

  // Issue #11 Tranche A: a not-found precondition failure MUST still emit
  // exactly one AuditEvent — outcome: 'not_found', naming the caller-asserted
  // (nonexistent) target under the relevant refs field — instead of
  // returning silently, for every one of the seven interactions.
  const notFoundScenario = await runNotFoundScenario(server, caller);
  for (const what of requiredWhatValues) {
    const name = `audit: a not-found ${what} call still emits exactly one AuditEvent with outcome: 'not_found'`;
    const matching = notFoundScenario.get(what) ?? [];
    const refsField = NOT_FOUND_REFS_FIELD[what];
    const ok = matching.length === 1 && matching[0]?.outcome === 'not_found' && matching[0]?.refs[refsField] === NOT_FOUND_PROBE_ID;
    checks.push(
      ok
        ? passed(name)
        : failed(
            name,
            `expected exactly one AuditEvent{ what: '${what}', outcome: 'not_found', refs.${refsField}: '${NOT_FOUND_PROBE_ID}' }, got ${JSON.stringify(matching)}`,
          ),
    );
  }

  return checks;
}
