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
 * `sendToolResult` — `docs/spec/interactions.md` § `sendToolResult`.
 * Correlation to a currently-pending tool use (by `toolUseId`) is
 * enforced by the adapter itself (`AgentProvider.sendToolResult` MUST
 * reject an unknown `toolUseId` — see `docs/spec/adapters.md`); this
 * interaction delegates directly rather than duplicating that check,
 * translating an adapter rejection into a failed, audited `Result`.
 *
 * The `sessionNotFound` precondition failure below also emits an
 * `AuditEvent` — `outcome: 'not_found'`, `refs.sessionId` naming the
 * caller-asserted (nonexistent) target, `scope` omitted — rather than
 * returning silently, per `docs/spec/audit.md` § Not-found
 * preconditions (issue #11).
 */
export async function sendToolResultInteraction(
  state: ServerState,
  provider: AgentProvider,
  clock: Clock,
  sessionId: string,
  toolUseId: string,
  result: unknown,
  caller: CallerContext,
): Promise<Result<void, DomainError>> {
  const session = state.sessions.get(sessionId);
  if (!session) {
    emitAuditEvent(state, clock, { who: buildAuditWho(caller), what: 'sendToolResult', outcome: 'not_found', refs: { sessionId } });
    return err(serverErrors.sessionNotFound(sessionId));
  }

  const postResult = await provider.sendToolResult(sessionId, toolUseId, result);

  emitAuditEvent(state, clock, {
    who: buildAuditWho(caller),
    what: 'sendToolResult',
    scope: resolveScopeForSession(state, session),
    outcome: postResult.ok ? 'success' : 'failure',
    refs: { sessionId },
    evidence: buildAuditEvidence({ agentVersionRef: session.pinnedAgentVersion }),
  });

  return postResult.ok ? ok(undefined) : err(serverErrors.adapterFailure('sendToolResult', postResult.error.message));
}
