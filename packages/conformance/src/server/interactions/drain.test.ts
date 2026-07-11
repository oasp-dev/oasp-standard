import { describe, expect, it } from 'vitest';
import { agentDefinitionInputFactory } from '../../factories/agent-definition-input-factory';
import { callerContextFactory } from '../../factories/caller-context-factory';
import { createConversationInputFactory } from '../../factories/create-conversation-input-factory';
import { testHarnessFactory } from '../../factories/test-harness-factory';
import { createMockAgentProvider } from '../../mock/create-mock-agent-provider';
import { mockSentinels } from '../../mock/mock-sentinels';
import { createFixedClock } from '../../shared/fixed-clock';
import { ok } from '../../shared/result';
import { createReferenceServer } from '../create-reference-server';
import type { ToolExecutor } from '../tool-executor.types';

async function buildParkedSession() {
  const { server } = testHarnessFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  const sessionResult = await server.createBuilderSession(definition.id);
  if (!sessionResult.ok) throw new Error('setup failed');
  await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, callerContextFactory());
  return { server, sessionId: sessionResult.value.id };
}

/** Like `buildParkedSession`, but the session is forced (via `MockProviderControls`) to remain `'running'` even once its pending tool call is posted — the exact Issue #13 scenario: a chained tool call re-parking the session right after the enumerated batch resolves. */
async function buildSessionThatStaysRunningAfterDrain() {
  const { server, controls } = testHarnessFactory();
  const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
  controls.forceNextSessionToStayRunningAfterDrain();
  const sessionResult = await server.createBuilderSession(definition.id);
  if (!sessionResult.ok) throw new Error('setup failed');
  await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, callerContextFactory());
  return { server, sessionId: sessionResult.value.id };
}

describe('drain', () => {
  it('enumerates and resolves every pending tool call, returning the session to idle', async () => {
    const { server, sessionId } = await buildParkedSession();

    const result = await server.drain(sessionId, callerContextFactory());
    expect(result).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: expect.arrayContaining([expect.any(String)]) } });

    const pending = await server.drain(sessionId, callerContextFactory()); // idempotent re-drain
    expect(pending).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: [] } });
  });

  it('is idempotent: draining an already-idle session is a no-op success', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: [] } });
  });

  it('returns a failure outcome (not a false idle) when executing a blocking tool use fails fatally', async () => {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    const { provider } = createMockAgentProvider({ clock, seed: 1 });
    const failingExecutor: ToolExecutor = { execute: async () => ok(mockSentinels.induceFatalToolError) };
    const server = createReferenceServer({ provider, clock, toolExecutor: failingExecutor });

    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');
    await server.send(sessionResult.value.id, `${mockSentinels.toolUsePrefix}lookup`, callerContextFactory());

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DrainFailed');

    const auditEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(auditEvents[0]?.outcome).toBe('failure');
  });

  it('returns a failure outcome (never a false idle) when the session remains "running" after every enumerated pending tool call is posted', async () => {
    const { server, sessionId } = await buildSessionThatStaysRunningAfterDrain();

    const result = await server.drain(sessionId, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.DrainFailed');

    const auditEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(auditEvents[0]?.outcome).toBe('failure');
  });

  it('rejects an unknown sessionId', async () => {
    const { server } = testHarnessFactory();
    const result = await server.drain('does_not_exist', callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.SessionNotFound');
  });

  // Issue #11 Tranche A: a not-found probe MUST NOT vanish from the trail.
  it('emits a not_found AuditEvent (not silence) naming the caller-asserted sessionId, with no fabricated scope', async () => {
    const { server } = testHarnessFactory();
    await server.drain('does_not_exist', callerContextFactory());

    const events = server.listAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ what: 'drain', outcome: 'not_found', refs: { sessionId: 'does_not_exist' } });
    expect(events[0] && 'scope' in events[0]).toBe(false);
  });

  it('emits exactly one AuditEvent{ what: "drain" } scoped via the pinned AgentDefinition for an unbound (builder) session', async () => {
    const { server, sessionId } = await buildParkedSession();
    await server.drain(sessionId, callerContextFactory());

    const drainEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(drainEvents).toHaveLength(1);
    expect(drainEvents[0]).toMatchObject({ outcome: 'success', refs: { sessionId } });
  });
});

