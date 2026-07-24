import { authenticate } from './auth/authenticate';
import { createEchoToolExecutor } from './echo-tool-executor';
import { listSessionEventsAccessor } from './list-session-events';
import { createConversationSetup } from './setup/create-conversation';
import { createAgentDefinitionSetup } from './setup/create-agent-definition';
import { createUnboundSessionSetup } from './setup/create-unbound-session';
import { editAgentDefinitionDraftSetup } from './setup/edit-agent-definition-draft';
import { registerCredentialSetup } from './setup/register-credential';
import { registerPrincipalSetup } from './setup/register-principal';
import { drainInteraction } from './interactions/drain';
import { migrateInteraction } from './interactions/migrate';
import { publishInteraction } from './interactions/publish';
import { sendInteraction } from './interactions/send';
import { sendToolResultInteraction } from './interactions/send-tool-result';
import { streamInteraction } from './interactions/stream';
import { getAgentDefinitionVersion } from './store/agent-definition-version-store';
import { createServerState } from './store/server-state';
import type { CreateReferenceServerOptions } from './create-reference-server-options.types';
import type { ReferenceServer } from './reference-server.types';

/**
 * Builds a minimal, conformant OASP v0 reference server: the seven
 * interactions (`publish`, `createConversation`, `migrate`, `drain`,
 * `stream`, `send`, `sendToolResult`) implemented over an injected
 * `AgentProvider`, holding Conversations/Sessions in memory, and
 * emitting `AuditEvent`s validated against `@oasp/schemas` for each
 * interaction.
 *
 * This is the target the "Server" conformance level's checks
 * (`conformance/checks/server/`) and the audit-emission checks
 * (`conformance/checks/audit/`) drive. It self-reports `{ levels:
 * ['server'] }` — it maps no real provider of its own (that is what
 * the *mock* provider and the "Adapter" checks are for), so it never
 * claims `'adapter'`; nothing in this package drives it as a `'client'`
 * either, so it does not claim that level.
 *
 * `registerPrincipal` + `authenticate` (issue #7 Tranche A) are this
 * server's Principal store and authentication seam: every one of the
 * seven interactions below now takes an `AuthenticatedActor` that only
 * ever comes from `authenticate()` resolving a registered `Principal` —
 * see `auth/authenticate.ts` and `reference-server.types.ts`'s class doc.
 */
export function createReferenceServer(options: CreateReferenceServerOptions): ReferenceServer {
  const { provider, clock } = options;
  const toolExecutor = options.toolExecutor ?? createEchoToolExecutor();
  const environmentId = options.environmentId ?? 'env_default';
  const state = createServerState();

  return {
    createAgentDefinition: (input) => createAgentDefinitionSetup(state, provider, environmentId, input),
    registerCredential: (input) => registerCredentialSetup(state, input),
    registerPrincipal: (input) => registerPrincipalSetup(state, input),
    authenticate: (input) => authenticate(state, input),
    createBuilderSession: (agentDefinitionId, resources) =>
      createUnboundSessionSetup(state, provider, agentDefinitionId, 'builder', resources),
    createTestSession: (agentDefinitionId, resources) =>
      createUnboundSessionSetup(state, provider, agentDefinitionId, 'test-session', resources),
    editAgentDefinitionDraft: (definitionId, contentOverrides) =>
      editAgentDefinitionDraftSetup(state, provider, environmentId, definitionId, contentOverrides),

    publish: (definitionId, actor) => publishInteraction(state, clock, definitionId, actor),
    createConversation: (input) => createConversationSetup(state, provider, clock, input),
    migrate: (conversationId, actor) => migrateInteraction(state, provider, toolExecutor, clock, conversationId, actor),
    drain: (sessionId, actor) => drainInteraction(state, provider, toolExecutor, clock, sessionId, actor),
    stream: (sessionId, actor) => streamInteraction(state, provider, clock, sessionId, actor),
    send: (sessionId, content, actor) => sendInteraction(state, provider, clock, sessionId, content, actor),
    sendToolResult: (sessionId, toolUseId, result, actor) =>
      sendToolResultInteraction(state, provider, clock, sessionId, toolUseId, result, actor),

    getAgentDefinition: (id) => state.agentDefinitions.get(id),
    getAgentDefinitionVersion: (ref) => getAgentDefinitionVersion(state, ref),
    getConversation: (id) => state.conversations.get(id),
    getSession: (id) => state.sessions.get(id),
    listAuditEvents: () => [...state.auditLog],
    listSessionEvents: (sessionId, options) => listSessionEventsAccessor(state, provider, sessionId, options),

    selfReport: () => ({ levels: ['server'] }),
  };
}
