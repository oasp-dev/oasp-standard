import type { AgentDefinition, AuditEvent, Conversation, Credential, Event, Session } from '@oasp/schemas';
import type { ListSessionEventsOptions, ListSessionEventsResult } from '../adapter/list-session-events.types';
import type { ConformanceSelfReport } from '../conformance/self-report.types';
import type { DomainError } from '../shared/domain-error.types';
import type { Result } from '../shared/result';
import type { CallerContext } from './caller-context.types';
import type { DrainOutcome } from './interactions/drain.types';
import type { CreateAgentDefinitionInput } from './setup/create-agent-definition-input.types';
import type { CreateConversationInput } from './setup/create-conversation-input.types';
import type { RegisterCredentialInput } from './setup/register-credential-input.types';

/**
 * A minimal, conformant OASP v0 Server implementation, backed by an
 * injected `AgentProvider` — see `create-reference-server.ts`.
 * Everything in this interface splits into two groups:
 *
 * 1. **Setup helpers** (`createAgentDefinition`, `registerCredential`,
 *    `createBuilderSession`, `createTestSession`,
 *    `editAgentDefinitionDraft`) — not part of the seven audited
 *    interactions; they exist so a test can build a scenario (an
 *    AgentDefinition, a registered Credential) to then drive the seven
 *    interactions against. `createBuilderSession` / `createTestSession`
 *    deliberately stay unaudited setup helpers even after S4: neither
 *    mints a durable `Conversation` (see
 *    `docs/spec/conversation-and-session.md`), both are dev-time
 *    scaffolding to preview/validate an `AgentDefinition` before it is
 *    ever exposed to a real user, and nothing in the required-emission
 *    set's boundary changes that.
 * 2. **The seven audited interactions** (`publish`, `createConversation`,
 *    `migrate`, `drain`, `stream`, `send`, `sendToolResult`) — the
 *    normative surface this package's conformance checks exercise.
 *    `createConversation` mints the first Session for a brand-new
 *    Conversation — the emission point for that Conversation's initial
 *    credential attachment (`docs/spec/audit.md` § Credential
 *    attachment is audited).
 * 3. **Observability accessors** (`getAgentDefinition`, `getConversation`,
 *    `getSession`, `listAuditEvents`, `listSessionEvents`) — plain
 *    reads, none of them audited. `listSessionEvents` in particular is
 *    the portable full-history read `docs/spec/interactions.md` §
 *    `stream` names as the normative derive-on-read fallback/audit
 *    source — distinct from `stream()`, which reproduces SSE semantics
 *    and terminates at the first `status: 'idle'` Event. Conformance
 *    checks that need a Session's TRUE stored history (e.g. proving
 *    `migrate` is non-compounding across repeated calls) MUST use
 *    `listSessionEvents`, never `stream()`, for that measurement.
 *
 * Every method that resolves a `Result` uses the house error pattern:
 * a `DomainError` on the failure branch, never a thrown exception for
 * an expected failure.
 */
export interface ReferenceServer {
  createAgentDefinition(input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  registerCredential(input: RegisterCredentialInput): Credential;
  createBuilderSession(agentDefinitionId: string, resources?: Session['resources']): Promise<Result<Session, DomainError>>;
  createTestSession(agentDefinitionId: string, resources?: Session['resources']): Promise<Result<Session, DomainError>>;
  /** Simulates a draft edit (advances `draftVersion` by one). Not one of the seven audited interactions — see `setup/edit-agent-definition-draft.ts`. */
  editAgentDefinitionDraft(definitionId: string): Promise<Result<AgentDefinition, DomainError>>;

  publish(definitionId: string, caller: CallerContext): Promise<Result<AgentDefinition, DomainError>>;
  /** `docs/spec/interactions.md` § `createConversation`. Mints the first Session for a brand-new Conversation; the emitted AuditEvent's `who.principal` comes from `input.initiatingPrincipal` (see `setup/create-conversation.ts`), not a separate `CallerContext` — there is no `onBehalfOf` support on this interaction. */
  createConversation(input: CreateConversationInput): Promise<Result<Conversation, DomainError>>;
  migrate(conversationId: string, caller: CallerContext): Promise<Result<Conversation, DomainError>>;
  drain(sessionId: string, caller: CallerContext): Promise<Result<DrainOutcome, DomainError>>;
  stream(sessionId: string, caller: CallerContext): Promise<Result<AsyncIterable<Event>, DomainError>>;
  send(sessionId: string, content: string, caller: CallerContext): Promise<Result<void, DomainError>>;
  sendToolResult(sessionId: string, toolUseId: string, result: unknown, caller: CallerContext): Promise<Result<void, DomainError>>;

  getAgentDefinition(id: string): AgentDefinition | undefined;
  getConversation(id: string): Conversation | undefined;
  getSession(id: string): Session | undefined;
  listAuditEvents(): readonly AuditEvent[];
  /** The portable full-history read — see group 3 in the class doc above. Returns `Server.SessionNotFound` for an unknown `sessionId`, never throws. */
  listSessionEvents(sessionId: string, options?: ListSessionEventsOptions): Promise<Result<ListSessionEventsResult, DomainError>>;

  /** Declares the conformance level(s) this server claims to meet — verified, not trusted, by `verify-self-report.ts`. */
  selfReport(): ConformanceSelfReport;
}
