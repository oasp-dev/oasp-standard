import type { CreateAgentDefinitionInput } from '../server/setup/create-agent-definition-input.types';
import { scopeFactory } from './scope-factory';

/** Builds a `CreateAgentDefinitionInput` for test scenarios, with sensible defaults overridable per call. */
export function agentDefinitionInputFactory(overrides: Partial<CreateAgentDefinitionInput> = {}): CreateAgentDefinitionInput {
  return {
    name: 'Support Assistant',
    instructions: 'Be helpful and concise.',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [],
    guardrails: [],
    scope: scopeFactory(),
    ...overrides,
  };
}