describe('drain — pinned-grant authorization (issue #9)', () => {
  /** Builds a reference server wired to a spy `ToolExecutor` that records every call it is asked to execute — so a rejected call's "the executor is never invoked" guarantee is directly observable, not just inferred from the outcome. `provider` is exposed so tests can park a session on MULTIPLE pending calls by driving `sendMessage` directly (the `MockProviderControls` queue holds only a single call per session). */
  function buildHarnessWithSpyExecutor() {
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');
    const { provider, controls } = createMockAgentProvider({ clock, seed: 1 });
    const executedToolCalls: string[] = [];
    const spyExecutor: ToolExecutor = {
      execute: async (toolCall) => {
        executedToolCalls.push(toolCall.toolUseId);
        return ok({ tool: toolCall.name, echoedInput: toolCall.input });
      },
    };
    const server = createReferenceServer({ provider, clock, toolExecutor: spyExecutor });
    return { server, controls, provider, executedToolCalls };
  }

  it('rejects a pending call for a tool not present in the pinned AgentDefinition, pre-dispatch — the executor is never invoked, and the rejection is still audited', async () => {
    const { server, controls, executedToolCalls } = buildHarnessWithSpyExecutor();
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory({ tools: [] }));
    controls.queuePendingToolCallForNextSession({ toolUseId: 'tooluse_unlisted', name: 'delete_everything', input: {} });
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');
    expect(executedToolCalls).toEqual([]);

    // Issue #9's pre-dispatch authorization rejection is not a new,
    // separately-unaudited failure path: `drainInteraction`'s unconditional
    // `outcome.ok ? 'success' : 'failure'` emission already covers it —
    // verified here, not re-fixed (see `drain.ts`'s class doc comment).
    const drainEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(drainEvents).toHaveLength(1);
    expect(drainEvents[0]?.outcome).toBe('failure');
  });

  it('rejects an MCP-routed pending call whose reported serverUrl does not match any granted server, pre-dispatch — the executor is never invoked', async () => {
    const { server, controls, executedToolCalls } = buildHarnessWithSpyExecutor();
    const definition = await server.createAgentDefinition(
      agentDefinitionInputFactory({
        tools: [{ type: 'mcp', serverUrl: 'https://mcp.example.com/granted', label: 'Granted', auth: 'none', permissionPolicy: 'always_allow' }],
      }),
    );
    controls.queuePendingToolCallForNextSession({
      toolUseId: 'tooluse_wrong_server',
      name: 'search',
      input: {},
      mcpServerUrl: 'https://attacker.example.com/evil',
    });
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');
    expect(executedToolCalls).toEqual([]);
  });

  it('rejects an MCP-routed pending call excluded by the matching grant\'s toolAllowlist, pre-dispatch — the executor is never invoked', async () => {
    const { server, controls, executedToolCalls } = buildHarnessWithSpyExecutor();
    const definition = await server.createAgentDefinition(
      agentDefinitionInputFactory({
        tools: [
          {
            type: 'mcp',
            serverUrl: 'https://mcp.example.com/granted',
            label: 'Granted',
            auth: 'none',
            permissionPolicy: 'always_allow',
            toolAllowlist: ['search'],
          },
        ],
      }),
    );
    controls.queuePendingToolCallForNextSession({
      toolUseId: 'tooluse_excluded',
      name: 'delete_repo',
      input: {},
      mcpServerUrl: 'https://mcp.example.com/granted',
    });
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');
    expect(executedToolCalls).toEqual([]);
  });

  it('still drains a genuinely granted MCP call to idle, invoking the executor exactly once', async () => {
    const { server, controls, executedToolCalls } = buildHarnessWithSpyExecutor();
    const definition = await server.createAgentDefinition(
      agentDefinitionInputFactory({
        tools: [
          {
            type: 'mcp',
            serverUrl: 'https://mcp.example.com/granted',
            label: 'Granted',
            auth: 'none',
            permissionPolicy: 'always_allow',
            toolAllowlist: ['search'],
          },
        ],
      }),
    );
    controls.queuePendingToolCallForNextSession({
      toolUseId: 'tooluse_granted',
      name: 'search',
      input: {},
      mcpServerUrl: 'https://mcp.example.com/granted',
    });
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');

    const result = await server.drain(sessionResult.value.id, callerContextFactory());
    expect(result).toEqual({ ok: true, value: { status: 'idle', resolvedToolUseIds: ['tooluse_granted'] } });
    expect(executedToolCalls).toEqual(['tooluse_granted']);
  });

  it('rejects the ENTIRE batch when the unauthorized call is enumerated last — the granted call before it is not executed either, and every call still gets a posted result', async () => {
    const { server, provider, executedToolCalls } = buildHarnessWithSpyExecutor();
    // Factory default grants exactly the custom tool 'lookup' — so the first
    // sentinel-parked call below is granted and the second is unlisted.
    const definition = await server.createAgentDefinition(agentDefinitionInputFactory());
    const sessionResult = await server.createBuilderSession(definition.id);
    if (!sessionResult.ok) throw new Error('setup failed');
    const sessionId = sessionResult.value.id;

    // Park the session on TWO pending calls, granted first, unauthorized
    // last — the adversarial ordering the all-or-nothing batch design
    // exists for: were authorization interleaved with dispatch, the
    // granted call would already have executed by the time the bad one
    // was detected. Driven via the provider directly because the
    // MockProviderControls queue holds only a single call per session.
    await provider.sendMessage(sessionId, `${mockSentinels.toolUsePrefix}lookup`);
    await provider.sendMessage(sessionId, `${mockSentinels.toolUsePrefix}delete_everything`);

    const result = await server.drain(sessionId, callerContextFactory());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('Server.UnauthorizedToolCall');

    // All-or-nothing: NOTHING in the batch was dispatched — not even the granted 'lookup' call.
    expect(executedToolCalls).toEqual([]);

    // ...yet every enumerated call still got a posted (error) result, so none remains parked forever.
    const pendingAfter = await provider.getPendingToolCalls(sessionId);
    expect(pendingAfter).toEqual({ ok: true, value: [] });
  });
});

