import type { AgentDefinition } from '@oasp/schemas';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import type { CallerContext } from '../caller-context.types';
import { serverErrors } from '../server-errors';
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
  caller: CallerContext,
): Promise<Result<AgentDefinition, DomainError>> {
  const definition = state.agentDefinitions.get(definitionId);
  if (!definition) {
    emitAuditEvent(state, clock, { who: buildAuditWho(caller), what: 'publish', outcome: 'not_found', refs: { definitionId } });
    return err(serverErrors.definitionNotFound(definitionId));
  }

  const updated: AgentDefinition =
    definition.publishedVersion === definition.draftVersion
      ? definition
      : { ...definition, publishedVersion: definition.draftVersion };
  state.agentDefinitions.set(definitionId, updated);

  emitAuditEvent(state, clock, {
    who: buildAuditWho(caller),
    what: 'publish',
    scope: updated.scope,
    outcome: 'success',
    refs: { definitionId },
  });

  return ok(updated);
}
