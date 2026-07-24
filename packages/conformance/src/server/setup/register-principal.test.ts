import { principalSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { createServerState } from '../store/server-state';
import { registerPrincipalSetup } from './register-principal';

describe('registerPrincipalSetup', () => {
  it('builds a schema-valid Principal and stores it under a deterministic principal_N id', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, {
      kind: 'user',
      subject: 'sub_1',
      scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }],
      roles: ['admin'],
    });

    expect(principal.id).toBe('principal_1');
    expect(principalSchema.safeParse(principal).success).toBe(true);
    expect(state.principals.get('principal_1')).toEqual(principal);
  });

  it('assigns sequential ids across repeated calls, never reusing one', () => {
    const state = createServerState();
    const first = registerPrincipalSetup(state, { kind: 'user', subject: 'sub_1', scopeMemberships: [], roles: [] });
    const second = registerPrincipalSetup(state, { kind: 'user', subject: 'sub_2', scopeMemberships: [], roles: [] });
    expect(first.id).toBe('principal_1');
    expect(second.id).toBe('principal_2');
    expect(state.principals.size).toBe(2);
  });

  it('omits identity.issuer entirely (never undefined) when input carries none', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, { kind: 'user', subject: 'sub_1', scopeMemberships: [], roles: [] });
    expect('issuer' in principal.identity).toBe(false);
  });

  it('carries identity.issuer through when input provides one', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, {
      kind: 'service',
      subject: 'sub_1',
      issuer: 'https://idp.example.com',
      scopeMemberships: [],
      roles: [],
    });
    expect(principal.identity.issuer).toBe('https://idp.example.com');
  });

  it('rejects (throws via schema validation) an empty subject — the claims contract requires a non-empty subject', () => {
    const state = createServerState();
    expect(() => registerPrincipalSetup(state, { kind: 'user', subject: '', scopeMemberships: [], roles: [] })).toThrow();
  });

  it('preserves every scopeMemberships entry and roles entry given, in order', () => {
    const state = createServerState();
    const scopeMemberships = [
      { level: 'tenant' as const, id: 'tenant_1' },
      { level: 'workspace' as const, id: 'workspace_1' },
    ];
    const principal = registerPrincipalSetup(state, { kind: 'agent', subject: 'sub_1', scopeMemberships, roles: ['role_a', 'role_b'] });
    expect(principal.scopeMemberships).toEqual(scopeMemberships);
    expect(principal.roles).toEqual(['role_a', 'role_b']);
  });
});
