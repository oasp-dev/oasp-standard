import type { AgentDefinition } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';

/**
 * Setup helper: simulates an edit to an `AgentDefinition`'s draft,
 * advancing `draftVersion` by one — per `agentDefinitionSchema`,
 * "every edit to the Definition advances" it. Not one of the seven
 * audited interactions (editing/updating a definition's content is
 * out of the v0 interaction set entirely, same as creation), so this
 * emits no `AuditEvent`. Exists so conformance tests can construct a
 * genuine version change to migrate toward, without which `migrate`'s
 * "mint a new session at a different target version" path (as opposed
 * to its no-op paths) would be untestable.
 */
export async function editAgentDefinitionDraftSetup(
  state: ServerState,
  provider: AgentProvider,
  environmentId: string,
  definitionId: string,
): Promise<Result<AgentDefinition, DomainError>> {
  const definition = state.agentDefinitions.get(definitionId);
  if (!definition) return err(serverErrors.definitionNotFound(definitionId));

  const updated: AgentDefinition = { ...definition, draftVersion: definition.draftVersion + 1 };
  state.agentDefinitions.set(definitionId, updated);

  const deployment = state.deployments.get(definitionId);
  if (deployment) {
    const redeployResult = await provider.updateAgent(deployment.providerAgentId, updated, environmentId);
    if (redeployResult.ok) state.deployments.set(definitionId, redeployResult.value);
  }

  return ok(updated);
}
