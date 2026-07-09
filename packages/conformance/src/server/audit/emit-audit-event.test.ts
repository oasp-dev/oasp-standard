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
});