describe('drain — version isolation from unpublished draft edits (issue #10)', () => {
  // Before issue #10's per-version content snapshot store, `drainInteraction`
  // resolved authorization against `state.agentDefinitions.get(...)` — the
  // LIVE, currently-editable `AgentDefinition` — regardless of which version
  // the Session actually claimed to be pinned to. This test proves the fix:
  // a real Conversation's session, pinned to PUBLISHED v1, keeps resolving
  // against v1's grants even after a later, still-UNPUBLISHED draft edit
  // changes (here: revokes) the live AgentDefinition's tools. Under the
  // pre-#10 behaviour this test would have failed with
  // `Server.UnauthorizedToolCall`, since the live draft grants nothing by
  // the time `drain` runs.
  it('drains a session pinned to a published version using THAT version\'s grants, unaffected by a later unpublished draft edit revoking them', async () => {
    const { server } = testHarnessFactory();
    const definition = await server.createAgentDefinition(
      agentDefinitionInputFactory({
        tools: [{ type: 'custom', name: 'resume', description: 'Resumes a prior task.', inputSchema: {} }],
      }),
    );
    await server.publish(definition.id, callerContextFactory());

    const conversationResult = await server.createConversation(createConversationInputFactory(definition.id));
    if (!conversationResult.ok) throw new Error('setup failed');
    const sessionId = conversationResult.value.currentSessionId;

    // Park the v1-pinned session on a pending call for the tool v1 grants.
    await server.send(sessionId, `${mockSentinels.toolUsePrefix}resume`, callerContextFactory());

    // Advance the draft to v2, revoking 'resume' entirely — but never publish
    // it. The Conversation/Session above remain pinned to published v1.
    const editResult = await server.editAgentDefinitionDraft(definition.id, { tools: [] });
    if (!editResult.ok) throw new Error('setup failed');
    expect(server.getAgentDefinition(definition.id)?.tools).toEqual([]); // the live Definition genuinely changed...

    const result = await server.drain(sessionId, callerContextFactory());

    // ...yet the v1-pinned session still resolves against v1's OWN grants,
    // which still include 'resume' — proving version isolation, not merely
    // "nothing changed."
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('idle');

    const drainEvents = server.listAuditEvents().filter((e) => e.what === 'drain');
    expect(drainEvents[drainEvents.length - 1]?.outcome).toBe('success');
  });
});
