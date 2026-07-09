/**
 * A pure function returning the next value in a deterministic
 * pseudo-random sequence, `[0, 1)`.
 */
export type SeededRandom = () => number;

/**
 * Builds a deterministic pseudo-random generator (mulberry32) seeded by
 * a 32-bit integer. Used only for content variability the mock
 * provider is free to vary (e.g. which of several canned reply
 * templates it picks) — never for anything that affects control flow,
 * event ordering, or ids, so a run's *shape* never depends on it. Given
 * the same seed, every call sequence reproduces identically: this is
 * what "seeded, reproducible event streams" (per this package's
 * charter) actually means in code.
 *
 * @param seed Any 32-bit integer. The same seed always produces the
 *   same infinite sequence.
 */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
