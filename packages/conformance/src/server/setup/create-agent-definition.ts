import { agentDefinitionSchema, type AgentDefinition } from '@oasp/schemas';
import type { AgentProvider } from '../../adapter/agent-provider.types';
import { snapshotAgentDefinitionVersion } from '../store/agent-definition-version-store';
import type { ServerState } from '../store/server-state';
import type { CreateAgentDefinitionInput } from './create-agent-definition-input.types';

/**
 * Setup helper (not one of the seven audited interactions —
 * `AgentDefinition` creation itself has no `create*` audit-emission
 * point in v0, unlike Conversation creation which does, see
 * `docs/spec/interactions.md` § `createConversation`): creates a new
 * `AgentDefinition` at `draftVersion: 1, publishedVersion: null`, and
 * immediately materializes it at the provider (`createAgent`) into a
 * fixed environment so later `createSession` calls for it have a
 * `providerAgentId` to target.
 *
 * Also freezes `draftVersion: 1`'s content as an immutable
 * `AgentDefinitionVersion` snapshot (`snapshotAgentDefinitionVersion`,
 * issue #10) — every version number a Session/Conversation could ever
 * pin to must already be snapshotted before anything resolves against
 * it, and `draftVersion: 1` is the first such number to ever exist for
 * this Definition. See `edit-agent-definition-draft.ts` for the
 * matching snapshot on every later `draftVersion` bump, and
 * `store/agent-definition-version-store.ts` for why `publish` itself
 * never needs to freeze anything.
 *
 * Deploying eagerly, on every definition's creation, is a reference
 * server simplification — a production server would more plausibly
 * defer deployment or make it its own explicit step — but nothing in
 * the seven interactions' normative behaviour depends on *when*
 * deployment happens, only that a `Deployment` exists by the time
 * `createSession` needs it.
 *
 * Throws (does not return a `Result`) on adapter failure: this is test
 * scaffolding building fixtures for the conformance suite, not one of
 * the interactions under test, so a setup failure is a test-authoring
 * bug, not an expected domain outcome to route back as data.
 */
export async function createAgentDefinitionSetup(
  state: ServerState,
  provider: AgentProvider,
  environmentId: string,
  input: CreateAgentDefinitionInput,
): Promise<AgentDefinition> {
  state.counters.agentDefinition += 1;
  const id = `agentdef_${state.counters.agentDefinition}`;

  const definition = agentDefinitionSchema.parse({
    resourceType: 'AgentDefinition',
    id,
    name: input.name,
    instructions: input.instructions,
    provider: input.provider,
    model: input.model,
    tools: input.tools,
    guardrails: input.guardrails,
    draftVersion: 1,
    publishedVersion: null,
    scope: input.scope,
  });
  state.agentDefinitions.set(id, definition);
  snapshotAgentDefinitionVersion(state, definition, definition.draftVersion);

  await provider.ensureEnvironment(environmentId);
  const deployResult = await provider.createAgent(definition, environmentId);
  if (!deployResult.ok) {
    throw new Error(`createAgentDefinitionSetup: provider.createAgent failed: ${deployResult.error.message}`);
  }
  state.deployments.set(id, deployResult.value);

  return definition;
}
