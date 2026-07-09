import type { Session } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import { err, ok, type Result } from '../../shared/result';
import type { DomainError } from '../../shared/domain-error.types';
import { resolveVaultIds } from '../credential/resolve-vault-ids';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';
import { resolveTargetVersion } from '../target-version/resolve-target-version';

/**
 * Setup helper backing `ReferenceServer.createBuilderSession` /
 * `createTestSession` — the two Session contexts
 * `docs/spec/target-version-resolution.md` names that are not bound to
 * any `Conversation`. Both always resolve to `draftVersion` (see
 * `resolve-target-version.ts`), so one implementation serves both; the
 * `context` parameter only affects how the resulting Session is
 * classified for later scope-provenance / target-version-resolution
 * conformance checks — it has no bearing on adapter-level behaviour.
 */
export async function createUnboundSessionSetup(
  state: ServerState,
  provider: AgentProvider,
  agentDefinitionId: string,
  context: 'builder' | 'test-session',
  resources: Session['resources'] = [],
): Promise<Result<Session, DomainError>> {
  const definition = state.agentDefinitions.get(agentDefinitionId);
  if (!definition) return err(serverErrors.definitionNotFound(agentDefinitionId));

  const deployment = state.deployments.get(definition.id);
  if (!deployment) return err(serverErrors.notDeployed(definition.id));

  // builder/test-session always resolve to a version (never `null` — see resolve-target-version.ts).
  const target = resolveTargetVersion(context, definition)!;
  const vaultIds = resolveVaultIds(definition, state.credentials);

  const sessionResult = await provider.createSession({
    agentDefinitionId: definition.id,
    providerAgentId: deployment.providerAgentId,
    pinnedAgentVersion: target,
    resources,
    vaultIds,
  });
  if (!sessionResult.ok) return err(serverErrors.adapterFailure('createSession', sessionResult.error.message));

  state.sessions.set(sessionResult.value.id, sessionResult.value);
  state.sessionKind.set(sessionResult.value.id, context);

  return ok(sessionResult.value);
}
