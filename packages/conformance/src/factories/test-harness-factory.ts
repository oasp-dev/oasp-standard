import type { AgentProvider } from '../adapter/agent-provider.types';
import { createMockAgentProvider } from '../mock/create-mock-agent-provider';
import type { MockProviderControls } from '../mock/mock-provider-controls.types';
import { createReferenceServer } from '../server/create-reference-server';
import type { ReferenceServer } from '../server/reference-server.types';
import { createFixedClock } from '../shared/fixed-clock';

/** A wired-together mock provider + reference server, ready to drive in a test — the standard starting point for every server/audit conformance test in this package. */
export interface TestHarness {
  readonly server: ReferenceServer;
  readonly controls: MockProviderControls;
  /** The underlying `AgentProvider` the server is wired to — exposed so tests can drive adapter-level operations (e.g. `getPendingToolCalls`) directly, alongside the server. */
  readonly provider: AgentProvider;
}

/**
 * Builds a fresh {@link TestHarness}: a deterministic mock
 * `AgentProvider` (seeded, fixed clock) wired into a fresh
 * `ReferenceServer` instance. Every test gets its own harness — never
 * a shared instance across tests — so tests never depend on each
 * other's state (the factories-not-fixtures rule).
 *
 * @param startIso Fixed clock origin. Defaults to a stable instant so
 *   tests that don't care about specific timestamps don't need to pass
 *   one; tests that assert on `when`/`at` values pass their own.
 * @param seed Mock provider content seed. Defaults to a fixed value for
 *   the same reason.
 */
export function testHarnessFactory(startIso = '2026-01-01T00:00:00.000Z', seed = 1): TestHarness {
  const clock = createFixedClock(startIso);
  const { provider, controls } = createMockAgentProvider({ clock, seed });
  const server = createReferenceServer({ provider, clock });
  return { server, controls, provider };
}
