import type { ReferenceServer } from '../server/reference-server.types';
import type { CreateConversationInput } from '../server/setup/create-conversation-input.types';
import { authenticatedActorFactory } from './authenticated-actor-factory';
import { scopeFactory } from './scope-factory';

/**
 * Builds a `CreateConversationInput` for test scenarios, given the
 * `ReferenceServer` to authenticate the actor against and the
 * `AgentDefinition` id to bind to. Takes `server` (unlike most other
 * factories in this directory) because `input.actor` — issue #7
 * Tranche A's replacement for the removed `initiatingPrincipal` field —
 * must be a genuinely server-minted `AuthenticatedActor`, not a
 * detached value object (see `authenticated-actor-factory.ts`).
 */
export function createConversationInputFactory(
  server: ReferenceServer,
  agentDefinitionId: string,
  overrides: Partial<CreateConversationInput> = {},
): CreateConversationInput {
  return {
    agentDefinitionId,
    scope: scopeFactory(),
    actor: authenticatedActorFactory(server),
    ...overrides,
  };
}
