import type { AgentDefinition, AuditEvent, Conversation, Credential, Deployment, Session } from '@oasp/schemas';
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
