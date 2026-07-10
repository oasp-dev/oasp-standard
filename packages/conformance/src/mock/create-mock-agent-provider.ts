import type { AgentDefinition, Deployment, Session } from '@oasp/schemas';
import type { AgentProvider } from '../adapter/agent-provider.types';
import { adapterErrors } from '../adapter/adapter-error';
import type { CreateSessionOptions } from '../adapter/create-session-options.types';
import type { PendingToolCall } from '../adapter/pending-tool-call.types';
import { err, ok } from '../shared/result';
import { createSeededRandom } from '../shared/seeded-random';
import { createZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';
import { computeCanonicalHash } from './canonical-hash';
import type { MockAgentProviderOptions } from './mock-provider-options.types';
import type { MockProviderControls } from './mock-provider-controls.types';
import type { MockSessionRecord } from './mock-session-record.types';
import { buildEvent } from './mock-event-factory';
import { processSendMessage } from './process-send-message';
import { processSendToolResult } from './process-send-tool-result';
import { reseedTranscript } from './reseed-transcript';
import { resourceMountKey } from './resource-mount-key';

/**
 * Constructs a deterministic, fully in-memory {@link AgentProvider}
 * implementation, plus a {@link MockProviderControls} handle for
 * arranging test scenarios the ordinary contract has no vocabulary for
 * (induced transcript-fetch failure, a session that starts already
 * parked on a tool call, a session that stays `'running'` even after
 * every one of its pending tool calls has been posted).
 *
 * No network, no timers, no real randomness affecting control flow —
 * every timestamp comes from `options.clock` and the only randomness
 * (which canned reply template to use) is seeded by `options.seed`.
 * Two calls to any method, across two separately-constructed providers
 * built from clocks/seeds with the same starting values and driven
 * with the same call sequence, produce byte-identical results.
 *
 * @see docs/spec/adapters.md for the contract this implements.
 */
export function createMockAgentProvider(options: MockAgentProviderOptions): {
  readonly provider: AgentProvider;
  readonly controls: MockProviderControls;
} {
  const { clock, seed } = options;
  const random = createSeededRandom(seed);

  const environments = new Set<string>();
  const deployments = new Map<string, Deployment>();
  const sessions = new Map<string, MockSessionRecord>();
  const resourceMountCounts = new Map<string, number>();
  let deploymentCounter = 0;
  let sessionCounter = 0;
  let queuedPendingToolCall: PendingToolCall | undefined;
  let forceStayRunningAfterDrainForNextSession = false;

  function buildDeployment(definition: AgentDefinition, environmentId: string, providerAgentId: string): Deployment {
    deploymentCounter += 1;
    return {
      id: `deployment_${deploymentCounter}`,
      agentDefinitionId: definition.id,
      provider: definition.provider,
      providerAgentId,
      environmentId,
      providerVersion: `v${definition.draftVersion}`,
      canonicalHash: computeCanonicalHash(JSON.stringify(definition)),
    };
  }

  const provider: AgentProvider = {
    async ensureEnvironment(environmentId) {
      environments.add(environmentId);
      return ok({ environmentId });
    },

    async createAgent(definition, environmentId) {
      deploymentCounter += 1;
      const providerAgentId = `provider_agent_${deploymentCounter}`;
      const deployment = buildDeployment(definition, environmentId, providerAgentId);
      deployments.set(providerAgentId, deployment);
      return ok(deployment);
    },

    async updateAgent(providerAgentId, definition, environmentId) {
      if (!deployments.has(providerAgentId)) {
        return err(adapterErrors.agentNotFound(providerAgentId));
      }
      const updated = buildDeployment(definition, environmentId, providerAgentId);
      deployments.set(providerAgentId, updated);
      return ok(updated);
    },

    async getAgent(providerAgentId) {
      const deployment = deployments.get(providerAgentId);
      return deployment ? ok(deployment) : err(adapterErrors.agentNotFound(providerAgentId));
    },

    async createSession(sessionOptions: CreateSessionOptions) {
      sessionCounter += 1;
      const sessionId = `session_${sessionCounter}`;
      const idGenerator = createZeroPaddedIdGenerator(sessionId);

      for (const resource of sessionOptions.resources) {
        const key = resourceMountKey(resource);
        resourceMountCounts.set(key, (resourceMountCounts.get(key) ?? 0) + 1);
      }

      const events = sessionOptions.seed ? reseedTranscript(sessionOptions.seed.events, idGenerator, clock) : [];

      const session: Session = {
        id: sessionId,
        pinnedAgentVersion: sessionOptions.pinnedAgentVersion,
        resources: sessionOptions.resources,
        vaultIds: [...sessionOptions.vaultIds],
      };

      const record: MockSessionRecord = {
        session,
        status: 'idle',
        events,
        idGenerator,
        pendingToolCalls: [],
        transcriptFetchShouldFailOnce: false,
        stayRunningAfterDrain: forceStayRunningAfterDrainForNextSession,
      };
      forceStayRunningAfterDrainForNextSession = false;

      if (queuedPendingToolCall) {
        const toolCall = queuedPendingToolCall;
        queuedPendingToolCall = undefined;
        record.pendingToolCalls.push(toolCall);
        record.status = 'running';
        record.events.push(
          buildEvent(idGenerator, clock, {
            type: 'custom_tool_use',
            toolUseId: toolCall.toolUseId,
            name: toolCall.name,
            input: toolCall.input,
          }),
        );
      }

      sessions.set(sessionId, record);
      return ok(session);
    },

    async sendMessage(sessionId, content) {
      const record = sessions.get(sessionId);
      if (!record) return err(adapterErrors.sessionNotFound(sessionId));
      processSendMessage(record, content, clock, random);
      return ok(undefined);
    },

    async sendToolResult(sessionId, toolUseId, result) {
      const record = sessions.get(sessionId);
      if (!record) return err(adapterErrors.sessionNotFound(sessionId));
      const index = record.pendingToolCalls.findIndex((call) => call.toolUseId === toolUseId);
      if (index === -1) return err(adapterErrors.unknownToolUse(toolUseId));
      record.pendingToolCalls.splice(index, 1);
      processSendToolResult(record, result, clock);
      return ok(undefined);
    },

    async getSessionStatus(sessionId) {
      const record = sessions.get(sessionId);
      return record ? ok(record.status) : err(adapterErrors.sessionNotFound(sessionId));
    },

    async listSessionEvents(sessionId, listOptions) {
      const record = sessions.get(sessionId);
      if (!record) return err(adapterErrors.sessionNotFound(sessionId));

      if (record.transcriptFetchShouldFailOnce) {
        record.transcriptFetchShouldFailOnce = false;
        return err(adapterErrors.transcriptFetchFailed(sessionId));
      }

      const afterId = listOptions?.afterId;
      const filtered = afterId ? record.events.filter((event) => event.id > afterId) : [...record.events];
      const limit = listOptions?.limit ?? filtered.length;
      const page = filtered.slice(0, limit);
      const nextCursor = page.length < filtered.length ? (page[page.length - 1]?.id ?? null) : null;

      return ok({ events: page, nextCursor });
    },

    streamEvents(sessionId) {
      const record = sessions.get(sessionId);
      return (async function* () {
        if (!record) return;
        for (const event of record.events) {
          yield event;
          if (event.type === 'status' && event.status === 'idle') return;
          if (event.type === 'error' && !event.recoverable) return;
        }
      })();
    },

    async getPendingToolCalls(sessionId) {
      const record = sessions.get(sessionId);
      return record ? ok([...record.pendingToolCalls]) : err(adapterErrors.sessionNotFound(sessionId));
    },
  };

  const controls: MockProviderControls = {
    induceTranscriptFetchFailureOnce(sessionId) {
      const record = sessions.get(sessionId);
      if (record) record.transcriptFetchShouldFailOnce = true;
    },
    queuePendingToolCallForNextSession(toolCall) {
      queuedPendingToolCall = toolCall;
    },
    getResourceMountCount(resourceKey) {
      return resourceMountCounts.get(resourceKey) ?? 0;
    },
    forceNextSessionToStayRunningAfterDrain() {
      forceStayRunningAfterDrainForNextSession = true;
    },
  };

  return { provider, controls };
}
