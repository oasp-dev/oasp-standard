import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Principal, principalSchema } from './principal';

const validPrincipal = {
  id: 'user_1',
  kind: 'user',
  identity: { subject: 'auth0|abc123', issuer: 'https://example.auth0.com/', email: 'a@example.com' },
  scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }],
  roles: ['workspace-admin'],
};

describe('principalSchema', () => {
  it('parses a valid Principal', () => {
    expect(principalSchema.safeParse(validPrincipal).success).toBe(true);
  });

  it('accepts an identity asserting only the required subject claim', () => {
    const result = principalSchema.safeParse({ ...validPrincipal, identity: { subject: 'svc|abc' } });
    expect(result.success).toBe(true);
  });

  it('rejects an identity with a malformed email claim', () => {
    const result = principalSchema.safeParse({
      ...validPrincipal,
      identity: { ...validPrincipal.identity, email: 'not-an-email' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['identity', 'email']);
  });

  it('infers the expected shape', () => {
    expectTypeOf<Principal>().toMatchTypeOf<{
      id: string;
      kind: 'user' | 'service' | 'agent';
      roles: string[];
    }>();
  });
});
