import type { Clock } from '../shared/clock.types';

/**
 * Construction options for {@link import('./create-mock-agent-provider').createMockAgentProvider}.
 * Both fields are the determinism seam: supply the same `clock` starting
 * point and the same `seed` across two runs and every emitted `Event`/
 * `AuditEvent` and every reply-template choice reproduces exactly.
 */
export interface MockAgentProviderOptions {
  /** Source of every `Event.at` timestamp the mock provider emits. */
  readonly clock: Clock;
  /** Seeds the deterministic reply-content generator (see `mock-reply-generator.ts`). */
  readonly seed: number;
}
