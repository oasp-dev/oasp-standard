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
    // one check per required what-value, plus shape/scope/provenance checks.
    expect(results.length).toBeGreaterThanOrEqual(6);
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
});
