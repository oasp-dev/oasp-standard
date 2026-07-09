import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';
import { createMockAgentProvider } from '../../mock/create-mock-agent-provider';
import { mockSentinels } from '../../mock/mock-sentinels';
import { createFixedClock } from '../../shared/fixed-clock';
import { ok } from '../../shared/result';
import { createReferenceServer } from '../create-reference-server';
import type { ToolExecutor } from '../tool-executor.types';

async function buildParkedSession() {
  const { server } = testHarnessFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  const sessionResult = await server.createBuilderSession(definition.id);
  if (!sessionResult.ok) throw new Error('setup failed');
  await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, callerContextFactory());
  return { server, sessionId: sessionResult.value.id };
}

describe('drain', () => {
  it('enumerates and resolves every pending tool call, returning the session to idle', async () => {
    const { server, sessionId } = await buildParkedSession();

    const result = await server.drain(sessionId, callerContextFactory());
    expect(result).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: expect.arrayContaining([expect.any(String)]) } });

    const pending = await server.drain(sessionId, callerContextFactory()); // idempotent re-drain
    expect(pending).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: [] } });
  });

  it('is idempotent: draining an already-idle session is a no-op success', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: [] } });
  });

  it('returns a failure outcome (not a false idle) when executing a blocking tool use fails fatally', async () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    const { provider } = createMockAgentProvider({ clock, seed: 1 });
    const failingExecutor: ToolExecutor = { execute: async () => ok(mockSentinels.induceFatalToolError) };
    const server = createReferenceServer({ provider, clock, toolExecutor: failingExecutor });

    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');
    await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, callerContextFactory());

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DrainFailed');

    const auditEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(auditEvents[0]?.outcome).toBe('failure');
  });

  it('rejects an unknown sessionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.drain('does_not_exist', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.SessionNotFound');
  });

  it('emits exactly one AuditEvent{ what: "drain" } scoped via the pinned AgentDefinition for an unbound (builder) session', async () => {
    const { server, sessionId } = await buildParkedSession();
    await server.drain(sessionId, callerContextFactory());

    const drainEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(drainEvents).toHaveLength(1);
    expect(drainEvents[0]).toMatchObject({ outcome: 'success', refs: { sessionId } });
  });
});
