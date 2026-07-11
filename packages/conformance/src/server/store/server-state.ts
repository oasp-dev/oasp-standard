import type { AgentDefinition, AgentDefinitionVersion, AuditEvent, Conversation, Credential, Deployment, Session } from '@oasp/schemas';
import type { SessionContext } from '../target-version/resolve-target-version';

/**
 * The reference server's entire persistence layer: plain in-memory
 * `Map`s, never a database. Conformant with this package's charter (no
 * network, deterministic, CI-safe) and sufficient to prove the
 * normative behaviours the conformance suite checks — a real OASP
 * server implementation would back this with a database, but nothing
 * about the seven interactions' normative behaviour depends on that.
 */
export interface ServerState {
  readonly agentDefinitions: Map<string, AgentDefinition>;
  /**
   * Immutable per-version content snapshots (issue #10), keyed by the
   * composite `${agentDefinitionId}@${version}` string (see
   * `store/agent-definition-version-store.ts`) — an `AgentVersionRef.version`
   * is only unique WITHIN one `AgentDefinition`, so the key must be the
   * pair, never `version` alone. Written once per version number, at
   * the moment that number is minted (`setup/create-agent-definition.ts`
   * for `draftVersion: 1`, `setup/edit-agent-definition-draft.ts` for
   * every later bump), and never overwritten afterward — `draftVersion`
   * only ever increases, so a given key is only ever set once. This is
   * what `migrate`'s Stage 1 `vaultIds` re-resolution, `drain`'s
   * pre-dispatch tool-call authorization, and initial credential
   * resolution now read from instead of the live, still-editable
   * `AgentDefinition` — closing the version-isolation gap `migrate.ts`'s
   * pre-#10 doc comment flagged for the dev lead's sign-off. A
   * deterministic in-memory `Map` is sufficient to prove that invariant
   * for the conformance kit; this is never a production version-content
   * database (see this package's charter above).
   */
  readonly agentDefinitionVersions: Map<string, AgentDefinitionVersion>;
  /** One `Deployment` per `AgentDefinition`, keyed by `agentDefinitionId` — this reference server deploys an AgentDefinition to a single fixed environment as soon as it is created (see `create-reference-server.ts`), not as a separately audited interaction. */
  readonly deployments: Map<string, Deployment>;
  readonly credentials: Map<string, Credential>;
  readonly conversations: Map<string, Conversation>;
  readonly sessions: Map<string, Session>;
  /** Classifies every Session's purpose (builder / test-session / real), since the S0 schemas carry no such field — see `resolve-target-version.ts`. */
  readonly sessionKind: Map<string, SessionContext>;
  /** Maps a `'real'`-kind Session's id to the Conversation it currently or formerly belonged to — used to resolve audit scope provenance and `send`'s current-session check. */
  readonly sessionConversation: Map<string, string>;
  readonly auditLog: AuditEvent[];
  /** Per-Conversation serialization for `migrate` (see `conversation-lock.ts`) — MUST prevent two concurrent `migrate` calls on the same Conversation from racing `previousSessionIds`. */
  readonly conversationLocks: Map<string, Promise<void>>;
  readonly counters: {
    agentDefinition: number;
    conversation: number;
    credential: number;
    audit: number;
  };
}

/** Builds a fresh, empty {@link ServerState}. Every reference server instance owns exactly one, created once at construction. */
export function createServerState(): ServerState {
  return {
    agentDefinitions: new Map(),
    agentDefinitionVersions: new Map(),
    deployments: new Map(),
    credentials: new Map(),
    conversations: new Map(),
    sessions: new Map(),
    sessionKind: new Map(),
    sessionConversation: new Map(),
    auditLog: [],
    conversationLocks: new Map(),
    counters: { agentDefinition: 0, conversation: 0, credential: 0, audit: 0 },
  };
}
