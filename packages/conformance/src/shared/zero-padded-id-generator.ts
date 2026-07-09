/**
 * A generator of monotonically, lexicographically increasing ids
 * (zero-padded counters), and the resettable width it was built with.
 */
export interface ZeroPaddedIdGenerator {
  /** Returns the next id in sequence, zero-padded to a fixed width. */
  next(): string;
}

/**
 * Builds an id generator satisfying the S1 event-ordering guarantee
 * (see `docs/spec/interactions.md` § `stream`): each returned id is
 * lexicographically greater than every id returned before it, because
 * a fixed-width zero-padded decimal counter sorts identically as a
 * byte string and as a number (`"000000010"` sorts after
 * `"000000002"`, unlike the unpadded `"10"` / `"2"`).
 *
 * `width` MUST be large enough that the counter never overflows it
 * within a single session's lifetime in a test run; 10 digits (up to
 * 9,999,999,999 events) is far beyond anything a conformance run
 * produces, and overflow would silently break the lexicographic
 * guarantee this generator exists to provide.
 *
 * @param prefix Prepended to every id verbatim (e.g. a session id), so
 *   ids remain globally unique across sessions while staying
 *   lexicographically ordered *within* one session's own sequence.
 * @param width Zero-padded digit width of the counter portion.
 */
export function createZeroPaddedIdGenerator(prefix: string, width = 10): ZeroPaddedIdGenerator {
  let counter = 0;

  return {
    next(): string {
      const padded = String(counter).padStart(width, '0');
      counter += 1;
      return `${prefix}_${padded}`;
    },
  };
}
