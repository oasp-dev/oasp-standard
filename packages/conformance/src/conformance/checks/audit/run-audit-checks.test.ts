import type { AuditEvent } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import { testHarnessFactory } from '../../../factories/test-harness-factory';
import { runAuditChecks } from './run-audit-checks';

describe('runAuditChecks', () => {
  it('every check passes against the conformant reference server', async () => {
    const { server } = testHarnessFactory();
    const results = await runAuditChecks(server);

    const failures = results.filter((r) => !r.passed);
    expect(failures, JSON.stringify(failures)).toEqual([]);
    // one check per required what-value (7), plus shape/scope/provenance/
    // credentialIds (createConversation + migrate)/session-bound checks.
    expect(results.length).toBeGreaterThanOrEqual(14);
  });

  it('catches a server that fails to emit a required AuditEvent', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      // Mutates state exactly like a real publish would (so downstream scenario
      // setup — e.g. createConversation, which now requires a published definition
      // — still succeeds) but hides the resulting AuditEvent from every observer,
      // simulating a server whose publish interaction never calls emitAuditEvent.
      listAuditEvents: () => realServer.listAuditEvents().filter((e) => e.what !== 'publish'),
    };

    const results = await runAuditChecks(brokenServer);
    const publishCheck = results.find((r) => r.name.includes('audit: publish emits'));
    expect(publishCheck?.passed).toBe(false);
  });

  // B3: the "present & non-empty scope" check alone cannot catch a wrong-but-populated
  // scope. Corrupting only the four session-bound whats' scope (send/sendToolResult/
  // drain/stream) — exactly as the reviewer's proof did — must turn the new
  // scope-provenance checks red, both for the Conversation-bound scenario and for the
  // builder/test-session fallback scenario.
  it('catches a server whose session-bound (send/sendToolResult/drain/stream) AuditEvents carry the wrong scope', async () => {
    const { server: realServer } = testHarnessFactory();
    const corruptedWhats: readonly AuditEvent['what'][] = ['send', 'sendToolResult', 'drain', 'stream'];
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () =>
        realServer.listAuditEvents().map((event) =>
          corruptedWhats.includes(event.what) ? { ...event, scope: { level: 'workspace' as const, id: 'wrong_scope' } } : event,
        ),
    };

    const results = await runAuditChecks(brokenServer);
    const conversationProvenance = results.find((r) => r.name.includes('Conversation-bound session'));
    const fallbackProvenance = results.find((r) => r.name.includes('builder/test-session'));
    expect(conversationProvenance?.passed).toBe(false);
    expect(fallbackProvenance?.passed).toBe(false);
    // The pre-existing "present & non-empty" check is exactly what stayed green under
    // this same corruption before this fix — scope.id is still populated, just wrong.
    const nonEmptyCheck = results.find((r) => r.name.includes('populated, non-empty scope'));
    expect(nonEmptyCheck?.passed).toBe(true);
  });

  // S4 teeth (1 of 2): the credential-attach gap issue #5 closed. A server
  // that creates a Conversation without ever emitting a `createConversation`
  // AuditEvent at all — exactly the pre-S4 reference server's behaviour,
  // which this check suite used to accept by design — must now be caught by
  // the required-emission loop, the same way a missing `publish` event is.
  it('catches a server that creates a Conversation without emitting a createConversation AuditEvent (S4: closes the pre-S4 "nothing is audited here" gap)', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      // Mutates state exactly like a real createConversation would (so the
      // returned Conversation/Session are real and downstream send/drain/
      // stream/sendToolResult/migrate calls still succeed) but hides the
      // resulting AuditEvent from every observer — simulating a server that
      // still treats initial Session creation as an unaudited setup helper,
      // the documented pre-S4 behaviour.
      listAuditEvents: () => realServer.listAuditEvents().filter((e) => e.what !== 'createConversation'),
    };

    const results = await runAuditChecks(brokenServer);
    const createConversationCheck = results.find((r) => r.name.includes('audit: createConversation emits'));
    expect(createConversationCheck?.passed).toBe(false);
  });

  // S4 teeth (2 of 2): a server that DOES emit `what: 'createConversation'`
  // but omits `refs.credentialIds` still leaves the "which credential, when,
  // on whose behalf" question unanswerable from the trail — the exact
  // failure mode issue #5 tracked ("records THAT, not WHICH"). The
  // required-emission loop alone cannot catch this (the event exists); only
  // the dedicated credentialIds check can.
  it('catches a server whose createConversation AuditEvent omits refs.credentialIds (S4: names WHICH credential, not just that one was attached)', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () =>
        realServer.listAuditEvents().map((event) => {
          if (event.what !== 'createConversation') return event;
          const { credentialIds: _credentialIds, ...refsWithoutCredentialIds } = event.refs;
          return { ...event, refs: refsWithoutCredentialIds };
        }),
    };

    const results = await runAuditChecks(brokenServer);
    const createConversationCheck = results.find((r) => r.name.includes('audit: createConversation emits'));
    const credentialCheck = results.find((r) => r.name.includes('createConversation names the attached Credential'));
    // The event itself still exists (only its refs were corrupted) — the
    // required-emission check must stay green, isolating the failure to the
    // credentialIds check specifically, not a side effect of a missing event.
    expect(createConversationCheck?.passed).toBe(true);
    expect(credentialCheck?.passed).toBe(false);
  });

  // Same teeth for migrate's re-attachment case: docs/spec/audit.md's
  // migrate row previously recorded THAT credentials were re-attached; a
  // server that still omits refs.credentialIds on migrate has not actually
  // closed that half of the gap, even if createConversation is fixed.
  it('catches a server whose migrate AuditEvent omits refs.credentialIds (S4: migrate re-attachment must also name WHICH credential)', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () =>
        realServer.listAuditEvents().map((event) => {
          if (event.what !== 'migrate') return event;
          const { credentialIds: _credentialIds, ...refsWithoutCredentialIds } = event.refs;
          return { ...event, refs: refsWithoutCredentialIds };
        }),
    };

    const results = await runAuditChecks(brokenServer);
    const migrateCheck = results.find((r) => r.name.includes('audit: migrate emits'));
    const credentialCheck = results.find((r) => r.name.includes('migrate names the re-attached Credential'));
    expect(migrateCheck?.passed).toBe(true);
    expect(credentialCheck?.passed).toBe(false);
  });
});
