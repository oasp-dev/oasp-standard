import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import type { AuthenticatedActor } from '../auth/authenticated-actor.types';
import { authorize } from '../auth/authorize';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { computeContentDigest } from '../audit/compute-content-digest';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveScopeForSession } from '../audit/resolve-scope-for-session';
import { formatPrincipalRef } from '../format-principal-ref';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';

/**
 * `send` — `docs/spec/interactions.md` § `send`. Enforces the
 * current-session check: a Session belonging to a `Conversation` MUST
 * be that Conversation's `currentSessionId` to accept new `send`
 * traffic — a Session superseded by `migrate` (now only in
 * `previousSessionIds`) MUST NOT. Builder/test-session Sessions (no
 * bound Conversation) are exempt, per that same section's note.
 *
 * The `sessionNotFound` precondition failure below also emits an
 * `AuditEvent` — `outcome: 'not_found'`, `refs.sessionId` naming the
 * caller-asserted (nonexistent) target, `scope` omitted — rather than
 * returning silently, per `docs/spec/audit.md` § Not-found
 * preconditions (issue #11). `evidence.contentDigest` is populated on
 * every emitted `send` AuditEvent regardless of outcome, including this
 * one: the caller-supplied `content` is known whether or not a Session
 * exists to receive it.
 */
export async function sendInteraction(
  state: ServerState,
  provider: AgentProvider,
  clock: Clock,
  sessionId: string,
  content: string,
  actor: AuthenticatedActor,
): Promise<Result<void, DomainError>> {
  const contentDigest = computeContentDigest(content);
  const who = buildAuditWho(state, actor);
  const session = state.sessions.get(sessionId);
  if (!session) {
    emitAuditEvent(state, clock, {
      who,
      what: 'send',
      outcome: 'not_found',
      refs: { sessionId },
      evidence: buildAuditEvidence({ contentDigest }),
    });
    return err(serverErrors.sessionNotFound(sessionId));
  }

  // Issue #7 Tranche A: authorize against the Session's resolved scope
  // before the current-session check or posting to the provider.
  const scope = resolveScopeForSession(state, session);
  const authorization = authorize(actor, scope);
  if (!authorization.ok) {
    emitAuditEvent(state, clock, {
      who,
      what: 'send',
      scope,
      outcome: 'failure',
      refs: { sessionId },
      evidence: buildAuditEvidence({ contentDigest, agentVersionRef: session.pinnedAgentVersion }),
    });
    return err(authorization.error);
  }

  const conversationId = state.sessionConversation.get(sessionId);
  if (conversationId) {
    const conversation = state.conversations.get(conversationId);
    if (conversation && conversation.currentSessionId !== sessionId) {
      emitAuditEvent(state, clock, {
        who,
        what: 'send',
        scope: conversation.scope,
        outcome: 'failure',
        refs: { sessionId },
        evidence: buildAuditEvidence({ contentDigest, agentVersionRef: session.pinnedAgentVersion }),
      });
      return err(serverErrors.sessionNotCurrent(sessionId, conversationId));
    }
  }

  const sendResult = await provider.sendMessage(sessionId, content, formatPrincipalRef(who.principal));

  emitAuditEvent(state, clock, {
    who,
    what: 'send',
    scope,
    outcome: sendResult.ok ? 'success' : 'failure',
    refs: { sessionId },
    evidence: buildAuditEvidence({ contentDigest, agentVersionRef: session.pinnedAgentVersion }),
  });

  return sendResult.ok ? ok(undefined) : err(serverErrors.adapterFailure('sendMessage', sendResult.error.message));
}
