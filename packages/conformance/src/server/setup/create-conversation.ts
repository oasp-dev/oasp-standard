import { conversationSchema, type AgentVersionRef, type Conversation } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import { err, ok, type Result } from '../../shared/result';
import type { DomainError } from '../../shared/domain-error.types';
import { resolveVaultIds } from '../credential/resolve-vault-ids';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';
import type { CreateConversationInput } from './create-conversation-input.types';

/**
 * Setup helper (not one of the six audited interactions — see
 * `docs/spec/audit.md` § The credential-attach gap): creates a
 * brand-new `Conversation` riding on a freshly minted `Session`.
 *
 * **Interpretation, revised per the dev lead's sign-off:**
 * `docs/spec/target-version-resolution.md`'s table is scoped to what a
 * `migrate` call resolves toward; v0 specifies no target-version rule
 * for a Conversation's *initial* Session in so many words. But the same
 * document's own MUST NOT — "a resolver MUST NOT substitute
 * `draftVersion` for a real conversation merely because
 * `publishedVersion` happens to be unset... that would pin live, real
 * usage to unpublished, still-changing content" — applies just as much
 * at creation time as at `migrate` time; there is no principled reason
 * initial pinning should be held to a looser standard than every
 * subsequent `migrate` call is. This helper therefore **rejects**
 * creating a real `Conversation` while `publishedVersion` is `null`,
 * rather than silently falling back to `draftVersion` as an earlier
 * revision did. Since `publishedVersion` is monotonically
 * non-decreasing and v0 has no "unpublish" (`docs/spec/interactions.md`
 * § `publish`), this closes `target-version-resolution.md`'s "never
 * published" row for good: once this guard rejects at creation, no
 * real Conversation this server ever hands back can later reach
 * `migrate`'s "leave in place" precondition for that same reason — see
 * `conformance/checks/server/run-server-checks.ts`'s
 * `checkCreateConversationRejectsNeverPublishedDefinition` for the
 * portable check proving this.
 */
export async function createConversationSetup(
  state: ServerState,
  provider: AgentProvider,
  input: CreateConversationInput,
): Promise<Result<Conversation, DomainError>> {
  const definition = state.agentDefinitions.get(input.agentDefinitionId);
  if (!definition) return err(serverErrors.definitionNotFound(input.agentDefinitionId));

  const deployment = state.deployments.get(definition.id);
  if (!deployment) return err(serverErrors.notDeployed(definition.id));

  if (definition.publishedVersion === null) return err(serverErrors.neverPublished(definition.id));
  const pinnedAgentVersion: AgentVersionRef = { agentDefinitionId: definition.id, version: definition.publishedVersion };

  const vaultIds = resolveVaultIds(definition, state.credentials);
  const resources = input.resources ?? [];

  const sessionResult = await provider.createSession({
    agentDefinitionId: definition.id,
    providerAgentId: deployment.providerAgentId,
    pinnedAgentVersion,
    resources,
    vaultIds,
  });
  if (!sessionResult.ok) return err(serverErrors.adapterFailure('createSession', sessionResult.error.message));

  state.counters.conversation += 1;
  const conversationId = `conv_${state.counters.conversation}`;
  const conversation = conversationSchema.parse({
    id: conversationId,
    scope: input.scope,
    initiatingPrincipal: input.initiatingPrincipal,
    currentSessionId: sessionResult.value.id,
    pinnedAgentVersion,
    previousSessionIds: [],
  });

  state.conversations.set(conversationId, conversation);
  state.sessions.set(sessionResult.value.id, sessionResult.value);
  state.sessionKind.set(sessionResult.value.id, 'real');
  state.sessionConversation.set(sessionResult.value.id, conversationId);

  // KNOWN v0 GAP (documented in docs/spec/audit.md § The credential-attach
  // gap): initial session creation — including its vaultIds/credential
  // attachment — has no corresponding interaction in the v0 six-interaction
  // set, so nothing is audited here. This is intentional, not an oversight;
  // do not add a conformance check requiring an audit event for this call.

  return ok(conversation);
}
