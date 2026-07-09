import type { AgentDefinition, Scope } from '@oasp/schemas';

/** Input to {@link import('./create-agent-definition').createAgentDefinitionSetup}. Everything `agentDefinitionSchema` needs except the server-assigned `id` and the version pointers, which always start at `draftVersion: 1, publishedVersion: null`. */
export interface CreateAgentDefinitionInput {
  readonly name: string;
  readonly instructions: string;
  readonly provider: AgentDefinition['provider'];
  readonly model: string;
  readonly tools: AgentDefinition['tools'];
  readonly guardrails: readonly string[];
  readonly scope: Scope;
}
