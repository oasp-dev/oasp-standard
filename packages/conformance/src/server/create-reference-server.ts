import { createEchoToolExecutor } from './echo-tool-executor';
import { listSessionEventsAccessor } from './list-session-events';
import { createConversationSetup } from './setup/create-conversation';
import { createAgentDefinitionSetup } from './setup/create-agent-definition';
import { createUnboundSessionSetup } from './setup/create-unbound-session';
import { editAgentDefinitionDraftSetup } from './setup/edit-agent-definition-draft';
import { registerCredentialSetup } from './setup/register-credential';
import { drainInteraction } from './interactions/drain';
import { migrateInteraction } from './interactions/migrate';
import { publishInteraction } from './interactions/publish';
import { sendInteraction } from './interactions/send';
import { sendToolResultInteraction } from './interactions/send-tool-result';
import { streamInteraction } from './interactions/stream';
import { createServerState } from './store/server-state';
import type { CreateReferenceServerOptions } from './create-reference-server-options.types';
import type { ReferenceServer } from './reference-server.types';

/**
 * Builds a minimal, conformant OASP v0 reference server: the six
 * interactions (`publish`, `migrate`, `drain`, `stream`, `send`,
 * `sendToolResult`) implemented over an injected `AgentProvider`,
 * holding Conversations/Sessions in memory, and emitting `AuditEvent`s
 * validated against `@oasp/schemas` for each interaction.
 *
 * This is the target the "Server" conformance level's checks
 * (`conformance/checks/server/`) and the audit-emission checks
 * (`conformance/checks/audit/`) drive. It self-reports `{ levels:
 * ['server'] }` — it maps no real provider of its own (that is what
 * the *mock* provider and the "Adapter" checks are for), so it never
 * claims `'adapter'`; nothing in this package drives it as a `'client'`
 * either, so it does not claim that level.
 */
export function createReferenceServer(options: CreateReferenceServerOptions): ReferenceServer {
  const { provider, clock } = options;
  const toolExecutor = options.toolExecutor ?? createEchoToolExecutor();
  const environmentId = options.environmentId ?? 'env_default';
  const state = createServerState();

  return {
    createAgentDefinition: (input) => createAgentDefinitionSetup(state, provider, environmentId, input),
    registerCredential: (input) => registerCredentialSetup(state, input),
    createConversation: (input) => createConversationSetup(state, provider, input),
    createBuilderSession: (agentDefinitionId, resources) =>
      createUnboundSessionSetup(state, provider, agentDefinitionId, 'builder', resources),
    createTestSession: (agentDefinitionId, resources) =>
      createUnboundSessionSetup(state, provider, agentDefinitionId, 'test-session', resources),
    editAgentDefinitionDraft: (definitionId) => editAgentDefinitionDraftSetup(state, provider, environmentId, definitionId),

    publish: (definitionId, caller) => publishInteraction(state, clock, definitionId, caller),
    migrate: (conversationId, caller) => migrateInteraction(state, provider, toolExecutor, clock, conversationId, caller),
    drain: (sessionId, caller) => drainInteraction(state, provider, toolExecutor, clock, sessionId, caller),
    stream: (sessionId, caller) => streamInteraction(state, provider, clock, sessionId, caller),
    send: (sessionId, content, caller) => sendInteraction(state, provider, clock, sessionId, content, caller),
    sendToolResult: (sessionId, toolUseId, result, caller) =>
      sendToolResultInteraction(state, provider, clock, sessionId, toolUseId, result, caller),

    getAgentDefinition: (id) => state.agentDefinitions.get(id),
    getConversation: (id) => state.conversations.get(id),
    getSession: (id) => state.sessions.get(id),
    listAuditEvents: () => [...state.auditLog],
    listSessionEvents: (sessionId, options) => listSessionEventsAccessor(state, provider, sessionId, options),

    selfReport: () => ({ levels: ['server'] }),
  };
}
