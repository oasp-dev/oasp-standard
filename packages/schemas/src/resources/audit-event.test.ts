import { describe, expect, expectTypeOf, it } from 'vitest';
import { type AuditEvent, auditEventSchema } from './audit-event';

const validAuditEvent = {
  id: 'audit_1',
  who: { principal: { kind: 'agent', id: 'agentdef_1' }, onBehalfOf: { kind: 'user', id: 'user_1' } },
  what: 'send',
  scope: { level: 'workspace', id: 'workspace_1' },
  when: '2026-01-01T00:00:00.000Z',
  outcome: 'success',
  refs: { sessionId: 'sess_1' },
};

describe('auditEventSchema', () => {
  it('parses a valid AuditEvent', () => {
    const result = auditEventSchema.safeParse(validAuditEvent);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts an AuditEvent whose who has no onBehalfOf (no attribution pin)', () => {
    const { onBehalfOf: _onBehalfOf, ...whoWithoutOnBehalfOf } = validAuditEvent.who;
    const result = auditEventSchema.safeParse({ ...validAuditEvent, who: whoWithoutOnBehalfOf });
    expect(result.success).toBe(true);
  });

  it('accepts refs with every ref omitted (an interaction touching no other resource)', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, refs: {} });
    expect(result.success).toBe(true);
  });

  it('accepts a when with a numeric zone offset (not just UTC Z)', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, when: '2026-07-09T14:14:05.000+12:00' });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('rejects a when that is not an ISO 8601 date-time', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, when: '2026-07-09' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['when']);
  });

  it('rejects a what value outside the v0 interaction vocabulary', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, what: 'delete' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['what']);
  });

  it('accepts what: \'createConversation\', the emission point for a new Conversation\'s initial Session (mount + credential attach)', () => {
    const result = auditEventSchema.safeParse({
      ...validAuditEvent,
      what: 'createConversation',
      refs: { conversationId: 'conv_1', sessionId: 'sess_1', credentialIds: ['credential_1'] },
    });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts refs.credentialIds naming more than one attached Credential', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, refs: { sessionId: 'sess_1', credentialIds: ['credential_1', 'credential_2'] } });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('rejects an empty-string entry in refs.credentialIds', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, refs: { sessionId: 'sess_1', credentialIds: [''] } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['refs', 'credentialIds', 0]);
  });

  it('infers the expected shape', () => {
    expectTypeOf<AuditEvent['what']>().toEqualTypeOf<
      'publish' | 'createConversation' | 'migrate' | 'drain' | 'stream' | 'send' | 'sendToolResult'
    >();
    expectTypeOf<AuditEvent['outcome']>().toEqualTypeOf<'success' | 'failure'>();
    expectTypeOf<AuditEvent['refs']['credentialIds']>().toEqualTypeOf<string[] | undefined>();
  });
});
