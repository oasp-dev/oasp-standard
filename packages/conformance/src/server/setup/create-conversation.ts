import { conversationSchema, type AgentVersionRef, type Conversation } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import { err, ok, type Result } from '../../shared/result';
import type { DomainError } from '../../shared/domain-error.types';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveVaultIds } from '../credential/resolve-vault-ids';
import { serverErrors } from '../server-errors';
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
 * `who.principal` on the emitted `AuditEvent` is `input.initiatingPrincipal`
 * — the same value the resulting `Conversation.initiatingPrincipal`
 * carries. This is the natural read of "the Principal that performed
 * the interaction" for a *creating* interaction: the Principal starting
 * the Conversation and the Principal performing `createConversation`
 * are the same fact, stated once. The emitted `AuditEvent.who` *could*
 * in principle carry `onBehalfOf` — per `docs/spec/scope-and-identity.md`,
 * on-behalf-of is asserted per interaction in `AuditEvent.who`,
 * independent of what the `Conversation` resource itself carries — but
 * v0 does not model delegated conversation-creation: `createConversation`
 * has a single actor, the `initiatingPrincipal`, so `who` is emitted
 * self-only (no `onBehalfOf`), which reads unambiguously as "acted as
 * self". A follow-up could add an `onBehalfOf` to `CreateConversationInput`
 * to support delegated creation. Flagged as an interpretation call in
 * this slice's handback.
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
 * Precondition failures where no primary resource is yet identified
 * (`definitionNotFound`) emit no `AuditEvent` at all, mirroring
 * `publish`/`migrate`/`drain`'s established pattern for "target not
 * found." Once the target `AgentDefinition` is identified, every other
 * outcome — including failure — emits one `AuditEvent` using
 * `input.scope` (the same value the resulting Conversation's `scope`
 * would carry on success), per the required-emission set's "every
 * invocation," not "every successful invocation."
 */
export async function createConversationSetup(
  state: ServerState,
  provider: AgentProvider,
  clock: Clock,
  input: CreateConversationInput,
): Promise<Result<Conversation, DomainError>> {
  const definition = state.agentDefinitions.get(input.agentDefinitionId);
  if (!definition) return err(serverErrors.definitionNotFound(input.agentDefinitionId));

  const who = { principal: input.initiatingPrincipal };

  const deployment = state.deployments.get(definition.id);
  if (!deployment) {
    emitAuditEvent(state, clock, { who, what: 'createConversation', scope: input.scope, outcome: 'failure', refs: {} });
    return err(serverErrors.notDeployed(definition.id));
  }

  if (definition.publishedVersion === null) {
    emitAuditEvent(state, clock, { who, what: 'createConversation', scope: input.scope, outcome: 'failure', refs: {} });
    return err(serverErrors.neverPublished(definition.id));
  }
  const pinnedAgentVersion: AgentVersionRef = { agentDefinitionId: definition.id, version: definition.publishedVersion };

  const vaultIds = resolveVaultIds(definition, state.credentials);
  const resources = input.resources ?? [];

  const sessionResult = await provider.createSession({
    agentDefinitionId: definition.id,
    providerAgentId: deployment.providerAgentId,
    pinnedAgentVersion,
    resources,
    vaultIds,
  });
  if (!sessionResult.ok) {
    emitAuditEvent(state, clock, { who, what: 'createConversation', scope: input.scope, outcome: 'failure', refs: {} });
    return err(serverErrors.adapterFailure('createSession', sessionResult.error.message));
  }

  state.counters.conversation += 1;
  const conversationId = `conv_${state.counters.conversation}`;
  const conversation = conversationSchema.parse({
    id: conversationId,
    scope: input.scope,
    initiatingPrincipal: input.initiatingPrincipal,
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
  });

  return ok(conversation);
}
