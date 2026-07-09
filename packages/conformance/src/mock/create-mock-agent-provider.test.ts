import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@oasp/schemas';
import { createFixedClock } from '../shared/fixed-clock';
import { createMockAgentProvider } from './create-mock-agent-provider';
import { mockSentinels } from './mock-sentinels';

function buildDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'agentdef_1',
    name: 'Support Assistant',
    instructions: 'Be helpful.',
    provider: 'anthropic',
    model: 'claude-mock',
    tools: [],
    guardrails: [],
    draftVersion: 1,
    publishedVersion: null,
    scope: { level: 'workspace', id: 'workspace_1' },
    ...overrides,
  };
}

describe('createMockAgentProvider — AgentProvider contract', () => {
  it('ensureEnvironment is idempotent', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const first = await provider.ensureEnvironment('env_1');
    const second = await provider.ensureEnvironment('env_1');
    expect(first).toEqual({ ok: true, value: { environmentId: 'env_1' } });
    expect(second).toEqual({ ok: true, value: { environmentId: 'env_1' } });
  });

  it('createAgent materializes a Deployment; getAgent fetches it back without mutation', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const created = await provider.createAgent(buildDefinition(), 'env_1');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const fetched = await provider.getAgent(created.value.providerAgentId);
    expect(fetched).toEqual({ ok: true, value: created.value });
  });

  it('updateAgent updates the existing provider agent in place, not a new one', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const created = await provider.createAgent(buildDefinition(), 'env_1');
    if (!created.ok) throw new Error('setup failed');

    const updated = await provider.updateAgent(created.value.providerAgentId, buildDefinition({ draftVersion: 2 }), 'env_1');
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.providerAgentId).toBe(created.value.providerAgentId);
    expect(updated.value.providerVersion).toBe('v2');
  });

  it('getAgent rejects an unknown providerAgentId', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const result = await provider.getAgent('does_not_exist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Adapter.AgentNotFound');
  });

  it('createSession echoes pinnedAgentVersion, resources, and vaultIds exactly', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const result = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 3 },
      resources: [{ type: 'file', fileId: 'file_1' }],
      vaultIds: ['vault_1'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pinnedAgentVersion).toEqual({ agentDefinitionId: 'agentdef_1', version: 3 });
    expect(result.value.resources).toEqual([{ type: 'file', fileId: 'file_1' }]);
    expect(result.value.vaultIds).toEqual(['vault_1']);
  });

  it('a normal sendMessage produces a complete assistant turn and settles to idle', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');

    await provider.sendMessage(session.value.id, 'hello');
    const status = await provider.getSessionStatus(session.value.id);
    expect(status).toEqual({ ok: true, value: 'idle' });
  });

  it('a tool-use sentinel parks the session and getPendingToolCalls enumerates it', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');

    await provider.sendMessage(session.value.id, `${mockSentinels.toolUsePrefix}lookup`);
    const pending = await provider.getPendingToolCalls(session.value.id);
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value).toHaveLength(1);
    expect(pending.value[0]?.name).toBe('lookup');

    const status = await provider.getSessionStatus(session.value.id);
    expect(status).toEqual({ ok: true, value: 'running' });

    const resolved = await provider.sendToolResult(session.value.id, pending.value[0]!.toolUseId, { output: 42 });
    expect(resolved.ok).toBe(true);
    const statusAfter = await provider.getSessionStatus(session.value.id);
    expect(statusAfter).toEqual({ ok: true, value: 'idle' });
  });

  it('sendToolResult rejects a toolUseId that is not currently pending', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');

    const result = await provider.sendToolResult(session.value.id, 'nonexistent_tool_use', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Adapter.UnknownToolUse');
  });

  it('listSessionEvents paginates in emission order and reconstructs the full history across pages', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');
    await provider.sendMessage(session.value.id, 'hello');

    const firstPage = await provider.listSessionEvents(session.value.id, { limit: 2 });
    expect(firstPage.ok).toBe(true);
    if (!firstPage.ok) return;
    expect(firstPage.value.events).toHaveLength(2);
    expect(firstPage.value.nextCursor).not.toBeNull();

    const secondPage = await provider.listSessionEvents(session.value.id, { afterId: firstPage.value.nextCursor! });
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) return;

    const full = await provider.listSessionEvents(session.value.id);
    if (!full.ok) return;
    expect([...firstPage.value.events, ...secondPage.value.events]).toEqual(full.value.events);
  });

  it('induceTranscriptFetchFailureOnce makes exactly the next listSessionEvents call fail, then clears', async () => {
    const { provider, controls } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');

    controls.induceTranscriptFetchFailureOnce(session.value.id);
    const failed = await provider.listSessionEvents(session.value.id);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('Adapter.TranscriptFetchFailed');

    const succeeded = await provider.listSessionEvents(session.value.id);
    expect(succeeded.ok).toBe(true);
  });

  it('queuePendingToolCallForNextSession makes the next created session start already parked', async () => {
    const { provider, controls } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    controls.queuePendingToolCallForNextSession({ toolUseId: 'preexisting_tooluse', name: 'resume_task', input: {} });

    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');

    const status = await provider.getSessionStatus(session.value.id);
    expect(status).toEqual({ ok: true, value: 'running' });
    const pending = await provider.getPendingToolCalls(session.value.id);
    expect(pending.ok && pending.value).toEqual([{ toolUseId: 'preexisting_tooluse', name: 'resume_task', input: {} }]);
  });

  it('getResourceMountCount increments once per createSession call carrying that resource', async () => {
    const { provider, controls } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const options = {
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [{ type: 'file' as const, fileId: 'file_1' }],
      vaultIds: [],
    };
    await provider.createSession(options);
    await provider.createSession(options);
    expect(controls.getResourceMountCount('file:file_1')).toBe(2);
  });

  it('streamEvents yields events in order and terminates on idle', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const session = await provider.createSession({
      agentDefinitionId: 'agentdef_1',
      providerAgentId: 'provider_agent_1',
      pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
      resources: [],
      vaultIds: [],
    });
    if (!session.ok) throw new Error('setup failed');
    await provider.sendMessage(session.value.id, 'hello');

    const streamed: string[] = [];
    for await (const event of provider.streamEvents(session.value.id)) {
      streamed.push(event.type);
    }
    expect(streamed).toEqual(['assistant_message_start', 'assistant_message_text', 'assistant_message_end', 'status']);

    const listed = await provider.listSessionEvents(session.value.id);
    expect(listed.ok && listed.value.events.map((e) => e.type)).toEqual(streamed);
  });

  it('is deterministic: two independently-constructed providers driven identically produce identical events', async () => {
    async function run(): Promise<unknown> {
      const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 42 });
      const session = await provider.createSession({
        agentDefinitionId: 'agentdef_1',
        providerAgentId: 'provider_agent_1',
        pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 },
        resources: [],
        vaultIds: [],
      });
      if (!session.ok) throw new Error('setup failed');
      await provider.sendMessage(session.value.id, 'hello world');
      const events = await provider.listSessionEvents(session.value.id);
      return events.ok ? events.value.events : null;
    }

    const runA = await run();
    const runB = await run();
    expect(runA).toEqual(runB);
  });
});
