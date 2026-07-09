import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Provider, providerSchema } from './provider';

describe('providerSchema', () => {
  it('accepts the reference adapter and the reserved provider names', () => {
    expect(providerSchema.safeParse('anthropic').success).toBe(true);
    expect(providerSchema.safeParse('openai').success).toBe(true);
    expect(providerSchema.safeParse('google').success).toBe(true);
  });

  it('rejects a provider name outside the enum', () => {
    const result = providerSchema.safeParse('azure');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.code).toBe('invalid_value');
  });

  it('infers the expected union type', () => {
    expectTypeOf<Provider>().toEqualTypeOf<'anthropic' | 'openai' | 'google'>();
  });
});
