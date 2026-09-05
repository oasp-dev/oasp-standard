import { auditEventSchema, type AuditEvent } from '@oasp/schemas';
import { agentDefinitionInputFactory } from '../../../factories/agent-definition-input-factory';
import { authenticatedActorFactory } from '../../../factories/authenticated-actor-factory';
import { createConversationInputFactory } from '../../../factories/create-conversation-input-factory';
import { registerCredentialInputFactory } from '../../../factories/register-credential-input-factory';
import { scopeFactory } from '../../../factories/scope-factory';
import { mockSentinels } from '../../../mock/mock-sentinels';
import { computeContentDigest } from '../../../server/audit/compute-content-digest';
import type { AuthenticatedActor } from '../../../server/auth/authenticated-actor.types';
import type { ReferenceServer } from '../../../server/reference-server.types';
import type { Result } from '../../../shared/result';
import { failed, passed, type CheckResult } from '../../check-result.types';

/** The four interactions `docs/spec/audit.md` § Scope provenance treats as "session-bound": their `scope` MUST come from the bound Conversation, or — when the Session has no bound Conversation (builder/test-session) — MUST fall back to the pinned `AgentDefinition` version's own `scope`. */
const SESSION_BOUND_WHATS: readonly AuditEvent['what'][] = ['send', 'sendToolResult', 'drain', 'stream'];

/** A bare id no scenario in this file ever mints — guaranteed to be "not found" for every one of the seven interactions' not-found scenario below (issue #11). */
const NOT_FOUND_PROBE_ID = 'does_not_exist_audit_not_found_probe';

/** Which `refs` sub-field each interaction's not-found `AuditEvent` names the actor-asserted (nonexistent) target under — see `docs/spec/audit.md` § Not-found preconditions. */
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
 * `Credential` is resolved into `vaultIds` by matching `mcpServerUrl`
 * (plus, since issue #8, scope/delegation-pin/onBehalfOf/provider — see
 * `resolveCredentialBindings`). Registering a real Credential (rather
 * than leaving `tools` empty, as scenarios before S4 did) is what makes
 * `refs.credentialIds` non-empty and assertable below — see
 * `docs/spec/audit.md` § Credential attachment is audited.
 *
 * **Issue #8:** the Credential registered against this URL below is
 * deliberately pinned to {@link CONVERSATION_SCOPE_ID} — the
 * Conversation's OWN scope, not the AgentDefinition's — so it is a
 * genuinely eligible binding and this remains the happy-path
 * attachment scenario. The pre-#8 version of this file instead pinned
 * it to the Definition's scope while the Conversation used a different
 * one, and still asserted attachment — the exact cross-scope defect
 * {@link runCrossScopeCredentialRejectionScenario} now proves is
 * rejected, below.
 */
const CREDENTIAL_MCP_SERVER_URL = 'https://mcp.example.com/audit-scenario';

/** The Conversation's own scope id this scenario uses throughout — distinct from the AgentDefinition's own (the factory default `workspace_1`) so provenance rows are distinguishable by VALUE (see the `publish` call site below), and reused here as the scope {@link CREDENTIAL_MCP_SERVER_URL}'s Credential is legitimately pinned to. */
const CONVERSATION_SCOPE_ID = 'workspace_conversation';

/**
 * The distinct scope a cross-scope Credential is deliberately pinned to
 * in {@link runCrossScopeCredentialRejectionScenario} — DIFFERENT from
 * that scenario's own Conversation scope
 * ({@link CROSS_SCOPE_CONVERSATION_SCOPE_ID}), so the Credential is a
 * `mcpServerUrl` match but an eligibility mismatch, exactly the
 * cross-tenant collision issue #8 exists to reject.
 */
const CROSS_SCOPE_CREDENTIAL_SCOPE_ID = 'workspace_cross_scope_credential';

