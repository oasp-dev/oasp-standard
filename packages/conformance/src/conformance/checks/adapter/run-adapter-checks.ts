import type { AgentProvider } from '../../../adapter/agent-provider.types';
import { mockSentinels } from '../../../mock/mock-sentinels';
import { failed, passed, type CheckResult } from '../../check-result.types';

const BASE_SESSION_OPTIONS = {
  agentDefinitionId: 'agentdef_check',
  providerAgentId: 'provider_agent_check',
} as const;

async function checkVersionPinningPreserved(provider: AgentProvider): Promise<CheckResult> {
  const name = 'adapter: createSession preserves the exact requested pinnedAgentVersion';
  const target = { agentDefinitionId: 'agentdef_check', version: 7 };
  const result = await provider.createSession({ ...BASE_SESSION_OPTIONS, pinnedAgentVersion: target, resources: [], vaultIds: [] });
  if (!result.ok) return failed(name, result.error.message);
  return result.value.pinnedAgentVersion.version === 7 ? passed(name) : failed(name, `expected v7, got v${result.value.pinnedAgentVersion.version}`);
}

async function checkResourceAndVaultFidelity(provider: AgentProvider): Promise<CheckResult> {
  const name = 'adapter: createSession mounts resources and vaultIds in full, never partially';
  const resources = [{ type: 'file' as const, fileId: 'file_a' }, { type: 'memory_store' as const, storeId: 'store_a' }];
  const vaultIds = ['vault_a', 'vault_b'];
  const result = await provider.createSession({
    ...BASE_SESSION_OPTIONS,
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_check', version: 1 },
    resources,
    vaultIds,
  });
  if (!result.ok) return failed(name, result.error.message);
  const resourcesMatch = JSON.stringify(result.value.resources) === JSON.stringify(resources);
  const vaultsMatch = JSON.stringify(result.value.vaultIds) === JSON.stringify(vaultIds);
  return resourcesMatch && vaultsMatch ? passed(name) : failed(name, 'echoed resources/vaultIds did not match what was requested');
}

async function checkPendingToolCallEnumeration(provider: AgentProvider): Promise<CheckResult> {
  const name = 'adapter: getPendingToolCalls fully enumerates a blocking tool use';
  const session = await provider.createSession({
    ...BASE_SESSION_OPTIONS,
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_check', version: 1 },
    resources: [],
    vaultIds: [],
  });
  if (!session.ok) return failed(name, session.error.message);
  await provider.sendMessage(session.value.id, `${mockSentinels.toolUsePrefix}lookup`);
  const pending = await provider.getPendingToolCalls(session.value.id);
  if (!pending.ok) return failed(name, pending.error.message);
  return pending.value.length === 1 && pending.value[0]?.name === 'lookup'
    ? passed(name)
    : failed(name, `expected exactly one pending "lookup" tool call, got ${JSON.stringify(pending.value)}`);
}

async function checkEventOrderingLexicographic(provider: AgentProvider): Promise<CheckResult> {
  const name = 'adapter: emitted Event ids are lexicographically monotonic in emission order';
  const session = await provider.createSession({
    ...BASE_SESSION_OPTIONS,
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_check', version: 1 },
    resources: [],
    vaultIds: [],
  });
  if (!session.ok) return failed(name, session.error.message);
  await provider.sendMessage(session.value.id, 'hello');
  const listed = await provider.listSessionEvents(session.value.id);
  if (!listed.ok) return failed(name, listed.error.message);
  const ids = listed.value.events.map((event) => event.id);
  const sorted = [...ids].sort();
  return JSON.stringify(ids) === JSON.stringify(sorted) ? passed(name) : failed(name, `ids not lexicographically sorted: ${JSON.stringify(ids)}`);
}

async function checkNoUnsolicitedTurnFromSeeding(provider: AgentProvider): Promise<CheckResult> {
  const name = 'adapter: a freshly seeded session does not emit an unsolicited assistant_message_start';
  const seedEvents = [
    { resourceType: 'Event' as const, id: 'old_0', at: '2026-01-01T00:00:00.000Z', type: 'assistant_message_start' as const, messageId: 'm1' },
    { resourceType: 'Event' as const, id: 'old_1', at: '2026-01-01T00:00:01.000Z', type: 'assistant_message_end' as const, messageId: 'm1' },
  ];
  const session = await provider.createSession({
    ...BASE_SESSION_OPTIONS,
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_check', version: 1 },
    resources: [],
    vaultIds: [],
    seed: { events: seedEvents },
  });
  if (!session.ok) return failed(name, session.error.message);
  const listed = await provider.listSessionEvents(session.value.id);
  if (!listed.ok) return failed(name, listed.error.message);
  const starts = listed.value.events.filter((e) => e.type === 'assistant_message_start').length;
  return starts === 1 ? passed(name) : failed(name, `expected exactly the 1 seeded assistant_message_start, found ${starts}`);
}

async function checkSendToolResultCorrelation(provider: AgentProvider): Promise<CheckResult> {
  const name = 'adapter: sendToolResult rejects a toolUseId that is not currently pending';
  const session = await provider.createSession({
    ...BASE_SESSION_OPTIONS,
    pinnedAgentVersion: { agentDefinitionId: 'agentdef_check', version: 1 },
    resources: [],
    vaultIds: [],
  });
  if (!session.ok) return failed(name, session.error.message);
  const result = await provider.sendToolResult(session.value.id, 'no_such_tool_use', {});
  return !result.ok ? passed(name) : failed(name, 'expected rejection of an unknown toolUseId, got success');
}

/**
 * Drives an `AgentProvider` implementation through its contract and
 * asserts the MUST-preserve invariants `docs/spec/adapters.md` states:
 * version pinning, resource/vault fidelity, pending-tool-call
 * enumeration, event ordering, the no-unsolicited-turn-from-seeding
 * guarantee, and `sendToolResult` correlation. This is the "Adapter"
 * conformance level's executable check.
 */
export async function runAdapterChecks(provider: AgentProvider): Promise<CheckResult[]> {
  return Promise.all([
    checkVersionPinningPreserved(provider),
    checkResourceAndVaultFidelity(provider),
    checkPendingToolCallEnumeration(provider),
    checkEventOrderingLexicographic(provider),
    checkNoUnsolicitedTurnFromSeeding(provider),
    checkSendToolResultCorrelation(provider),
  ]);
}
