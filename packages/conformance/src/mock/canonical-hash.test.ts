import { describe, expect, it } from 'vitest';
import { computeCanonicalHash } from './canonical-hash';

describe('computeCanonicalHash', () => {
  it('is deterministic for the same input', () => {
    expect(computeCanonicalHash('same-content')).toBe(computeCanonicalHash('same-content'));
  });

  it('differs for different input', () => {
    expect(computeCanonicalHash('content-a')).not.toBe(computeCanonicalHash('content-b'));
  });

  it('returns a fixed-width hex string', () => {
    expect(computeCanonicalHash('anything')).toMatch(/^[0-9a-f]{8}$/);
  });
});
