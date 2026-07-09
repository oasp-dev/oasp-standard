import type { Event } from '@oasp/schemas';
import type { Clock } from '../shared/clock.types';
import type { DistributiveOmit } from '../shared/distributive-omit.types';
import type { ZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';

/**
 * Builds a fully-formed {@link Event} by stamping a variant-specific
 * payload with an `id` (from the session's own {@link ZeroPaddedIdGenerator},
 * so it is lexicographically monotonic within that session — the S1
 * ordering guarantee) and an `at` timestamp (from the injected
 * {@link Clock}, so it is reproducible run-to-run). Pure aside from
 * those two injected sources — no hidden `Date.now()`/counter state.
 */
export function buildEvent(idGenerator: ZeroPaddedIdGenerator, clock: Clock, variant: DistributiveOmit<Event, 'id' | 'at'>): Event {
  return { ...variant, id: idGenerator.next(), at: clock.now() } as Event;
}
