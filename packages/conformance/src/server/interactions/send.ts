import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { Clock } from '../../shared/clock.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { buildAuditEvidence } from '../audit/build-audit-evidence';
import { buildAuditWho } from '../audit/build-audit-who';
import { computeContentDigest } from '../audit/compute-content-digest';
import { emitAuditEvent } from '../audit/emit-audit-event';
import { resolveScopeForSession } from '../audit/resolve-scope-for-session';
import type { CallerContext } from '../caller-context.types';
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
  caller: CallerContext,
): Promise<Result<void, DomainError>> {
  const contentDigest = computeContentDigest(content);
  const session = state.sessions.get(sessionId);
  if (!session) {
    emitAuditEvent(state, clock, {
      who: buildAuditWho(caller),
      what: 'send',
      outcome: 'not_found',
      refs: { sessionId },
      evidence: buildAuditEvidence({ contentDigest }),
    });
    return err(serverErrors.sessionNotFound(sessionId));
  }

  const conversationId = state.sessionConversation.get(sessionId);
  if (conversationId) {
    const conversation = state.conversations.get(conversationId);
    if (conversation && conversation.currentSessionId !== sessionId) {
      emitAuditEvent(state, clock, {
        who: buildAuditWho(caller),
        what: 'send',
        scope: conversation.scope,
        outcome: 'failure',
        refs: { sessionId },
        evidence: buildAuditEvidence({ contentDigest, agentVersionRef: session.pinnedAgentVersion }),
      });
      return err(serverErrors.sessionNotCurrent(sessionId, conversationId));
    }
  }

  const sendResult = await provider.sendMessage(sessionId, content, formatPrincipalRef(caller.principal));

  emitAuditEvent(state, clock, {
    who: buildAuditWho(caller),
    what: 'send',
    scope: resolveScopeForSession(state, session),
    outcome: sendResult.ok ? 'success' : 'failure',
    refs: { sessionId },
    evidence: buildAuditEvidence({ contentDigest, agentVersionRef: session.pinnedAgentVersion }),
  });

  return sendResult.ok ? ok(undefined) : err(serverErrors.adapterFailure('sendMessage', sendResult.error.message));
}
