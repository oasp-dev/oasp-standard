import { describe, expect, expectTypeOf, it } from 'vitest';
import { type PrincipalRef, principalRefSchema } from './principal-ref';

describe('principalRefSchema', () => {
  it('accepts a valid principal pointer', () => {
    expect(principalRefSchema.safeParse({ kind: 'user', id: 'user_1' }).success).toBe(true);
  });

  it('rejects an invalid kind', () => {
    const result = principalRefSchema.safeParse({ kind: 'robot', id: 'user_1' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['kind']);
  });

  it('rejects a missing id', () => {
    const result = principalRefSchema.safeParse({ kind: 'user' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('infers the expected shape', () => {
    expectTypeOf<PrincipalRef>().toEqualTypeOf<{ kind: 'user' | 'service' | 'agent'; id: string }>();
  });
});
