import { auditEventSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { createFixedClock } from '../../shared/fixed-clock';
import { createServerState } from '../store/server-state';
import { emitAuditEvent } from './emit-audit-event';

describe('emitAuditEvent', () => {
  it('produces a schema-valid AuditEvent and appends it to the state audit log', () => {
    const state = createServerState();
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    const event = emitAuditEvent(state, clock, {
      who: { principal: { kind: 'user', id: 'user_1' } },
      what: 'publish',
      scope: { level: 'workspace', id: 'workspace_1' },
      outcome: 'success',
      refs: { definitionId: 'agentdef_1' },
    });

    expect(auditEventSchema.safeParse(event).success).toBe(true);
    expect(state.auditLog).toEqual([event]);
    expect(event.when).toBe('2026-01-01T00:00:00.000Z');
  });

  it('assigns a unique id per call', () => {
    const state = createServerState();
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    const input = {
      who: { principal: { kind: 'user' as const, id: 'user_1' } },
      what: 'publish' as const,
      scope: { level: 'workspace' as const, id: 'workspace_1' },
      outcome: 'success' as const,
      refs: {},
    };

    const first = emitAuditEvent(state, clock, input);
    const second = emitAuditEvent(state, clock, input);
    expect(first.id).not.toBe(second.id);
  });

  // Issue #11 Tranche A: a not-found precondition has no primary resource to
  // source a scope from — `scope` is omittable on that one outcome value.
  it('accepts a not_found outcome with no scope, and omits the key entirely rather than storing scope: undefined', () => {
    const state = createServerState();
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    const event = emitAuditEvent(state, clock, {
      who: { principal: { kind: 'user', id: 'user_1' } },
      what: 'send',
      outcome: 'not_found',
      refs: { sessionId: 'does_not_exist' },
    });

    expect(auditEventSchema.safeParse(event).success).toBe(true);
    expect('scope' in event).toBe(false);
  });

  it('throws when a success outcome is emitted with no scope — a malformed event reaching this choke point is a bug, not a Result-worthy expected failure', () => {
    const state = createServerState();
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    expect(() =>
      emitAuditEvent(state, clock, {
        who: { principal: { kind: 'user', id: 'user_1' } },
        what: 'publish',
        outcome: 'success',
        refs: {},
      }),
    ).toThrow();
  });

  it('omits evidence entirely (never {}) when the caller passes none', () => {
    const state = createServerState();
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    const event = emitAuditEvent(state, clock, {
      who: { principal: { kind: 'user', id: 'user_1' } },
      what: 'publish',
      scope: { level: 'workspace', id: 'workspace_1' },
      outcome: 'success',
      refs: {},
    });

    expect('evidence' in event).toBe(false);
  });

  it('carries evidence through unchanged when the caller passes it', () => {
    const state = createServerState();
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    const event = emitAuditEvent(state, clock, {
      who: { principal: { kind: 'user', id: 'user_1' } },
      what: 'send',
      scope: { level: 'workspace', id: 'workspace_1' },
      outcome: 'success',
      refs: { sessionId: 'sess_1' },
      evidence: { contentDigest: 'sha256:abc123' },
    });

    expect(event.evidence).toEqual({ contentDigest: 'sha256:abc123' });
  });
});
