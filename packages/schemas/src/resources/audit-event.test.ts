import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
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

  it('accepts an AuditEvent with no degraded field (the common case for six of the seven interactions, and a normal migrate)', () => {
    const result = auditEventSchema.safeParse(validAuditEvent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.degraded).toBeUndefined();
  });

  it('accepts a migrate AuditEvent with degraded: true (a fresh-start migrate after a transcript-fetch failure)', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, what: 'migrate', degraded: true });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('rejects a non-boolean degraded value', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, degraded: 'yes' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['degraded']);
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
    expectTypeOf<AuditEvent['outcome']>().toEqualTypeOf<'success' | 'failure' | 'not_found'>();
    expectTypeOf<AuditEvent['refs']['credentialIds']>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<AuditEvent['degraded']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<NonNullable<AuditEvent['evidence']>['contentDigest']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<AuditEvent['evidence']>['agentVersionRef']>().toEqualTypeOf<{ agentDefinitionId: string; version: number } | undefined>();
  });

  // Issue #11 Tranche A: a not-found precondition failure must be
  // distinguishable in the trail from an ordinary operational failure —
  // `outcome: 'not_found'` is its own enum value, not folded into `failure`.
  it("accepts outcome: 'not_found' with scope omitted (no primary resource was ever identified)", () => {
    const { scope: _scope, ...withoutScope } = validAuditEvent;
    const result = auditEventSchema.safeParse({ ...withoutScope, outcome: 'not_found', refs: { sessionId: 'does_not_exist' } });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it("accepts outcome: 'not_found' with scope still present (e.g. createConversation's caller-supplied scope)", () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, outcome: 'not_found', refs: { definitionId: 'does_not_exist' } });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it("rejects outcome: 'success' with scope omitted — scope is required unless outcome is 'not_found'", () => {
    const { scope: _scope, ...withoutScope } = validAuditEvent;
    const result = auditEventSchema.safeParse(withoutScope);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['scope']);
  });

  it("rejects outcome: 'failure' with scope omitted, the same as 'success'", () => {
    const { scope: _scope, ...withoutScope } = validAuditEvent;
    const result = auditEventSchema.safeParse({ ...withoutScope, outcome: 'failure' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['scope']);
  });

  // The `.check()` above enforces the scope-unless-not_found invariant for
  // TypeScript consumers only — a Zod refinement emits nothing into the
  // generated JSON Schema. The published artifact carries the SAME invariant
  // as a declarative `if`/`else` conditional injected via this schema's
  // `.meta()` (which zod's `toJSONSchema` merges verbatim into its output);
  // this test pins that the conditional actually survives generation, so a
  // non-TypeScript consumer validating a scope-less success event against
  // schemas/v1alpha1/AuditEvent.json rejects it exactly as Zod does. Without
  // this, dropping the `.meta()` keys would silently reopen the gap: the
  // drift gate (generate.test.ts) only proves source and artifact agree, not
  // that either carries the conditionality.
  it("emits the scope-unless-not_found conditional into the generated JSON Schema (if/else survives toJSONSchema; scope stays out of top-level required)", () => {
    const generated = z.toJSONSchema(auditEventSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
    expect(generated['if']).toEqual({ properties: { outcome: { const: 'not_found' } }, required: ['outcome'] });
    expect(generated['else']).toEqual({ required: ['scope'] });
    expect(generated['required']).not.toContain('scope');
  });

  it('rejects an outcome value outside the success | failure | not_found vocabulary', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, outcome: 'denied' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['outcome']);
  });

  it('accepts evidence.contentDigest on a send AuditEvent', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, evidence: { contentDigest: 'sha256:abc123' } });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts evidence.agentVersionRef alongside contentDigest', () => {
    const result = auditEventSchema.safeParse({
      ...validAuditEvent,
      evidence: { contentDigest: 'sha256:abc123', agentVersionRef: { agentDefinitionId: 'agentdef_1', version: 3 } },
    });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts an AuditEvent with no evidence field at all (the common case for most interactions)', () => {
    const result = auditEventSchema.safeParse(validAuditEvent);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.evidence).toBeUndefined();
  });

  it('rejects an empty-string evidence.contentDigest', () => {
    const result = auditEventSchema.safeParse({ ...validAuditEvent, evidence: { contentDigest: '' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['evidence', 'contentDigest']);
  });
});
