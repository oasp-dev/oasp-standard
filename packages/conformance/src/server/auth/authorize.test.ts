import { describe, expect, it } from 'vitest';
import type { AuthenticatedActor } from './authenticated-actor.types';
import { authorize } from './authorize';

function buildActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    principalId: 'principal_1',
    subject: 'user_1',
    scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }],
    roles: [],
    authenticationMethod: 'reference',
    ...overrides,
  };
}

describe('authorize', () => {
  it('authorizes when the resource scope exactly matches an entry in scopeMemberships', () => {
    const actor = buildActor({ scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }] });
    const result = authorize(actor, { level: 'workspace', id: 'workspace_1' });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('rejects when the resource scope has no matching entry in scopeMemberships', () => {
    const actor = buildActor({ scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }] });
    const result = authorize(actor, { level: 'workspace', id: 'workspace_other' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.Unauthorized');
  });

  it('rejects when the level matches but the id does not (exact match, never level-only)', () => {
    const actor = buildActor({ scopeMemberships: [{ level: 'workspace', id: 'workspace_1' }] });
    const result = authorize(actor, { level: 'workspace', id: 'workspace_2' });
    expect(result.ok).toBe(false);
  });

  it('rejects when the id matches but the level does not (exact match, never id-only)', () => {
    const actor = buildActor({ scopeMemberships: [{ level: 'workspace', id: 'same_id' }] });
    const result = authorize(actor, { level: 'group', id: 'same_id' });
    expect(result.ok).toBe(false);
  });

  it('rejects an actor with empty scopeMemberships against any scope', () => {
    const actor = buildActor({ scopeMemberships: [] });
    const result = authorize(actor, { level: 'workspace', id: 'workspace_1' });
    expect(result.ok).toBe(false);
  });

  it('authorizes when ANY of several memberships matches, not just the first', () => {
    const actor = buildActor({
      scopeMemberships: [
        { level: 'tenant', id: 'tenant_1' },
        { level: 'workspace', id: 'workspace_1' },
        { level: 'user', id: 'user_1' },
      ],
    });
    const result = authorize(actor, { level: 'workspace', id: 'workspace_1' });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  describe('delegated actor (containment rule)', () => {
    it('authorizes when the resource scope exactly matches the scopePin', () => {
      const actor = buildActor({
        scopeMemberships: [],
        delegation: { onBehalfOf: { kind: 'user', id: 'member_1' }, scopePin: { level: 'workspace', id: 'workspace_pin' } },
      });
      const result = authorize(actor, { level: 'workspace', id: 'workspace_pin' });
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it('rejects when the resource scope differs from the scopePin, even though the acting principal is separately a member of it', () => {
      // The load-bearing case: scopeMemberships genuinely includes the target
      // scope, but authorize() must NOT consult it while delegated — the pin
      // is the ceiling, never widened by either party's memberships.
      const actor = buildActor({
        scopeMemberships: [{ level: 'workspace', id: 'workspace_target' }],
        delegation: { onBehalfOf: { kind: 'user', id: 'member_1' }, scopePin: { level: 'workspace', id: 'workspace_pin' } },
      });
      const result = authorize(actor, { level: 'workspace', id: 'workspace_target' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('Server.Unauthorized');
    });

    it('rejects when the resource scope differs from the scopePin and scopeMemberships is empty', () => {
      const actor = buildActor({
        scopeMemberships: [],
        delegation: { onBehalfOf: { kind: 'user', id: 'member_1' }, scopePin: { level: 'workspace', id: 'workspace_pin' } },
      });
      const result = authorize(actor, { level: 'workspace', id: 'workspace_other' });
      expect(result.ok).toBe(false);
    });
  });
});
