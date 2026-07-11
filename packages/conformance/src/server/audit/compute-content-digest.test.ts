import { describe, expect, it } from 'vitest';
import { computeContentDigest } from './compute-content-digest';

describe('computeContentDigest', () => {
  it('is deterministic: the same content always digests to the same value', () => {
    expect(computeContentDigest('hello world')).toBe(computeContentDigest('hello world'));
  });

  it('is formatted sha256:<hex>', () => {
    expect(computeContentDigest('hello world')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('produces different digests for different content', () => {
    expect(computeContentDigest('hello')).not.toBe(computeContentDigest('goodbye'));
  });

  it('matches the well-known sha256 of the empty string', () => {
    // A fixed, independently-verifiable value — not just "differs from other input" —
    // so a regression to a different algorithm entirely would be caught.
    expect(computeContentDigest('')).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
