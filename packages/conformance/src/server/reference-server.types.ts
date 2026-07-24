import type { AgentDefinition, AgentDefinitionContent, AgentDefinitionVersion, AgentVersionRef, AuditEvent, Conversation, Credential, Event, Principal, Session } from '@oasp/schemas';
import type { ListSessionEventsOptions, ListSessionEventsResult } from '../adapter/list-session-events.types';
import type { ConformanceSelfReport } from '../conformance/self-report.types';
import type { DomainError } from '../shared/domain-error.types';
import type { Result } from '../shared/result';
import type { AuthenticateInput } from './auth/authenticate-input.types';
import type { AuthenticatedActor } from './auth/authenticated-actor.types';
import type { DrainOutcome } from './interactions/drain.types';
import type { CreateAgentDefinitionInput } from './setup/create-agent-definition-input.types';
import type { CreateConversationInput } from './setup/create-conversation-input.types';
import type { RegisterCredentialInput } from './setup/register-credential-input.types';
import type { RegisterPrincipalInput } from './setup/register-principal-input.types';

/**
 * A minimal, conformant OASP v0 Server implementation, backed by an
 * injected `AgentProvider` — see `create-reference-server.ts`.
 * Everything in this interface splits into two groups:
 *
 * 1. **Setup helpers** (`createAgentDefinition`, `registerCredential`,
 *    `registerPrincipal`, `createBuilderSession`, `createTestSession`,
 *    `editAgentDefinitionDraft`) — not part of the seven audited
 *    interactions; they exist so a test can build a scenario (an
 *    AgentDefinition, a registered Credential, a registered Principal)
 *    to then drive the seven interactions against. `createBuilderSession` / `createTestSession`
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
 * 3. **Observability accessors** (`getAgentDefinition`,
 *    `getAgentDefinitionVersion`, `getConversation`, `getSession`,
 *    `listAuditEvents`, `listSessionEvents`) — plain reads, none of
 *    them audited. `listSessionEvents` in particular is the portable
 *    full-history read `docs/spec/interactions.md` § `stream` names as
 *    the normative derive-on-read fallback/audit source — distinct from
 *    `stream()`, which reproduces SSE semantics and terminates at the
 *    first `status: 'idle'` Event. Conformance checks that need a
 *    Session's TRUE stored history (e.g. proving `migrate` is
 *    non-compounding across repeated calls) MUST use
 *    `listSessionEvents`, never `stream()`, for that measurement.
 *    `getAgentDefinitionVersion` (issue #10) makes a pinned version's
 *    immutable content snapshot directly observable, independent of the
 *    live `AgentDefinition` `getAgentDefinition` reads.
 *
 * Every method that resolves a `Result` uses the house error pattern:
 * a `DomainError` on the failure branch, never a thrown exception for
 * an expected failure.
 *
 * **Authenticated-actor trust boundary (issue #7 Tranche A):** the six
 * write interactions below, plus `createConversation`, take an
 * `AuthenticatedActor` — never the pre-Tranche-A `CallerContext`, a bare
 * `{principal, onBehalfOf?}` the caller simply asserted in the request
 * body. `authenticate()` is the ONLY way to mint one, and it only ever
 * resolves a `principalId` against `ServerState.principals`
 * (`registerPrincipal`'s store) — see `auth/authenticate.ts` and
 * `auth/authenticated-actor.types.ts`. Each of those interactions then
 * calls `auth/authorize.ts` against its resolved resource's `scope`
 * before any side effect. Tranche B covers the equivalent containment
 * proof for the read accessors (group 3 below) — out of scope here.
 */
export interface ReferenceServer {
  createAgentDefinition(input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  registerCredential(input: RegisterCredentialInput): Credential;
  /** Registers a full `Principal` resource — the only store `authenticate()` resolves a `principalId` against. See `setup/register-principal.ts`. */
  registerPrincipal(input: RegisterPrincipalInput): Principal;
  /** The authentication seam — mints an `AuthenticatedActor` from a registered `Principal`, never from caller-supplied claims. See `auth/authenticate.ts`. */
  authenticate(input: AuthenticateInput): Result<AuthenticatedActor, DomainError>;
  createBuilderSession(agentDefinitionId: string, resources?: Session['resources']): Promise<Result<Session, DomainError>>;
  createTestSession(agentDefinitionId: string, resources?: Session['resources']): Promise<Result<Session, DomainError>>;
  /**
   * Simulates a draft edit (advances `draftVersion` by one and freezes
   * the resulting version's content as an immutable
   * `AgentDefinitionVersion` snapshot — issue #10). Not one of the
   * seven audited interactions — see `setup/edit-agent-definition-draft.ts`.
   * `contentOverrides` optionally changes `instructions`/`provider`/
   * `model`/`tools`/`guardrails` on the new draft version; omitted (the
   * default), the new version has identical content to the one it
   * advances from, same as this method's pre-#10 behaviour.
   */
  editAgentDefinitionDraft(
    definitionId: string,
    contentOverrides?: Partial<AgentDefinitionContent>,
  ): Promise<Result<AgentDefinition, DomainError>>;

  publish(definitionId: string, actor: AuthenticatedActor): Promise<Result<AgentDefinition, DomainError>>;
  /** `docs/spec/interactions.md` § `createConversation`. Mints the first Session for a brand-new Conversation; the emitted AuditEvent's `who` comes from `input.actor` (see `setup/create-conversation.ts`), never from caller-supplied identity claims. `input.scope` MUST be authorized against `input.actor` (and against the target AgentDefinition's own scope) before a Conversation is created for it. */
  createConversation(input: CreateConversationInput): Promise<Result<Conversation, DomainError>>;
  migrate(conversationId: string, actor: AuthenticatedActor): Promise<Result<Conversation, DomainError>>;
  drain(sessionId: string, actor: AuthenticatedActor): Promise<Result<DrainOutcome, DomainError>>;
  stream(sessionId: string, actor: AuthenticatedActor): Promise<Result<AsyncIterable<Event>, DomainError>>;
  send(sessionId: string, content: string, actor: AuthenticatedActor): Promise<Result<void, DomainError>>;
  sendToolResult(sessionId: string, toolUseId: string, result: unknown, actor: AuthenticatedActor): Promise<Result<void, DomainError>>;

  getAgentDefinition(id: string): AgentDefinition | undefined;
  /** Reads the immutable content snapshot `ref` pins (issue #10) — `undefined` only if `ref` names a version number that was never minted through this server. */
  getAgentDefinitionVersion(ref: AgentVersionRef): AgentDefinitionVersion | undefined;
  getConversation(id: string): Conversation | undefined;
  getSession(id: string): Session | undefined;
  listAuditEvents(): readonly AuditEvent[];
  /** The portable full-history read — see group 3 in the class doc above. Returns `Server.SessionNotFound` for an unknown `sessionId`, never throws. */
  listSessionEvents(sessionId: string, options?: ListSessionEventsOptions): Promise<Result<ListSessionEventsResult, DomainError>>;

  /** Declares the conformance level(s) this server claims to meet — verified, not trusted, by `verify-self-report.ts`. */
  selfReport(): ConformanceSelfReport;
}
