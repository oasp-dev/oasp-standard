import type { Scope, Session } from '@oasp/schemas';
import type { ServerState } from '../store/server-state';

/**
 * Resolves the `scope` an `AuditEvent` for a Session-targeting
 * interaction (`send` / `sendToolResult` / `drain` / `stream`) MUST
 * carry, per `docs/spec/audit.md` § Scope provenance:
 *
 * - a Session bound to a Conversation → that Conversation's `scope`;
 * - a Session with no Conversation (builder / test-session) → the
 *   `scope` of the `AgentDefinition` version the Session is pinned to.
 *
 * This total: every Session is pinned to an AgentDefinition version,
 * and every AgentDefinition carries a `scope`, so this function never
 * needs to return "no scope" — the one case it cannot resolve (a
 * Session pinned to an AgentDefinition id absent from `state`) is an
 * invariant violation elsewhere in the server, not a legitimate
 * "unpopulatable scope" per `audit.md`'s own totality argument, and is
 * surfaced as a thrown error rather than swallowed.
 */
export function resolveScopeForSession(state: ServerState, session: Session): Scope {
  const conversationId = state.sessionConversation.get(session.id);
  const conversation = conversationId ? state.conversations.get(conversationId) : undefined;
  if (conversation) return conversation.scope;

  const definition = state.agentDefinitions.get(session.pinnedAgentVersion.agentDefinitionId);
  if (!definition) {
    throw new Error(
      `Invariant violated: session "${session.id}" is pinned to unknown AgentDefinition "${session.pinnedAgentVersion.agentDefinitionId}".`,
    );
  }
  return definition.scope;
}