/** The Conversation scope {@link runCrossScopeCredentialRejectionScenario} creates its Conversation at — never the scope the scenario's Credential is pinned to. */
const CROSS_SCOPE_CONVERSATION_SCOPE_ID = 'workspace_cross_scope_target';

/** The `mcp` grant's `serverUrl` {@link runCrossScopeCredentialRejectionScenario} uses — distinct from {@link CREDENTIAL_MCP_SERVER_URL} so the two scenarios' Credentials can never accidentally satisfy each other's grant. */
const CROSS_SCOPE_MCP_SERVER_URL = 'https://mcp.example.com/audit-scenario-cross-scope';

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
async function runBuilderSessionScenario(server: ReferenceServer, definitionId: string, actor: AuthenticatedActor): Promise<Result<{ sessionId: string; emitted: readonly AuditEvent[] }, string>> {
  const builderSessionResult = await server.createBuilderSession(definitionId);
  if (!builderSessionResult.ok) return { ok: false, error: builderSessionResult.error.message };

  const sessionId = builderSessionResult.value.id;
  const before = server.listAuditEvents().length;
  await server.send(sessionId, `${mockSentinels.toolUsePrefix}lookup`, actor);
  await server.drain(sessionId, actor);
  await server.stream(sessionId, actor);
  await server.sendToolResult(sessionId, 'irrelevant_for_this_check', {}, actor); // failure outcome is still a valid emission

  return { ok: true, value: { sessionId, emitted: server.listAuditEvents().slice(before) } };
}

/**
 * Issue #8's inversion of this file's pre-#8 cross-scope scenario:
 * registers a Credential pinned to {@link CROSS_SCOPE_CREDENTIAL_SCOPE_ID},
 * then attempts `createConversation` for a Conversation resolving within
 * the DIFFERENT {@link CROSS_SCOPE_CONVERSATION_SCOPE_ID} scope, against
 * an AgentDefinition whose only tool grant requires that exact
 * Credential's `mcpServerUrl`. Before #8, a URL-only match let this
 * attach regardless of the scope mismatch — this scenario now asserts
 * the opposite: `createConversation` MUST fail closed with
 * `Server.UnresolvedCredential` (issue #8's invariant #3 — a
 * credential-required grant with zero eligible Credentials fails the
 * whole interaction, it does not merely omit the attachment), and the
 * `AuditEvent` it still emits (every invocation is audited, successful
 * or not) MUST report `outcome: 'failure'` with no `credentialIds`
 * attached.
 *
 * `actor` must already carry membership in
 * {@link CROSS_SCOPE_CONVERSATION_SCOPE_ID} (see `runAuditChecks`'s own
 * actor registration) — otherwise this would fail earlier, at write-path
 * scope authorization, and never actually reach credential resolution at
 * all.
 */
