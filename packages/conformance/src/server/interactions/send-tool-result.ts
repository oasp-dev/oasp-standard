import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
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
  if (!session) return err(serverErrors.sessionNotFound(sessionId));

  const postResult = await provider.sendToolResult(sessionId, toolUseId, result);

  emitAuditEvent(state, clock, {
    who: buildAuditWho(caller),
    what: 'sendToolResult',
    scope: resolveScopeForSession(state, session),
    outcome: postResult.ok ? 'success' : 'failure',
    refs: { sessionId },
  });

  return postResult.ok ? ok(undefined) : err(serverErrors.adapterFailure('sendToolResult', postResult.error.message));
}
