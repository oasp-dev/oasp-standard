import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, type Result } from '../../shared/result';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveScopeForSession } from '../audit/resolve-scope-for-session';
import type { CallerContext } from '../caller-context.types';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';
import type { ToolExecutor } from '../tool-executor.types';
import type { DrainOutcome } from './drain.types';
import { runDrainToIdle } from './run-drain-to-idle';

/**
 * `drain` — `docs/spec/interactions.md` § `drain`. The client-facing,
 * audited entry point; the normative recovery logic itself lives in
 * `run-drain-to-idle.ts` so `migrate`'s internal Stage 3 can reuse it.
 * Resolves the Session's pinned `AgentDefinition` version via
 * `ServerState` so `runDrainToIdle` can authorize each pending tool
 * call against its granted tools before dispatch (issue #9) — the
 * pinned-version reachability this interaction already had (it holds
 * the `Session`) is exactly what closes that gap.
 *
 * The `sessionNotFound` precondition failure below also emits an
 * `AuditEvent` — `outcome: 'not_found'`, `refs.sessionId` naming the
 * caller-asserted (nonexistent) target, `scope` omitted — rather than
 * returning silently, per `docs/spec/audit.md` § Not-found
 * preconditions (issue #11). This closes the same gap for `drain` that
 * issue #9's pre-dispatch tool-call authorization check does NOT need
 * separate handling here for: an unauthorized carried tool call is
 * surfaced by `runDrainToIdle` as an ordinary drain failure, already
 * covered by the unconditional `outcome.ok ? 'success' : 'failure'`
 * emission below (this was already correct before this slice; verified,
 * not re-fixed).
 */
export async function drainInteraction(
  state: ServerState,
  provider: AgentProvider,
  toolExecutor: ToolExecutor,
  clock: Clock,
  sessionId: string,
  caller: CallerContext,
): Promise<Result<DrainOutcome, DomainError>> {
  const session = state.sessions.get(sessionId);
  if (!session) {
    emitAuditEvent(state, clock, { who: buildAuditWho(caller), what: 'drain', outcome: 'not_found', refs: { sessionId } });
    return err(serverErrors.sessionNotFound(sessionId));
  }

  const definition = state.agentDefinitions.get(session.pinnedAgentVersion.agentDefinitionId);
  if (!definition) {
    throw new Error(`Invariant violated: session "${sessionId}" is pinned to an unknown AgentDefinition.`);
  }

  const outcome = await runDrainToIdle(provider, toolExecutor, definition, sessionId);

  emitAuditEvent(state, clock, {
    who: buildAuditWho(caller),
    what: 'drain',
    scope: resolveScopeForSession(state, session),
    outcome: outcome.ok ? 'success' : 'failure',
    refs: { sessionId },
    evidence: buildAuditEvidence({ agentVersionRef: session.pinnedAgentVersion }),
  });

  return outcome;
}
