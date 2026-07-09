import type { Clock } from './clock.types';

/**
 * Builds a {@link Clock} that starts at a fixed instant and advances by
 * a fixed increment on every `now()` call — never reading the real
 * wall clock. This is the determinism primitive the whole conformance
 * kit depends on: two test runs starting a `createFixedClock` from the
 * same `startIso` produce identical `at`/`when` timestamps in identical
 * call order, so emitted `Event`/`AuditEvent` records are
 * byte-for-byte reproducible across runs.
 *
 * @param startIso ISO 8601 date-time (with offset) the clock begins at.
 * @param incrementMs Milliseconds to advance on each `now()` call. Kept
 *   strictly positive so successive timestamps are always strictly
 *   increasing, never equal — the S1 event-ordering guarantee assumes
 *   a total order.
 */
export function createFixedClock(startIso: string, incrementMs = 10): Clock {
  let currentMs = Date.parse(startIso);
  if (Number.isNaN(currentMs)) {
    throw new Error(`createFixedClock: startIso "${startIso}" is not a parseable ISO 8601 date-time.`);
  }

  return {
    now(): string {
      const iso = new Date(currentMs).toISOString();
      currentMs += incrementMs;
      return iso;
    },
  };
}
