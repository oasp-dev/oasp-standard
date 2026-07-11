import type { AgentDefinition, AgentDefinitionContent } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';
import { snapshotAgentDefinitionVersion } from '../store/agent-definition-version-store';
import type { ServerState } from '../store/server-state';

/**
 * Setup helper: simulates an edit to an `AgentDefinition`'s draft,
 * advancing `draftVersion` by one — per `agentDefinitionSchema`,
 * "every edit to the Definition advances" it. Not one of the seven
 * audited interactions (editing/updating a definition's content is
 * out of the v0 interaction set entirely, same as creation), so this
 * emits no `AuditEvent`.
 *
 * `contentOverrides` (issue #10) lets a caller actually change
 * `instructions`/`provider`/`model`/`tools`/`guardrails` while
 * advancing the version — defaulting to `{}` (no change) preserves
 * this helper's original behaviour (a version bump with identical
 * content) for every existing call site that doesn't pass any. Before
 * this addition, the helper only ever did `draftVersion + 1` with no
 * way to change content at all, so no test could construct a genuine
 * version-to-version content difference — see `migrate.test.ts`'s
 * "materially different tool grants across versions" case, which
 * exists specifically because this override now makes it possible.
 *
 * Freezes the resulting `draftVersion`'s content as an immutable
 * `AgentDefinitionVersion` snapshot (`snapshotAgentDefinitionVersion`)
 * every time — every `draftVersion` number, published or not, is a
 * version a builder/test session could pin to, so every one gets a
 * snapshot the instant it is minted, not only the ones that later get
 * published (see that function's own doc comment for why `publish`
 * itself never needs to freeze anything).
 */
export async function editAgentDefinitionDraftSetup(
  state: ServerState,
  provider: AgentProvider,
  environmentId: string,
  definitionId: string,
  contentOverrides: Partial<AgentDefinitionContent> = {},
): Promise<Result<AgentDefinition, DomainError>> {
  const definition = state.agentDefinitions.get(definitionId);
  if (!definition) return err(serverErrors.definitionNotFound(definitionId));

  const updated: AgentDefinition = { ...definition, ...contentOverrides, draftVersion: definition.draftVersion + 1 };
  state.agentDefinitions.set(definitionId, updated);
  snapshotAgentDefinitionVersion(state, updated, updated.draftVersion);

  const deployment = state.deployments.get(definitionId);
  if (deployment) {
    const redeployResult = await provider.updateAgent(deployment.providerAgentId, updated, environmentId);
    if (redeployResult.ok) state.deployments.set(definitionId, redeployResult.value);
  }

  return ok(updated);
}
