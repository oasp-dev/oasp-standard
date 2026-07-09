import { describe, expect, it } from 'vitest';
import { createMockAgentProvider } from '../../../mock/create-mock-agent-provider';
import { createFixedClock } from '../../../shared/fixed-clock';
import { runAdapterChecks } from './run-adapter-checks';

describe('runAdapterChecks', () => {
  it('every check passes against the deterministic mock provider', async () => {
    const { provider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const results = await runAdapterChecks(provider);

    const failures = results.filter((r) => !r.passed);
    expect(failures, JSON.stringify(failures)).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });

  it('catches a non-conformant adapter: createSession that silently substitutes a different pinned version', async () => {
    const { provider: realProvider } = createMockAgentProvider({ clock: createFixedClock('2026-01-01T00:00:00.000Z'), seed: 1 });
    const brokenProvider: typeof realProvider = {
      ...realProvider,
      createSession: async (options) => {
        const result = await realProvider.createSession(options);
        if (!result.ok) return result;
        // Simulate the exact bug the "version pinning preserved" invariant exists to catch.
        return { ok: true, value: { ...result.value, pinnedAgentVersion: { ...result.value.pinnedAgentVersion, version: 999 } } };
      },
    };

    const results = await runAdapterChecks(brokenProvider);
    const pinningCheck = results.find((r) => r.name.includes('pinnedAgentVersion'));
    expect(pinningCheck?.passed).toBe(false);
  });
});
