import { conversationSchema, type Credential } from '@oasp/schemas';
import { describe, expect, it } from 'vitest';
import type { AgentProvider } from '../../../adapter/agent-provider.types';
import { testHarnessFactory } from '../../../factories/test-harness-factory';
import { createMockAgentProvider } from '../../../mock/create-mock-agent-provider';
import { createReferenceServer } from '../../../server/create-reference-server';
import { resolveVaultIds } from '../../../server/credential/resolve-vault-ids';
import { authorizePendingToolCall } from '../../../server/interactions/authorize-pending-tool-call';
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

  // Issue #10 (B1): checkDrainVersionIsolation must catch a LIVE-READING server —
  // one that authorizes pending tool calls against whatever the current, still-
  // editable AgentDefinition holds instead of the pinned version's immutable
  // content snapshot. The brokenServer below re-creates the pre-#10 behaviour
  // faithfully: it runs the real authorizePendingToolCall, but feeds it the LIVE
  // definition (getAgentDefinition) rather than the pinned version snapshot, and
  // rejects before delegating — exactly what drainInteraction did before the fix.
  // Crucially, such a server passes EVERY pre-existing check in this file (no other
  // check edits draft content between pinning and driving a pinned interaction, so
  // live and pinned content never differ for them) — only the version-isolation
  // check separates it from a conformant one.
  it('catches a live-reading drain: authorization resolved against the CURRENT AgentDefinition instead of the pinned version snapshot (the pre-#10 defect)', async () => {
    const { server: realServer, controls, provider } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      drain: async (sessionId, caller) => {
        const session = realServer.getSession(sessionId);
        const liveDefinition = session && realServer.getAgentDefinition(session.pinnedAgentVersion.agentDefinitionId);
        if (session && liveDefinition) {
          const pending = await provider.getPendingToolCalls(sessionId);
          if (pending.ok) {
            const rejection = pending.value.map((call) => authorizePendingToolCall(liveDefinition, sessionId, call)).find((result) => !result.ok);
            if (rejection && !rejection.ok) return rejection;
          }
        }
        return realServer.drain(sessionId, caller);
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const isolationCheck = findCheck(results, "pinned version's own snapshotted grants");
    expect(isolationCheck?.passed).toBe(false);
    // The live-reading defect is invisible to the pre-#10 authorization check —
    // asserted here to prove the new check is load-bearing, not redundant.
    const preExistingAuthorizationCheck = findCheck(results, 'not authorized by the pinned AgentDefinition');
    expect(preExistingAuthorizationCheck?.passed).toBe(true);
  });

  // Issue #10 (B1), migrate variant: checkMigrateVersionIsolation must catch a server
  // whose Stage 1 resolves vaultIds against the LIVE definition's current tool grants
  // instead of the target version's snapshot. Only the observability surface is
  // corrupted (same technique as the degraded-flag teeth tests above): every Session
  // read back reports vaultIds re-resolved against the live definition via the real
  // resolveVaultIds — exactly the resolution a live-reading server would have stored.
  it('catches a live-reading migrate: vaultIds resolved against the CURRENT AgentDefinition instead of the target version snapshot (the pre-#10 defect)', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const registeredCredentials = new Map<string, Credential>();
    const brokenServer: typeof realServer = {
      ...realServer,
      registerCredential: (input) => {
        const credential = realServer.registerCredential(input);
        registeredCredentials.set(credential.id, credential);
        return credential;
      },
      getSession: (id) => {
        const session = realServer.getSession(id);
        const liveDefinition = session && realServer.getAgentDefinition(session.pinnedAgentVersion.agentDefinitionId);
        return session && liveDefinition ? { ...session, vaultIds: [...resolveVaultIds(liveDefinition, registeredCredentials)] } : session;
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const isolationCheck = findCheck(results, "TARGET version's snapshotted grants");
    expect(isolationCheck?.passed).toBe(false);
  });

  // Issue #9: checkDrainRejectsUnauthorizedToolCalls must catch a server that papers
  // over an authorization rejection with a fabricated success outcome — simulating a
  // server that dispatches every enumerated pending tool call regardless of whether
  // it is actually covered by the pinned AgentDefinition's granted tools. A
  // genuinely granted call is left untouched by this brokenServer, so only the
  // rejection assertions are what this test proves the check catches.
  it('catches a drain that ignores pinned-grant authorization, reporting success for an unauthorized pending tool call', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      drain: async (sessionId, caller) => {
        const result = await realServer.drain(sessionId, caller);
        return result.ok || result.error.code !== 'Server.UnauthorizedToolCall'
          ? result
          : { ok: true, value: { status: 'idle' as const, resolvedToolUseIds: [] } };
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const authorizationCheck = findCheck(results, 'not authorized by the pinned AgentDefinition');
    expect(authorizationCheck?.passed).toBe(false);
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
            resourceType: 'Conversation',
            id: `conv_broken_${sessionResult.value.id}`,
            scope: input.scope,
            initiatingPrincipal: { kind: 'user', id: input.actor.principalId },
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

  // Issue #7 Tranche A: checkWriteRejectsOutOfScopeActor must catch a server
  // that ignores write-path authorization entirely — papering over a
  // Server.Unauthorized rejection with a fabricated success, the same
  // technique used above for the pre-existing tool-call-authorization check.
  it('catches a server that ignores write-path scope authorization, reporting success for an out-of-scope actor', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      send: async (sessionId, content, actor) => {
        const result = await realServer.send(sessionId, content, actor);
        return result.ok || result.error.code !== 'Server.Unauthorized' ? result : { ok: true, value: undefined };
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const authorizationCheck = findCheck(results, 'a write against a scope the actor is not a member of');
    expect(authorizationCheck?.passed).toBe(false);
  });

  // Issue #7 Tranche A: checkDelegatedActorCannotExceedScopePin must catch a
  // server whose authorization, when delegated, falls back to consulting the
  // acting principal's own scopeMemberships instead of enforcing the
  // scopePin ceiling — exactly the widening the containment rule forbids.
  // Simulated the same way as the check above: convert the correct
  // rejection into a fabricated success.
  it('catches a server whose delegated-actor authorization widens beyond the scopePin (containment rule violation)', async () => {
    const { server: realServer, controls } = testHarnessFactory();
    const brokenServer: typeof realServer = {
      ...realServer,
      publish: async (definitionId, actor) => {
        const result = await realServer.publish(definitionId, actor);
        if (result.ok || result.error.code !== 'Server.Unauthorized') return result;
        const definition = realServer.getAgentDefinition(definitionId);
        return definition ? { ok: true, value: definition } : result;
      },
    };

    const results = await runServerChecks(brokenServer, controls);
    const containmentCheck = findCheck(results, 'containment rule');
    expect(containmentCheck?.passed).toBe(false);
  });
});
