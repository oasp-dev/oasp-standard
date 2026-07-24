import { conversationSchema, type AgentVersionRef, type Conversation } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import { err, ok, type Result } from '../../shared/result';
import type { DomainError } from '../../shared/domain-error.types';
import { authorize } from '../auth/authorize';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveVaultIds } from '../credential/resolve-vault-ids';
import { serverErrors } from '../server-errors';
import { getAgentDefinitionVersion } from '../store/agent-definition-version-store';
import type { ServerState } from '../store/server-state';
import type { CreateConversationInput } from './create-conversation-input.types';

/**
 * `createConversation` — `docs/spec/interactions.md` § `createConversation`.
 * Mints the **first** `Session` a brand-new `Conversation` ever rides
 * on: mounts `resources[]`, resolves and attaches `vaultIds[]`, and
 * pins the new Session (and therefore the new Conversation) to the
 * target `AgentDefinition`'s `publishedVersion`. This is one of the
 * seven audited interactions (`what: 'createConversation'`) — the
 * emission point for a Conversation's *initial* credential attachment,
 * closing the gap `docs/spec/audit.md` § Credential attachment is
 * audited (`createConversation` and `migrate`) tracked as
 * v0-release-blocking before S4 ([issue #5](https://github.com/FieldstateNZ/oasp-standard/issues/5)).
 *
 * **Issue #7 Tranche A — identity now comes from `input.actor`, never a
 * bare caller claim:** `who` is built via `buildAuditWho(state, input.actor)`
 * — the same helper every other audited interaction now uses — and the
 * resulting `Conversation.initiatingPrincipal` is set to that same
 * `who.principal`, so the two can never independently drift (the
 * pre-Tranche-A version accepted a separate, caller-supplied
 * `initiatingPrincipal` field, which was exactly the same
 * request-body-assertion trust gap `CallerContext` had elsewhere).
 * `input.actor` CAN carry a `delegation` (this interaction does support
 * on-behalf-of, unlike the earlier revision's note below assumed): when
 * it does, `who.onBehalfOf` is populated from
 * `actor.delegation.onBehalfOf`, and `input.scope` is authorized against
 * `actor.delegation.scopePin` (never against either party's
 * `scopeMemberships`) — see `auth/authorize.ts`.
 *
 * Before that identity check, `input.scope` and the target
 * `AgentDefinition`'s own `scope` are BOTH authorized against
 * `input.actor` — see the two `authorize()` calls below. This is new
 * write-path authorization Tranche A adds; previously `input.scope` was
 * accepted and stamped onto the new `Conversation` with no check that
 * the caller had any standing in it at all.
 *
 * **Interpretation, revised per the dev lead's sign-off:**
 * `docs/spec/target-version-resolution.md`'s table is scoped to what a
 * `migrate` call resolves toward; v0 specifies no target-version rule
 * for a Conversation's *initial* Session in so many words. But the same
 * document's own MUST NOT — "a resolver MUST NOT substitute
 * `draftVersion` for a real conversation merely because
 * `publishedVersion` happens to be unset... that would pin live, real
 * usage to unpublished, still-changing content" — applies just as much
 * at creation time as at `migrate` time; there is no principled reason
 * initial pinning should be held to a looser standard than every
 * subsequent `migrate` call is. This helper therefore **rejects**
 * creating a real `Conversation` while `publishedVersion` is `null`,
 * rather than silently falling back to `draftVersion` as an earlier
 * revision did. Since `publishedVersion` is monotonically
 * non-decreasing and v0 has no "unpublish" (`docs/spec/interactions.md`
 * § `publish`), this closes `target-version-resolution.md`'s "never
 * published" row for good: once this guard rejects at creation, no
 * real Conversation this server ever hands back can later reach
 * `migrate`'s "leave in place" precondition for that same reason — see
 * `conformance/checks/server/run-server-checks.ts`'s
 * `checkCreateConversationRejectsNeverPublishedDefinition` for the
 * portable check proving this. `docs/spec/target-version-resolution.md`
 * § Relationship to `createConversation` is now the spec-level home for
 * this same resolution.
 *
 * **Not-found precondition (issue #11):** `definitionNotFound` now also
 * emits an `AuditEvent` — `outcome: 'not_found'`, `refs.definitionId`
 * naming the caller-asserted (nonexistent) target — before returning,
 * rather than returning silently as it did before this slice (which
 * mirrored `publish`/`migrate`/`drain`'s then-identical gap for "target
 * not found"; all seven interactions close it together, see
 * `docs/spec/audit.md` § Not-found preconditions). Unlike the other six
 * interactions, `createConversation`'s `scope` here is `input.scope` —
 * caller-supplied, not resource-derived — so it remains populatable even
 * on this `not_found` outcome, the one exception `audit-event.ts`'s
 * `scope` doc comment calls out. Once the target `AgentDefinition` is
 * identified, every other outcome — including failure — emits one
 * `AuditEvent` using `input.scope` (the same value the resulting
 * Conversation's `scope` would carry on success), per the
 * required-emission set's "every invocation," not "every successful
 * invocation."
 */
