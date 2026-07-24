import type { AgentDefinition } from '@oasp/schemas';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';
import { authorize } from '../auth/authorize';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { serverErrors } from '../server-errors';
import { getAgentDefinitionVersion } from '../store/agent-definition-version-store';
import type { ServerState } from '../store/server-state';

/**
 * `publish` — `docs/spec/interactions.md` § `publish`. Sets the target
 * `AgentDefinition.publishedVersion` to its current `draftVersion`.
 * MUST NOT touch any `Conversation`/`Session` — this implementation
 * never reads or mutates either. Idempotent: a repeat call with no
 * intervening draft edit is a no-op (still emits an audit event, since
 * the required-emission set is "every invocation," not "every
 * mutating invocation").
 *
 * **Issue #7 Tranche A:** takes a server-minted `AuthenticatedActor`,
 * never a caller-asserted `CallerContext`, and authorizes it against
 * `definition.scope` (`auth/authorize.ts`) before the invariant
 * assertion or the mutation below — an unauthorized caller's failure is
 * audited (`outcome: 'failure'`) exactly like any other rejected write.
 *
 * **Content-freezing (issue #10):** `publish` deliberately does NOT
 * itself freeze `draftVersion`'s content into an `AgentDefinitionVersion`
 * snapshot here. It only ever moves `publishedVersion` to point at a
 * `draftVersion` whose content was already frozen the instant that
 * version number was minted — `setup/create-agent-definition.ts` for
 * `draftVersion: 1`, `setup/edit-agent-definition-draft.ts` for every
 * later bump (see `store/agent-definition-version-store.ts`'s doc
 * comment for why freezing at mint-time, rather than at publish-time,
 * is what also keeps builder/test-session pins to an unpublished
 * `draftVersion` version-isolated, not just published ones). What
 * `publish` DOES do instead is assert the invariant that freezing
 * mechanism depends on: the version it is about to publish MUST
 * already have a recorded snapshot. If it doesn't, every future
 * credential/tool-grant resolution against this `publishedVersion`
 * would silently resolve nothing — a bug in the snapshot mechanism
 * itself, not a legitimate runtime failure, hence the thrown invariant
 * violation below rather than a `DomainError` result.
 *
 * The `definitionNotFound` precondition failure below also emits an
 * `AuditEvent` — `outcome: 'not_found'`, `refs.definitionId` naming the
 * caller-asserted (nonexistent) target, `scope` omitted (no
 * `AgentDefinition` was ever identified to source one from) — rather
 * than returning silently. `docs/spec/audit.md` § Not-found
 * preconditions (issue #11) closes this: a probe against an unknown
 * `definitionId` MUST leave a distinguishable trace, the same as any
 * other invocation of one of the seven interactions.
 */
export async function publishInteraction(
  state: ServerState,
  clock: Clock,
  definitionId: string,
  actor: AuthenticatedActor,
): Promise<Result<AgentDefinition, DomainError>> {
  const definition = state.agentDefinitions.get(definitionId);
  if (!definition) {
    emitAuditEvent(state, clock, { who: buildAuditWho(state, actor), what: 'publish', outcome: 'not_found', refs: { definitionId } });
    return err(serverErrors.definitionNotFound(definitionId));
  }

  // Issue #7 Tranche A: authorize before any side effect (and before the
  // invariant assertion below, which is a reference-server bug condition,
  // not a legitimate outcome an unauthorized caller should be able to probe
  // for).
  const authorization = authorize(actor, definition.scope);
  if (!authorization.ok) {
    emitAuditEvent(state, clock, { who: buildAuditWho(state, actor), what: 'publish', scope: definition.scope, outcome: 'failure', refs: { definitionId } });
    return err(authorization.error);
  }

  if (!getAgentDefinitionVersion(state, { agentDefinitionId: definitionId, version: definition.draftVersion })) {
    throw new Error(`Invariant violated: AgentDefinition "${definitionId}" draftVersion ${definition.draftVersion} has no recorded content snapshot.`);
  }

  const updated: AgentDefinition =
    definition.publishedVersion === definition.draftVersion
      ? definition
      : { ...definition, publishedVersion: definition.draftVersion };
  state.agentDefinitions.set(definitionId, updated);

  emitAuditEvent(state, clock, {
    who: buildAuditWho(state, actor),
    what: 'publish',
    scope: updated.scope,
    outcome: 'success',
    refs: { definitionId },
  });

  return ok(updated);
}
