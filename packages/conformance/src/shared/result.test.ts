import { describe, expect, it } from 'vitest';
import { err, ok } from './result';

describe('ok', () => {
  it('builds a successful Result carrying the given value', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });
});

describe('err', () => {
  it('builds a failed Result carrying the given error', () => {
    const result = err({ code: 'Thing.NotFound', message: 'not found' });
    expect(result).toEqual({ ok: false, error: { code: 'Thing.NotFound', message: 'not found' } });
  });
});