export async function createConversationSetup(
  state: ServerState,
  provider: AgentProvider,
  clock: Clock,
  input: CreateConversationInput,
): Promise<Result<Conversation, DomainError>> {
  const who = buildAuditWho(state, input.actor);

  // Issue #7 Tranche A: `input.scope` is the actor's OWN scope selection
  // (which scope this Conversation will attach to) and MUST be authorized
  // against the actor before anything else — a caller asserting a scope it
  // has no standing in is rejected here regardless of whether the target
  // AgentDefinition even exists, so this runs before the definition lookup.
  const scopeAuthorization = authorize(input.actor, input.scope);
  if (!scopeAuthorization.ok) {
    emitAuditEvent(state, clock, {
      who,
      what: 'createConversation',
      scope: input.scope,
      outcome: 'failure',
      refs: { definitionId: input.agentDefinitionId },
    });
    return err(scopeAuthorization.error);
  }

  const definition = state.agentDefinitions.get(input.agentDefinitionId);
  if (!definition) {
    emitAuditEvent(state, clock, {
      who,
      what: 'createConversation',
      scope: input.scope,
      outcome: 'not_found',
      refs: { definitionId: input.agentDefinitionId },
    });
    return err(serverErrors.definitionNotFound(input.agentDefinitionId));
  }

  // The actor must ALSO be authorized against the target AgentDefinition's
  // own scope — a Conversation cannot be launched from a Definition the
  // actor cannot otherwise reach, independent of whatever scope it asserted
  // for the new Conversation itself (the two scopes may legitimately
  // differ — e.g. a definition shared at `tenant` scope backing
  // Conversations pinned at `workspace` scope — so both checks are
  // required, neither substitutes for the other).
  const definitionAuthorization = authorize(input.actor, definition.scope);
  if (!definitionAuthorization.ok) {
    emitAuditEvent(state, clock, { who, what: 'createConversation', scope: input.scope, outcome: 'failure', refs: { definitionId: definition.id } });
    return err(definitionAuthorization.error);
  }

  const deployment = state.deployments.get(definition.id);
  if (!deployment) {
    emitAuditEvent(state, clock, { who, what: 'createConversation', scope: input.scope, outcome: 'failure', refs: { definitionId: definition.id } });
    return err(serverErrors.notDeployed(definition.id));
  }

  if (definition.publishedVersion === null) {
    emitAuditEvent(state, clock, { who, what: 'createConversation', scope: input.scope, outcome: 'failure', refs: { definitionId: definition.id } });
    return err(serverErrors.neverPublished(definition.id));
  }
  const pinnedAgentVersion: AgentVersionRef = { agentDefinitionId: definition.id, version: definition.publishedVersion };

  // Resolves against the pinned version's immutable content snapshot (issue
  // #10), not the live `AgentDefinition` — `publishedVersion` was frozen the
  // instant it was minted (`createAgentDefinitionSetup` / `editAgentDefinitionDraftSetup`),
  // so this should never be missing; an invariant violation, not a
  // legitimate failure outcome, if it somehow is.
  const versionSnapshot = getAgentDefinitionVersion(state, pinnedAgentVersion);
  if (!versionSnapshot) {
    throw new Error(`Invariant violated: AgentDefinition "${definition.id}" version ${pinnedAgentVersion.version} has no recorded content snapshot.`);
  }

  const vaultIds = resolveVaultIds(versionSnapshot, state.credentials);
  const resources = input.resources ?? [];

  const sessionResult = await provider.createSession({
    agentDefinitionId: definition.id,
    providerAgentId: deployment.providerAgentId,
    pinnedAgentVersion,
    resources,
    vaultIds,
  });
  if (!sessionResult.ok) {
    emitAuditEvent(state, clock, {
      who,
      what: 'createConversation',
      scope: input.scope,
      outcome: 'failure',
      refs: { definitionId: definition.id },
      evidence: buildAuditEvidence({ agentVersionRef: pinnedAgentVersion }),
    });
    return err(serverErrors.adapterFailure('createSession', sessionResult.error.message));
  }

  state.counters.conversation += 1;
  const conversationId = `conv_${state.counters.conversation}`;
  const conversation = conversationSchema.parse({
    resourceType: 'Conversation',
    id: conversationId,
    scope: input.scope,
    initiatingPrincipal: who.principal,
    currentSessionId: sessionResult.value.id,
    pinnedAgentVersion,
    previousSessionIds: [],
  });

  state.conversations.set(conversationId, conversation);
  state.sessions.set(sessionResult.value.id, sessionResult.value);
  state.sessionKind.set(sessionResult.value.id, 'real');
  state.sessionConversation.set(sessionResult.value.id, conversationId);

  emitAuditEvent(state, clock, {
    who,
    what: 'createConversation',
    scope: conversation.scope,
    outcome: 'success',
    refs: { conversationId, sessionId: sessionResult.value.id, credentialIds: [...vaultIds] },
    evidence: buildAuditEvidence({ agentVersionRef: pinnedAgentVersion }),
  });

  return ok(conversation);
}
