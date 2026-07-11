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
    // credentialIds (createConversation + migrate)/session-bound checks,
    // plus contentDigest/agentVersionRef evidence checks and one not-found
    // check per required what-value (9 more, issue #11 Tranche A).
    expect(results.length).toBeGreaterThanOrEqual(23);
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

  // Issue #11 Tranche A: the original defect this slice fixes — a not-found
  // precondition failure returning before `emitAuditEvent` ever ran, leaving
  // a failed enumeration probe with zero trace. Simulates that pre-fix
  // behaviour by hiding every `not_found` AuditEvent from the observer, the
  // same technique the other "catches a server that fails to emit" tests
  // above use.
  it('catches a server that returns silently on a not-found precondition, emitting no AuditEvent at all (the original issue #11 defect)', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () => realServer.listAuditEvents().filter((e) => e.outcome !== 'not_found'),
    };

    const results = await runAuditChecks(brokenServer);
    const notFoundFailures = results.filter((r) => r.name.includes("outcome: 'not_found'") && !r.passed);
    // All seven not-found checks must fail — every one of them silently
    // returns nothing to observe under this simulated defect.
    expect(notFoundFailures).toHaveLength(7);
  });

  // A weaker, partial fix — emitting an AuditEvent on a not-found precondition
  // but stamping it outcome: 'failure' like any other operational failure —
  // still leaves a probe indistinguishable from an ordinary error in the
  // trail. The dedicated not_found value exists precisely so this is caught.
  it("catches a server whose not-found AuditEvents use outcome: 'failure' instead of the distinguishable 'not_found' value", async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () => realServer.listAuditEvents().map((e) => (e.outcome === 'not_found' ? { ...e, outcome: 'failure' as const } : e)),
    };

    const results = await runAuditChecks(brokenServer);
    const notFoundFailures = results.filter((r) => r.name.includes("outcome: 'not_found'") && !r.passed);
    expect(notFoundFailures).toHaveLength(7);
  });

  // Issue #11 Tranche A teeth: a server that never populates
  // evidence.contentDigest on `send` leaves "exactly what content was sent"
  // unanswerable from the trail alone — the exact gap this field closes.
  it('catches a server whose send AuditEvent omits evidence.contentDigest', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () =>
        realServer.listAuditEvents().map((event) => {
          if (event.what !== 'send' || !event.evidence) return event;
          const { contentDigest: _contentDigest, ...evidenceWithoutContentDigest } = event.evidence;
          return { ...event, evidence: evidenceWithoutContentDigest };
        }),
    };

    const results = await runAuditChecks(brokenServer);
    const contentDigestCheck = results.find((r) => r.name.includes('evidence.contentDigest'));
    expect(contentDigestCheck?.passed).toBe(false);
  });

  // Issue #11 Tranche A teeth: a server that never populates
  // evidence.agentVersionRef leaves "under which AgentDefinition version"
  // unanswerable straight from the AuditEvent, forcing a reader back to
  // Session/Conversation state the trail is supposed to be sufficient
  // without.
  it('catches a server whose session/conversation-scoped AuditEvents omit evidence.agentVersionRef', async () => {
    const { server: realServer } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () =>
        realServer.listAuditEvents().map((event) => {
          if (!event.evidence?.agentVersionRef) return event;
          const { agentVersionRef: _agentVersionRef, ...evidenceWithoutAgentVersionRef } = event.evidence;
          return { ...event, evidence: evidenceWithoutAgentVersionRef };
        }),
    };

    const results = await runAuditChecks(brokenServer);
    const agentVersionRefCheck = results.find((r) => r.name.includes('evidence.agentVersionRef'));
    expect(agentVersionRefCheck?.passed).toBe(false);
  });
});
