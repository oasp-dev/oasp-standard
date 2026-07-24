import { describe, expect, it } from 'vitest';
import { registerPrincipalSetup } from '../setup/register-principal';
import { createServerState } from '../store/server-state';
import { buildAuditWho } from './build-audit-who';

describe('buildAuditWho', () => {
  it('includes only principal (looked up by kind from ServerState) when the actor carries no delegation', () => {
    const state = createServerState();
    const principal = registerPrincipalSetup(state, { kind: 'service', subject: 'svc_1', scopeMemberships: [], roles: [] });

    const who = buildAuditWho(state, {
      principalId: principal.id,
      subject: 'svc_1',
      scopeMemberships: [],
      roles: [],
      authenticationMethod: 'reference',
    });
    expect(who).toEqual({ principal: { kind: 'service', id: principal.id } });
    expect('onBehalfOf' in who).toBe(false);
  });

  it('includes onBehalfOf, sourced ONLY from actor.delegation.onBehalfOf, when the actor is delegated', () => {
    const state = createServerState();
    const actingPrincipal = registerPrincipalSetup(state, { kind: 'agent', subject: 'agent_1', scopeMemberships: [], roles: [] });

    const who = buildAuditWho(state, {
      principalId: actingPrincipal.id,
      subject: 'agent_1',
      scopeMemberships: [],
      roles: [],
      authenticationMethod: 'reference',
      delegation: { onBehalfOf: { kind: 'user', id: 'user_1' }, scopePin: { level: 'workspace', id: 'workspace_1' } },
    });
    expect(who).toEqual({ principal: { kind: 'agent', id: actingPrincipal.id }, onBehalfOf: { kind: 'user', id: 'user_1' } });
  });

  it('throws (invariant violation) when the actor names a principalId absent from ServerState.principals', () => {
    const state = createServerState();
    expect(() =>
      buildAuditWho(state, {
        principalId: 'principal_never_registered',
        subject: 'sub_1',
        scopeMemberships: [],
        roles: [],
        authenticationMethod: 'reference',
      }),
    ).toThrow(/Invariant violated/);
  });
});
