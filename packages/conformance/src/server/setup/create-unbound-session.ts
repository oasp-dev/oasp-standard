import type { Session } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import { err, ok, type Result } from '../../shared/result';
import type { DomainError } from '../../shared/domain-error.types';
import { resolveCredentialBindings } from '../credential/resolve-credential-bindings';
import { serverErrors } from '../server-errors';
import { getAgentDefinitionVersion } from '../store/agent-definition-version-store';
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
 *
 * **Issue #8 credential binding — the governing scope for an unbound
 * session:** neither `createBuilderSession` nor `createTestSession`
 * takes an `AuthenticatedActor` (issue #7 Tranche A's write-path
 * authorization deliberately stopped at the six audited interactions
 * plus `createConversation` — these two builder/test helpers were never
 * in that set, and adding actor-authentication to them is out of this
 * issue's scope too). With no bound Conversation and no actor, there is
 * no Conversation scope to resolve a Credential against, so this
 * resolves against the pinned `AgentDefinition`'s own `scope` instead —
 * the exact fallback `docs/spec/audit.md` § Scope provenance already
 * specifies for this same "no bound Conversation" session shape (see
 * `conformance/checks/audit/run-audit-checks.ts`'s builder-session
 * fallback scenario). `actor` is passed as `undefined`: since this call
 * site can never carry a delegation, a Credential whose `onBehalfOf` is
 * set can never be eligible here — only an unrestricted Credential
 * (`onBehalfOf` absent) pinned to the AgentDefinition's own scope can
 * attach to a builder/test session.
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

  // Resolves against the target version's immutable content snapshot (issue
  // #10), not the live `AgentDefinition` — every `draftVersion` number is
  // frozen the instant it is minted (`createAgentDefinitionSetup` /
  // `editAgentDefinitionDraftSetup`), so this should never be missing; an
  // invariant violation, not a legitimate failure outcome, if it somehow is.
  const versionSnapshot = getAgentDefinitionVersion(state, target);
  if (!versionSnapshot) {
    throw new Error(`Invariant violated: AgentDefinition "${definition.id}" version ${target.version} has no recorded content snapshot.`);
  }

  const bindingResult = resolveCredentialBindings({
    definitionVersion: versionSnapshot,
    credentials: state.credentials,
    effectiveScope: definition.scope,
  });
  if (!bindingResult.ok) return err(bindingResult.error);
  const vaultIds = bindingResult.value;

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
