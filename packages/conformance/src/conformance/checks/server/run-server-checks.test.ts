import { conversationSchema } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import type { AgentProvider } from '../../../adapter/agent-provider.types';
import { testHarnessFactory } from '../../../factories/test-harness-factory';
import { createMockAgentProvider } from '../../../mock/create-mock-agent-provider';
import { createReferenceServer } from '../../../server/create-reference-server';
import { createFixedClock } from '../../../shared/fixed-clock';
import { runServerChecks } from './run-server-checks';

function findCheck(results: Awaited<ReturnType<typeof runServerChecks>>, fragment: string) {
  return results.find((r) => r.name.includes(fragment));
}

describe('runServerChecks', () => {
  it('every check passes against the conformant reference server', async () => {
    const { server, controls } = testHarnessFactory();
    const results = await runServerChecks(server, controls);

    const failures = results.filter((r) => !r.passed);
    expect(failures, JSON.stringify(failures)).toEqual([]);
    expect(results.length).toBeGreaterThan(0);
  });

  it('catches a non-conformant server: a migrate that never actually moves the session', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      migrate: async (conversationId) => {
        const conversation = realServer.getConversation(conversationId);
        // Simulate a broken implementation that reports success without minting a
        // new session or updating previousSessionIds — exactly the bug
        // checkLineageAppendOnlyOldestFirst and checkMigrateNonCompounding exist to catch.
        return conversation ? { ok: true, value: conversation } : { ok: false, error: { code: 'x', message: 'not found' } };
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const lineageCheck = results.find((r) => r.name.includes('previousSessionIds'));
    expect(lineageCheck?.passed).toBe(false);
  });

  // B1: checkMigrateNonCompounding must catch a server whose migrate compounds seed
  // content on every call, even though `stream()` alone (halting at the first
  // status:'idle') cannot see it — see docs/spec/interactions.md's non-compounding rule.
  it('catches a compounding migrate: a provider that duplicates seeded content grows the true stored history across repeated migrations', async () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    const { provider: baseProvider, controls } = createMockAgentProvider({ clock, seed: 1 });
    const compoundingProvider: AgentProvider = {
      ...baseProvider,
      async createSession(options) {
        return baseProvider.createSession(
          options.seed ? { ...options, seed: { events: [...options.seed.events, ...options.seed.events] } } : options,
        );
      },
    };
    const server = createReferenceServer({ provider: compoundingProvider, clock });

    const results = await runServerChecks(server, controls);
    const nonCompoundingCheck = findCheck(results, 'non-compounding');
    expect(nonCompoundingCheck?.passed).toBe(false);
  });

  // B2: checkLineageAppendOnlyOldestFirst must catch a server that prepends instead of
  // appends — indistinguishable from correct behaviour with only a single migration.
  it('catches a lineage-reordering migrate: a server that prepends instead of appending to previousSessionIds', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      migrate: async (conversationId, caller) => {
        const result = await realServer.migrate(conversationId, caller);
        if (!result.ok) return result;
        // The real migrate already appended correctly; corrupt only the returned view
        // to simulate a server that reports a reversed (prepended) lineage.
        return { ok: true, value: { ...result.value, previousSessionIds: [...result.value.previousSessionIds].reverse() } };
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const lineageCheck = findCheck(results, 'previousSessionIds');
    expect(lineageCheck?.passed).toBe(false);
  });

  // N3(a): checkDegradesToFreshStartOnTranscriptFetchFailure must catch a server that
  // fails migrate outright instead of degrading to an empty seed.
  it('catches a migrate that fails outright instead of degrading to a fresh start on transcript-fetch failure', async () => {
    const { server: realServer, controls, provider } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      migrate: async (conversationId, caller) => {
        const conversation = realServer.getConversation(conversationId);
        if (conversation) {
          const probe = await provider.listSessionEvents(conversation.currentSessionId);
          if (!probe.ok) {
            return { ok: false, error: { code: 'Broken.TranscriptFetchFailed', message: 'simulated: migrate fails instead of degrading' } };
          }
        }
        return realServer.migrate(conversationId, caller);
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const degradeCheck = findCheck(results, 'degrades to an empty');
    expect(degradeCheck?.passed).toBe(false);
  });

  // Issue #12: checkDegradesToFreshStartOnTranscriptFetchFailure must catch a server
  // that silently degrades — empty seed, `outcome: 'success'` — but hides the
  // degradation by never flagging the emitted AuditEvent `degraded: true`. This is
  // the exact defect the issue reports: a degraded migrate indistinguishable from a
  // normal one in the audit trail. `migrate` itself is untouched (the real
  // implementation already sets `degraded` correctly internally); only the
  // observability surface (`listAuditEvents`) is corrupted, simulating a
  // non-conformant server whose audit log strips the field before it is read back.
  it('catches a migrate that degrades but hides it: the emitted AuditEvent is never flagged degraded', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () => realServer.listAuditEvents().map((event) => (event.what === 'migrate' ? { ...event, degraded: undefined } : event)),
    };

    const results = await runServerChecks(brokenServer, controls);
    const degradeCheck = findCheck(results, 'degrades to an empty');
    expect(degradeCheck?.passed).toBe(false);
  });

  // Issue #12: checkNormalMigrateNotFlaggedDegraded must catch the opposite failure
  // mode — a server that stamps every migrate's AuditEvent degraded: true
  // unconditionally, which would make the field useless (an auditor could never
  // trust it to mean anything) even though the check above would pass.
  it('catches a server that flags every migrate degraded, including a normal full-seed migrate', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      listAuditEvents: () => realServer.listAuditEvents().map((event) => (event.what === 'migrate' && event.outcome === 'success' ? { ...event, degraded: true } : event)),
    };

    const results = await runServerChecks(brokenServer, controls);
    const notDegradedCheck = findCheck(results, 'NOT flagged degraded');
    expect(notDegradedCheck?.passed).toBe(false);
  });

  // N3(b): checkPublishDoesNotDisturbLiveConversations must catch a publish that
  // cascades into migrate for conversations pinned to the definition being published.
  it('catches a publish that cascades into migrate, disturbing a live Conversation pinned to a different version', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const conversationsByDefinition = new Map<string, string[]>();
    const brokenServer: typeof realServer = {
      ...realServer,
      createConversation: async (input) => {
        const result = await realServer.createConversation(input);
        if (result.ok) {
          const list = conversationsByDefinition.get(input.agentDefinitionId) ?? [];
          list.push(result.value.id);
          conversationsByDefinition.set(input.agentDefinitionId, list);
        }
        return result;
      },
      publish: async (definitionId, caller) => {
        const result = await realServer.publish(definitionId, caller);
        // Violation: cascade every tracked live conversation onto the newly
        // published version — exactly what docs/spec/interactions.md forbids
        // ("Publish MUST NOT mutate any existing Session or Conversation").
        for (const conversationId of conversationsByDefinition.get(definitionId) ?? []) {
          await realServer.migrate(conversationId, caller);
        }
        return result;
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const noDisturbCheck = findCheck(results, 'does not disturb a live Conversation');
    expect(noDisturbCheck?.passed).toBe(false);
  });

  // N3(c): checkMigrateReattachesResources must catch a server that mints the new
  // session with resources dropped instead of carried over from the outgoing session.
  it('catches a migrate that drops resources instead of re-attaching them onto the newly minted session', async () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    const { provider: baseProvider, controls } = createMockAgentProvider({ clock, seed: 1 });
    const droppingProvider: AgentProvider = {
      ...baseProvider,
      // Only migrate's Stage 1 passes `seed` — createConversation/createBuilderSession
      // never do — so this narrows the violation to exactly the migrate mint.
      async createSession(options) {
        return baseProvider.createSession(options.seed ? { ...options, resources: [] } : options);
      },
    };
    const server = createReferenceServer({ provider: droppingProvider, clock });

    const results = await runServerChecks(server, controls);
    const resourcesCheck = findCheck(results, 're-attaches the outgoing session\'s resources');
    expect(resourcesCheck?.passed).toBe(false);
  });

  // Issue #13: checkDrainResolvesPendingToolCalls must catch a drain that reports
  // success while the underlying session remains 'running' — the exact defect the
  // fix in run-drain-to-idle.ts closes. A lying drain (always reports "idle") proves
  // the check independently arranges — and detects — the still-running scenario,
  // rather than merely trusting whatever status the server's own DrainOutcome claims.
  it('catches a drain that reports success while the underlying session remains running', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      drain: async (sessionId, caller) => {
        const result = await realServer.drain(sessionId, caller);
        // Violation: lie about reaching idle instead of surfacing the real (failure) outcome.
        return result.ok ? result : { ok: true, value: { status: 'idle' as const, resolvedToolUseIds: [] } };
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const drainCheck = findCheck(results, 'drain enumerates and resolves pending tool calls');
    expect(drainCheck?.passed).toBe(false);
  });

  // N3(d): checkCreateConversationRejectsNeverPublishedDefinition must catch a server
  // that still falls back to pinning a real Conversation to draftVersion — the old,
  // non-conformant behaviour the SHOULD-fix on create-conversation.ts removed.
  it('catches a server that still pins a real Conversation to draftVersion when never published (the old, non-conformant fallback)', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      createConversation: async (input) => {
        const definition = realServer.getAgentDefinition(input.agentDefinitionId);
        if (!definition) return { ok: false, error: { code: 'x', message: 'not found' } };
        if (definition.publishedVersion !== null) return realServer.createConversation(input);

        // Simulate the old non-conformant fallback: mint a draftVersion-pinned
        // session and wrap it in a fabricated Conversation, exactly like the
        // pre-fix implementation used to.
        const sessionResult = await realServer.createBuilderSession(definition.id, input.resources ?? []);
        if (!sessionResult.ok) return sessionResult;
        return {
          ok: true,
          value: conversationSchema.parse({
            id: `conv_broken_${sessionResult.value.id}`,
            scope: input.scope,
            initiatingPrincipal: input.initiatingPrincipal,
            currentSessionId: sessionResult.value.id,
            pinnedAgentVersion: sessionResult.value.pinnedAgentVersion, // == draftVersion — the violation
            previousSessionIds: [],
          }),
        };
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const neverPublishedCheck = findCheck(results, 'never-published AgentDefinition is rejected');
    expect(neverPublishedCheck?.passed).toBe(false);
  });
});
