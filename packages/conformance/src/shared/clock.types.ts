/**
 * A source of timestamps, injected everywhere the mock provider or
 * reference server would otherwise reach for `Date.now()`/`new
 * Date().toISOString()`. Injecting the clock is what makes the whole
 * kit reproducible: two `vitest run` invocations against the same test
 * file produce byte-identical `Event.at` / `AuditEvent.when` values,
 * because both runs start a fresh {@link Clock} from the same fixed
 * origin rather than reading the real wall clock.
 *
 * @see ./fixed-clock.ts for the deterministic implementation used
 * throughout this package's tests.
 */
export interface Clock {
  /**
   * Returns the current timestamp as an ISO 8601 date-time string with
   * an explicit offset, satisfying every schema field built on
   * `z.iso.datetime({ offset: true })` (`Event.at`, `AuditEvent.when`).
   * Each call MUST return a value strictly greater than the previous
   * call's, so timestamp-ordered assertions in tests are meaningful.
   */
  now(): string;
}
