import { describe, expect, it } from 'vitest';
import { createFixedClock } from './fixed-clock';

describe('createFixedClock', () => {
  it('starts at the given instant', () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    expect(clock.now()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('advances by the given increment on every call', () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z', 1000);
    expect(clock.now()).toBe('2026-01-01T00:00:00.000Z');
    expect(clock.now()).toBe('2026-01-01T00:00:01.000Z');
    expect(clock.now()).toBe('2026-01-01T00:00:02.000Z');
  });

  it('defaults to a 10ms increment', () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    clock.now();
    expect(clock.now()).toBe('2026-01-01T00:00:00.010Z');
  });

  it('is fully reproducible: two independently-constructed clocks agree on every call', () => {
    const a = createFixedClock('2026-07-09T12:00:00.000Z', 25);
    const b = createFixedClock('2026-07-09T12:00:00.000Z', 25);
    const callsA = Array.from({ length: 5 }, () => a.now());
    const callsB = Array.from({ length: 5 }, () => b.now());
    expect(callsA).toEqual(callsB);
  });

  it('throws on an unparseable start instant', () => {
    expect(() => createFixedClock('not-a-date')).toThrow(/not a parseable/);
  });
});
