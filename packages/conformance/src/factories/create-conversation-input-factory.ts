import type { CreateConversationInput } from '../server/setup/create-conversation-input.types';
import { principalRefFactory } from './principal-ref-factory';
import { scopeFactory } from './scope-factory';

/** Builds a `CreateConversationInput` for test scenarios, given the `AgentDefinition` id to bind to. */
export function createConversationInputFactory(
  agentDefinitionId: string,
  overrides: Partial<CreateConversationInput> = {},
): CreateConversationInput {
  return {
    agentDefinitionId,
    scope: scopeFactory(),
    initiatingPrincipal: principalRefFactory(),
    ...overrides,
  };
}
