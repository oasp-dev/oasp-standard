import type { CreateAgentDefinitionInput } from '../server/setup/create-agent-definition-input.types';
import { scopeFactory } from './scope-factory';

/**
 * Builds a `CreateAgentDefinitionInput` for test scenarios, with
 * sensible defaults overridable per call.
 *
 * `tools` defaults to granting exactly one `custom` tool named
 * `'lookup'` — the generic tool name `mockSentinels.toolUsePrefix`
 * scenarios use suite-wide when a test just needs *some* pending tool
 * call and does not care about its specifics. Since `drain` now
 * authorizes every pending call against the pinned AgentDefinition's
 * granted tools (issue #9), a caller that overrides `tools` (e.g. to
 * `[]`, to exercise rejection) is opting out of that default grant
 * deliberately.
 */
export function agentDefinitionInputFactory(overrides: Partial<CreateAgentDefinitionInput> = {}): CreateAgentDefinitionInput {
  return {
    name: 'Support Assistant',
    instructions: 'Be helpful and concise.',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [{ type: 'custom', name: 'lookup', description: 'Looks something up.', inputSchema: {} }],
    guardrails: [],
    scope: scopeFactory(),
    ...overrides,
  };
}
