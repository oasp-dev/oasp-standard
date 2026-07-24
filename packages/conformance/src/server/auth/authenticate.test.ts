import { describe, expect, it } from 'vitest';
import { createServerState } from '../store/server-state';
import { registerPrincipalSetup } from '../setup/register-principal';
import { authenticate } from './authenticate';

describe('authenticate', () => {
  it('mints an AuthenticatedActor from a registered Principal, carrying its identity/scopeMemberships/roles', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, {
      kind: 'user',
      subject: 'sub_1',
      issuer: 'https://idp.example.com',
      scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }],
      roles: ['admin'],
    });

    const result = authenticate(state, { principalId: principal.id });
    expect(result).toEqual({
      ok: true,
      value: {
        principalId: principal.id,
        subject: 'sub_1',
        issuer: 'https://idp.example.com',
        scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }],
        roles: ['admin'],
        authenticationMethod: 'reference',
      },
    });
  });

  it('omits issuer entirely (never undefined) when the stored Principal has none — exactOptionalPropertyTypes', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, { kind: 'user', subject: 'sub_1', scopeMemberships: [], roles: [] });

    const result = authenticate(state, { principalId: principal.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('issuer' in result.value).toBe(false);
  });

  it('fails closed (Server.AuthenticationFailed) for a principalId naming no registered Principal', () => {
    const state = createServerState();
    const result = authenticate(state, { principalId: 'principal_never_registered' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.AuthenticationFailed');
  });

  it('never trusts a caller-supplied subject/scopeMemberships/roles — only ever the stored record, even if principalId happens to collide with attacker-controlled input', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, {
      kind: 'user',
      subject: 'real_subject',
      scopeMemberships: [{ level: 'workspace', id: 'workspace_real' }],
      roles: [],
    });

    // AuthenticateInput carries nothing BUT principalId — there is no field
    // through which a caller could smuggle a different subject/scope/roles.
    const result = authenticate(state, { principalId: principal.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.subject).toBe('real_subject');
    expect(result.value.scopeMemberships).toEqual([{ level: 'workspace', id: 'workspace_real' }]);
  });

  describe('delegation', () => {
    it('mints a VerifiedDelegation when both principalId and onBehalfOfPrincipalId are registered', () => {
      const state = createServerState();
      const actingPrincipal = registerPrincipalSetup(state, { kind: 'service', subject: 'svc_1', scopeMemberships: [], roles: [] });
      const onBehalfOfPrincipal = registerPrincipalSetup(state, { kind: 'user', subject: 'member_1', scopeMemberships: [], roles: [] });
      const scopePin = { level: 'workspace' as const, id: 'workspace_pin' };

      const result = authenticate(state, {
        principalId: actingPrincipal.id,
        delegation: { onBehalfOfPrincipalId: onBehalfOfPrincipal.id, scopePin },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.delegation).toEqual({ onBehalfOf: { kind: 'user', id: onBehalfOfPrincipal.id }, scopePin });
    });

    it('fails closed when onBehalfOfPrincipalId names no registered Principal, even though principalId is valid', () => {
      const state = createServerState();
      const actingPrincipal = registerPrincipalSetup(state, { kind: 'service', subject: 'svc_1', scopeMemberships: [], roles: [] });

      const result = authenticate(state, {
        principalId: actingPrincipal.id,
        delegation: { onBehalfOfPrincipalId: 'principal_never_registered', scopePin: { level: 'workspace', id: 'workspace_pin' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('Server.AuthenticationFailed');
    });

    it('omits delegation entirely (never undefined) when input.delegation is absent', () => {
      const state = createServerState();
      const principal = registerPrincipalSetup(state, { kind: 'user', subject: 'sub_1', scopeMemberships: [], roles: [] });

      const result = authenticate(state, { principalId: principal.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('delegation' in result.value).toBe(false);
    });
  });
});
