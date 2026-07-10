import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, type Result } from '../../shared/result';
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
  if (!session) return err(serverErrors.sessionNotFound(sessionId));

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
  });

  return outcome;
}
