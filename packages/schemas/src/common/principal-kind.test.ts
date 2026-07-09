import { describe, expect, expectTypeOf, it } from 'vitest';
import { type PrincipalKind, principalKindSchema } from './principal-kind';

describe('principalKindSchema', () => {
  it('accepts every recognized kind of acting party', () => {
    expect(principalKindSchema.safeParse('user').success).toBe(true);
    expect(principalKindSchema.safeParse('service').success).toBe(true);
    expect(principalKindSchema.safeParse('agent').success).toBe(true);
  });

  it('rejects a kind outside the enum', () => {
    expect(principalKindSchema.safeParse('robot').success).toBe(false);
  });

  it('infers the expected union type', () => {
    expectTypeOf<PrincipalKind>().toEqualTypeOf<'user' | 'service' | 'agent'>();
  });
});