async function runCrossScopeCredentialRejectionScenario(server: ReferenceServer, actor: AuthenticatedActor): Promise<Result<{ emitted: readonly AuditEvent[] }, string>> {
  const definition = await server.createAgentDefinition(
    agentDefinitionInputFactory({
      tools: [{ type: 'mcp', serverUrl: CROSS_SCOPE_MCP_SERVER_URL, label: 'Cross-scope MCP', auth: 'credential', permissionPolicy: 'always_allow' }],
    }),
  );
  server.registerCredential(
    registerCredentialInputFactory({ scope: scopeFactory({ id: CROSS_SCOPE_CREDENTIAL_SCOPE_ID }), mcpServerUrl: CROSS_SCOPE_MCP_SERVER_URL }),
  );
  await server.publish(definition.id, actor);

  const before = server.listAuditEvents().length;
  const conversationResult = await server.createConversation(
    createConversationInputFactory(server, definition.id, { scope: scopeFactory({ id: CROSS_SCOPE_CONVERSATION_SCOPE_ID }), actor }),
  );
  const emitted = server.listAuditEvents().slice(before);

  if (conversationResult.ok) {
    return {
      ok: false,
      error: "expected createConversation to reject (fail closed) a credential-required grant whose only registered Credential is pinned to a different scope, but it succeeded",
    };
  }
  if (conversationResult.error.code !== 'Server.UnresolvedCredential') {
    return { ok: false, error: `expected rejection with code 'Server.UnresolvedCredential', got '${conversationResult.error.code}': ${conversationResult.error.message}` };
  }
  return { ok: true, value: { emitted } };
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
async function runNotFoundScenario(server: ReferenceServer, actor: AuthenticatedActor): Promise<ReadonlyMap<AuditEvent['what'], readonly AuditEvent[]>> {
  const before = server.listAuditEvents().length;

  await server.publish(NOT_FOUND_PROBE_ID, actor);
  await server.createConversation(createConversationInputFactory(server, NOT_FOUND_PROBE_ID));
  await server.migrate(NOT_FOUND_PROBE_ID, actor);
  await server.drain(NOT_FOUND_PROBE_ID, actor);
  await server.stream(NOT_FOUND_PROBE_ID, actor);
  await server.send(NOT_FOUND_PROBE_ID, 'not-found probe content', actor);
  await server.sendToolResult(NOT_FOUND_PROBE_ID, 'tooluse_not_found_probe', {}, actor);

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
 * `outcome: 'not_found'` naming the actor-asserted target, closing the
 * "failed enumeration probes leave zero trace" gap the previous suite
 * (happy paths only) could not have caught. Also asserts the two
 * action-specific `evidence` fields Tranche A adds: `send`'s
 * `evidence.contentDigest` matches the actual posted content, and every
 * interaction that resolves a Session/Conversation carries
 * `evidence.agentVersionRef` naming the correct pinned `AgentDefinition`.
 *
 * **Issue #8 addition (credential binding, inverting the pre-#8
 * behaviour):** the credential attached in the main scenario above is
 * now pinned to the Conversation's OWN scope (not the Definition's) —
 * genuinely eligible, so it remains a meaningful happy-path assertion —
 * and {@link runCrossScopeCredentialRejectionScenario} additionally
 * proves the opposite case: a Credential pinned to a scope DIFFERENT
 * from the Conversation's now makes `createConversation` fail closed
 * with `Server.UnresolvedCredential`, where the pre-#8 version of this
 * file asserted that exact cross-scope attachment as correct.
 */
