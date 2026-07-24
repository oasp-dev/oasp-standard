import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, type Result } from '../../shared/result';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';
import { authorize } from '../auth/authorize';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveScopeForSession } from '../audit/resolve-scope-for-session';
import { serverErrors } from '../server-errors';
import { getAgentDefinitionVersion } from '../store/agent-definition-version-store';
import type { ServerState } from '../store/server-state';
import type { ToolExecutor } from '../tool-executor.types';
import type { DrainOutcome } from './drain.types';
import { runDrainToIdle } from './run-drain-to-idle';

/**
 * `drain` — `docs/spec/interactions.md` § `drain`. The client-facing,
 * audited entry point; the normative recovery logic itself lives in
 * `run-drain-to-idle.ts` so `migrate`'s internal Stage 3 can reuse it.
 * Resolves the Session's pinned `AgentDefinitionVersion` snapshot (not
 * the live `AgentDefinition` — issue #10) so `runDrainToIdle` can
 * authorize each pending tool call against ITS OWN granted tools before
 * dispatch (issue #9), even if the live `AgentDefinition` has since
 * been edited (a later, still-unpublished draft edit) or a later
 * version published — the pinned-version reachability this interaction
 * already had (it holds the `Session`) is exactly what closes both
 * gaps: #9's pre-dispatch authorization, and #10's version isolation
 * from later edits.
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
  actor: AuthenticatedActor,
): Promise<Result<DrainOutcome, DomainError>> {
  const session = state.sessions.get(sessionId);
  if (!session) {
    emitAuditEvent(state, clock, { who: buildAuditWho(state, actor), what: 'drain', outcome: 'not_found', refs: { sessionId } });
    return err(serverErrors.sessionNotFound(sessionId));
  }

  // Issue #7 Tranche A: authorize against the Session's resolved scope
  // before enumerating or dispatching any pending tool call.
  const scope = resolveScopeForSession(state, session);
  const authorization = authorize(actor, scope);
  if (!authorization.ok) {
    emitAuditEvent(state, clock, { who: buildAuditWho(state, actor), what: 'drain', scope, outcome: 'failure', refs: { sessionId } });
    return err(authorization.error);
  }

  const definitionVersion = getAgentDefinitionVersion(state, session.pinnedAgentVersion);
  if (!definitionVersion) {
    throw new Error(
      `Invariant violated: session "${sessionId}" is pinned to AgentDefinition version ${session.pinnedAgentVersion.version} of "${session.pinnedAgentVersion.agentDefinitionId}", which has no recorded content snapshot.`,
    );
  }

  const outcome = await runDrainToIdle(provider, toolExecutor, definitionVersion, sessionId);

  emitAuditEvent(state, clock, {
    who: buildAuditWho(state, actor),
    what: 'drain',
    scope,
    outcome: outcome.ok ? 'success' : 'failure',
    refs: { sessionId },
    evidence: buildAuditEvidence({ agentVersionRef: session.pinnedAgentVersion }),
  });

  return outcome;
}
