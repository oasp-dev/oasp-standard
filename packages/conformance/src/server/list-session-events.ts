import type { AgentProvider } from '../adapter/agent-provider.types';
import type { ListSessionEventsOptions, ListSessionEventsResult } from '../adapter/list-session-events.types';
import type { DomainError } from '../shared/domain-error.types';
import { err, type Result } from '../shared/result';
import { serverErrors } from './server-errors';
import type { ServerState } from './store/server-state';

/**
 * Portable full-history read for a Session: `docs/spec/interactions.md`
 * § `stream` makes `listSessionEvents` the normative paginated
 * derive-on-read fallback **and** the audit source for a Session's
 * event history. Unlike `ReferenceServer.stream()` — which reproduces
 * SSE semantics and terminates at the session's *first*
 * `status: 'idle'` (or non-recoverable `error`) Event — this returns
 * the session's FULL stored history regardless of how many
 * running/idle cycles (e.g. repeated `migrate` seedings) it spans.
 *
 * Not one of the six audited interactions: it carries no `AuditEvent`
 * emission of its own — `docs/spec/audit.md`'s required-emission set is
 * a closed six-value enum and this is not in it — so this is a plain
 * observability accessor, like `getSession`/`getConversation`, that
 * happens to need the provider (not just `state`) because Event
 * history is provider-owned, never mirrored into `ServerState`.
 */
export async function listSessionEventsAccessor(
  state: ServerState,
  provider: AgentProvider,
  sessionId: string,
  options?: ListSessionEventsOptions,
): Promise<Result<ListSessionEventsResult, DomainError>> {
  if (!state.sessions.has(sessionId)) return err(serverErrors.sessionNotFound(sessionId));

  const result = await provider.listSessionEvents(sessionId, options);
  return result.ok ? result : err(serverErrors.adapterFailure('listSessionEvents', result.error.message));
}