export async function runAuditChecks(server: ReferenceServer): Promise<CheckResult[]> {
  // Issue #7 Tranche A: this scenario drives writes against BOTH the
  // AgentDefinition's own scope (`publish`) and a deliberately distinct
  // Conversation scope (see below) — `actor` must be a member of both, or
  // the write-path authorization gate now landed on every interaction would
  // reject calls this scenario needs to succeed to exercise audit provenance.
  // Issue #8 adds a third membership, `CROSS_SCOPE_CONVERSATION_SCOPE_ID`:
  // `runCrossScopeCredentialRejectionScenario` below needs `actor` to clear
  // write-path scope authorization so the rejection it proves is genuinely
  // about credential binding, not merely "actor lacked standing there at all".
  const actor = authenticatedActorFactory(server, {
    registerInput: { scopeMemberships: [scopeFactory(), scopeFactory({ id: CONVERSATION_SCOPE_ID }), scopeFactory({ id: CROSS_SCOPE_CONVERSATION_SCOPE_ID })] },
  });
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
  // Issue #8: pinned to CONVERSATION_SCOPE_ID — the Conversation's OWN
  // scope, created just below — not the AgentDefinition's, so this is a
  // genuinely eligible binding (see CREDENTIAL_MCP_SERVER_URL's doc comment).
  const credential = server.registerCredential(
    registerCredentialInputFactory({ scope: scopeFactory({ id: CONVERSATION_SCOPE_ID }), mcpServerUrl: CREDENTIAL_MCP_SERVER_URL }),
  );
  // A SECOND Credential for the SAME mcpServerUrl, pinned to the
  // AgentDefinition's own scope instead — `runBuilderSessionScenario`
  // below (§ fallback provenance) drives a builder session off this SAME
  // `definition`, and a builder/test session's effective scope is the
  // Definition's own (`create-unbound-session.ts`'s doc comment), not the
  // Conversation's. Without this second, differently-scoped Credential,
  // that unrelated scope-provenance scenario would itself start failing
  // closed on `Server.UnresolvedCredential` — issue #8 correctly rejecting
  // a binding this scenario never meant to exercise. Two Credentials for
  // one URL is not ambiguous: each is eligible under a DIFFERENT
  // effectiveScope, so exactly one is ever eligible for any given call.
  server.registerCredential(registerCredentialInputFactory({ scope: definition.scope, mcpServerUrl: CREDENTIAL_MCP_SERVER_URL }));
  const before = server.listAuditEvents().length;

  await server.publish(definition.id, actor);
  // Give the Conversation a scope id distinct from the AgentDefinition's own
  // (the factory default `workspace_1`) so the provenance rows below are
  // distinguishable by VALUE: a source-swap — stamping the definition's scope
  // where the bound Conversation's is required (or vice versa on the fallback
  // row) — is caught, not merely a wrong-but-populated stamp.
  const conversationResult = await server.createConversation(
    createConversationInputFactory(server, definition.id, { scope: scopeFactory({ id: CONVERSATION_SCOPE_ID }), actor }),
  ); // Audited since S4 — asserted below like every other required what value.
  if (!conversationResult.ok) return [failed('audit: scenario setup', conversationResult.error.message)];
  const conversationSessionId = conversationResult.value.currentSessionId;

  await server.send(conversationSessionId, `${mockSentinels.toolUsePrefix}lookup`, actor);
  await server.drain(conversationSessionId, actor);
  await server.stream(conversationSessionId, actor);
  await server.sendToolResult(conversationSessionId, 'irrelevant_for_this_check', {}, actor); // failure outcome is still a valid emission
  await server.editAgentDefinitionDraft(definition.id);
  await server.publish(definition.id, actor);
  const migrateResult = await server.migrate(conversationResult.value.id, actor);

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

  // Issue #8 teeth: the inverted cross-scope scenario. Before #8, a
  // Credential pinned to the AgentDefinition's scope attached to a
  // Conversation created in an entirely different scope (this file's own
  // prior version asserted exactly that as a PASS). Now the opposite MUST
  // hold: createConversation fails closed with Server.UnresolvedCredential
  // and its AuditEvent records the failure with no credential attached.
  const crossScopeName =
    "audit: createConversation rejects (fails closed) a credential-required grant whose only Credential is pinned to a scope different from the Conversation's own";
  const crossScopeScenario = await runCrossScopeCredentialRejectionScenario(server, actor);
  if (!crossScopeScenario.ok) {
    checks.push(failed(crossScopeName, crossScopeScenario.error));
  } else {
    const crossScopeEvent = crossScopeScenario.value.emitted.find((event) => event.what === 'createConversation');
    const crossScopeOk = crossScopeEvent?.outcome === 'failure' && (crossScopeEvent.refs.credentialIds ?? []).length === 0;
    checks.push(
      crossScopeOk
        ? passed(crossScopeName)
        : failed(crossScopeName, `expected exactly one createConversation AuditEvent{outcome:'failure', refs.credentialIds: []}, got ${JSON.stringify(crossScopeEvent)}`),
    );
  }

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
  const builderScenario = await runBuilderSessionScenario(server, definition.id, actor);
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
  // exactly one AuditEvent — outcome: 'not_found', naming the actor-asserted
  // (nonexistent) target under the relevant refs field — instead of
  // returning silently, for every one of the seven interactions.
  const notFoundScenario = await runNotFoundScenario(server, actor);
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
