import type { Event } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveScopeForSession } from '../audit/resolve-scope-for-session';
import type { CallerContext } from '../caller-context.types';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';

/**
 * `stream` — `docs/spec/interactions.md` § `stream`. Unlike the other
 * five interactions, this is a read path — audited anyway, per the
 * FHIR posture the standard inherits ("what did the agent do, **or
 * have observed of it**"). The audit event is emitted synchronously
 * when `stream` is invoked, not deferred until the returned iterable
 * is consumed (or abandoned) — "emitted for every invocation" means
 * every call to this function, not every event yielded from it.
 *
 * The `sessionNotFound` precondition failure below also emits an
 * `AuditEvent` — `outcome: 'not_found'`, `refs.sessionId` naming the
 * caller-asserted (nonexistent) target, `scope` omitted — rather than
 * returning silently, per `docs/spec/audit.md` § Not-found
 * preconditions (issue #11).
 */
export async function streamInteraction(
  state: ServerState,
  provider: AgentProvider,
  clock: Clock,
  sessionId: string,
  caller: CallerContext,
): Promise<Result<AsyncIterable<Event>, DomainError>> {
  const session = state.sessions.get(sessionId);
  if (!session) {
    emitAuditEvent(state, clock, { who: buildAuditWho(caller), what: 'stream', outcome: 'not_found', refs: { sessionId } });
    return err(serverErrors.sessionNotFound(sessionId));
  }

  emitAuditEvent(state, clock, {
    who: buildAuditWho(caller),
    what: 'stream',
    scope: resolveScopeForSession(state, session),
    outcome: 'success',
    refs: { sessionId },
    evidence: buildAuditEvidence({ agentVersionRef: session.pinnedAgentVersion }),
  });

  return ok(provider.streamEvents(sessionId));
}
