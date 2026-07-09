import { eventSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';

describe('stream', () => {
  it('returns an AsyncIterable yielding schema-valid Events in emission order, terminating on idle', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');
    await server.send(sessionResult.value.id, 'hello', callerContextFactory());

    const streamResult = await server.stream(sessionResult.value.id, callerContextFactory());
    expect(streamResult.ok).toBe(true);
    if (!streamResult.ok) return;

    const events = [];
    for await (const event of streamResult.value) events.push(event);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(eventSchema.safeParse(event).success).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'status', status: 'idle' });

    const ids = events.map((e) => e.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejects an unknown sessionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.stream('does_not_exist', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.SessionNotFound');
  });

  it('emits exactly one AuditEvent{ what: "stream" } per invocation, even though it is a read path', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    await server.stream(sessionResult.value.id, callerContextFactory());
    await server.stream(sessionResult.value.id, callerContextFactory());

    const streamEvents = server.listAuditEvents().filter((e) => e.what === 'stream');
    expect(streamEvents).toHaveLength(2);
    expect(streamEvents[0]).toMatchObject({ outcome: 'success', refs: { sessionId: sessionResult.value.id } });
  });
});
