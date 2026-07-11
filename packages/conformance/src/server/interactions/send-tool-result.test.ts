import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';
import { mockSentinels } from '../../mock/mock-sentinels';

describe('sendToolResult', () => {
  it('resolves a currently pending tool use and returns the session to idle', async () => {
    const { server, provider } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');
    await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, callerContextFactory());

    const pending = await provider.getPendingToolCalls(sessionResult.value.id);
    if (!pending.ok) throw new Error('setup failed');
    const toolUseId = pending.value[0]!.toolUseId;

    const result = await server.sendToolResult(sessionResult.value.id, toolUseId, { output: 42 }, callerContextFactory());
    expect(result).toEqual({ ok: true, value: undefined });

    const status = await provider.getSessionStatus(sessionResult.value.id);
    expect(status).toEqual({ ok: true, value: 'idle' });
  });

  it('rejects a toolUseId that is not currently pending', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.sendToolResult(sessionResult.value.id, 'nonexistent', {}, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.AdapterFailure');
  });

  it('rejects an unknown sessionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.sendToolResult('does_not_exist', 'tooluse_1', {}, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.SessionNotFound');
  });

  // Issue #11 Tranche A: a not-found probe MUST NOT vanish from the trail.
  it('emits a not_found AuditEvent (not silence) naming the caller-asserted sessionId, with no fabricated scope', async () => {
    const { server } = testHarnessFactory();
    await server.sendToolResult('does_not_exist', 'tooluse_1', {}, callerContextFactory());

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ what: 'sendToolResult', outcome: 'not_found', refs: { sessionId: 'does_not_exist' } });
    expect(events[0] && 'scope' in events[0]).toBe(false);
  });

  it('emits an AuditEvent{ what: "sendToolResult" } with outcome reflecting whether the toolUseId resolved', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    await server.sendToolResult(sessionResult.value.id, 'nonexistent', {}, callerContextFactory());

    const events = server.listAuditEvents().filter((e) => e.what === 'sendToolResult');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'failure', refs: { sessionId: sessionResult.value.id } });
  });
});
