import type { Scope } from '@oasp/schemas';
import type { DomainError } from '../shared/domain-error.types';

/**
 * Domain errors the reference server's setup helpers and seven
 * interactions return. Centralised so `code` values are stable across
 * call sites (see `docs/oasp-v0-concept.md` § Error Handling — Result
 * Pattern in the project's TypeScript conventions).
 */
export const serverErrors = {
  /** No `AgentDefinition` exists with the given id. */
  definitionNotFound: (id: string): DomainError => ({
    code: 'Server.DefinitionNotFound',
    message: `No AgentDefinition found with id "${id}".`,
  }),
  /** No `Conversation` exists with the given id. */
  conversationNotFound: (id: string): DomainError => ({
    code: 'Server.ConversationNotFound',
    message: `No Conversation found with id "${id}".`,
  }),
  /** No `Session` exists with the given id. */
  sessionNotFound: (id: string): DomainError => ({
    code: 'Server.SessionNotFound',
    message: `No Session found with id "${id}".`,
  }),
  /** `send` was targeted at a Session that has been superseded by `migrate` — it is no longer its Conversation's `currentSessionId`. */
  sessionNotCurrent: (sessionId: string, conversationId: string): DomainError => ({
    code: 'Server.SessionNotCurrent',
    message: `Session "${sessionId}" is not the current session of Conversation "${conversationId}"; it has been superseded by migrate.`,
  }),
  /** `drain` could not bring the session back to `idle` — a blocking tool use failed fatally. */
  drainFailed: (sessionId: string, detail: string): DomainError => ({
    code: 'Server.DrainFailed',
    message: `Drain failed for session "${sessionId}": ${detail}`,
  }),
  /** An `AgentProvider` operation the interaction depended on failed. */
  adapterFailure: (operation: string, detail: string): DomainError => ({
    code: 'Server.AdapterFailure',
    message: `Adapter operation "${operation}" failed: ${detail}`,
  }),
  /** A pending tool call's name/server is not covered by the Session's pinned AgentDefinition version's granted tools — `drain` MUST reject it before any dispatch (`docs/spec/interactions.md` § `drain`'s authorization clause, issue #9), never invoking the `ToolExecutor` for it. */
  unauthorizedToolCall: (sessionId: string, toolName: string, reason: string): DomainError => ({
    code: 'Server.UnauthorizedToolCall',
    message: `Session "${sessionId}" pending tool call "${toolName}" is not authorized by the pinned AgentDefinition: ${reason}`,
  }),
  /** A session/conversation could not be created because its `AgentDefinition` has not been deployed to a provider yet. */
  notDeployed: (agentDefinitionId: string): DomainError => ({
    code: 'Server.NotDeployed',
    message: `AgentDefinition "${agentDefinitionId}" has not been deployed to a provider.`,
  }),
  /** A real `Conversation` cannot be created against an `AgentDefinition` that has never been published — see `docs/spec/target-version-resolution.md`'s MUST NOT substitute `draftVersion` for a real conversation merely because `publishedVersion` is unset. */
  neverPublished: (agentDefinitionId: string): DomainError => ({
    code: 'Server.NeverPublished',
    message: `AgentDefinition "${agentDefinitionId}" has never been published; a real Conversation cannot be pinned to unpublished draft content.`,
  }),
  /** `authenticate()` was given a `principalId` (or delegation `onBehalfOfPrincipalId`) that names no registered `Principal` — the trust boundary fails closed rather than minting an `AuthenticatedActor` for an unknown party (issue #7 Tranche A). */
  authenticationFailed: (principalId: string): DomainError => ({
    code: 'Server.AuthenticationFailed',
    message: `No registered Principal found with id "${principalId}"; authentication failed.`,
  }),
  /** `authorize()` rejected an actor against a target `Scope` — either the actor asserted a scope selection outright (e.g. `createConversation`'s `input.scope`) or it attempted a write against a resource's own scope, and neither the actor's `scopeMemberships` (un-delegated) nor its `scopePin` (delegated) covers it. Deliberately `unauthorized`, never `notFound`: the actor is asserting a scope it is not a member of, not probing for a concealed resource — see this tranche's PR description for why that distinction is a deliberate design choice, not an oversight. */
  unauthorized: (principalId: string, scope: Scope, reason: string): DomainError => ({
    code: 'Server.Unauthorized',
    message: `Principal "${principalId}" is not authorized against scope {level: "${scope.level}", id: "${scope.id}"}: ${reason}`,
  }),
} as const;
