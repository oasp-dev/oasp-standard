import { describe, expect, it } from 'vitest';
import type { Event } from '@oasp/schemas';
import { createMockAgentProvider } from '../../../mock/create-mock-agent-provider';
import { createFixedClock } from '../../../shared/fixed-clock';
import { runClientChecks } from './run-client-checks';

async function* toAsyncIterable<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe('runClientChecks', () => {
  it('every check passes for a well-formed event stream from the mock provider', async () => {
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

    const results = await runClientChecks(provider.streamEvents(session.value.id));
    const failures = results.filter((r) => !r.passed);
    expect(failures, JSON.stringify(failures)).toEqual([]);
  });

  it('catches a malformed event that does not conform to the Event vocabulary', async () => {
    const malformed = [{ id: 'e1', at: '2026-01-01T00:00:00.000Z', type: 'not_a_real_event_type' }] as unknown as Event[];
    const results = await runClientChecks(toAsyncIterable(malformed));
    const schemaCheck = results.find((r) => r.name.includes('validates against'));
    expect(schemaCheck?.passed).toBe(false);
  });

  it('catches a stream that does not terminate on idle or a fatal error', async () => {
    const nonTerminating: Event[] = [
      { id: 'e1', at: '2026-01-01T00:00:00.000Z', type: 'status', status: 'running' },
    ];
    const results = await runClientChecks(toAsyncIterable(nonTerminating));
    const terminationCheck = results.find((r) => r.name.includes('terminates'));
    expect(terminationCheck?.passed).toBe(false);
  });

  it('catches non-lexicographically-sorted ids (the exact unpadded-counter failure mode S1 warns about: "2" emitted before "10")', async () => {
    const outOfOrder: Event[] = [
      { id: 'sess_2', at: '2026-01-01T00:00:00.000Z', type: 'status', status: 'running' },
      { id: 'sess_10', at: '2026-01-01T00:00:01.000Z', type: 'status', status: 'idle' },
    ];
    // As byte strings, "sess_10" < "sess_2" — so this emission order is NOT
    // lexicographically ascending, exactly the bug zero-padding prevents.
    const results = await runClientChecks(toAsyncIterable(outOfOrder));
    const orderingCheck = results.find((r) => r.name.includes('lexicographically monotonic'));
    expect(orderingCheck?.passed).toBe(false);
  });
});
