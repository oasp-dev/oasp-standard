/**
 * Public entry point for `@oasp/conformance`: the `AgentProvider`
 * adapter contract, a deterministic mock provider, a minimal
 * conformant reference server, and the executable Client/Server/
 * Adapter conformance checks — see `README.md` for how to use these
 * together, and `docs/spec/adapters.md` for the normative contract
 * this package makes executable.
 */

// Adapter contract
export type { AgentProvider } from './adapter/agent-provider.types';
export type { AdapterError } from './adapter/adapter-error';
export { adapterErrors } from './adapter/adapter-error';
export type { CreateSessionOptions } from './adapter/create-session-options.types';
export type { SeedTranscript } from './adapter/seed-transcript.types';
export type { PendingToolCall } from './adapter/pending-tool-call.types';
export type { SessionStatus } from './adapter/session-status.types';
export type { EnsureEnvironmentResult } from './adapter/ensure-environment.types';
export type { ListSessionEventsOptions, ListSessionEventsResult } from './adapter/list-session-events.types';

// Deterministic mock provider
export { createMockAgentProvider } from './mock/create-mock-agent-provider';
export type { MockAgentProviderOptions } from './mock/mock-provider-options.types';
export type { MockProviderControls } from './mock/mock-provider-controls.types';
export { mockSentinels } from './mock/mock-sentinels';

// Reference server
export { createReferenceServer } from './server/create-reference-server';
export type { CreateReferenceServerOptions } from './server/create-reference-server-options.types';
export type { ReferenceServer } from './server/reference-server.types';
export type { CallerContext } from './server/caller-context.types';
export type { DrainOutcome } from './server/interactions/drain.types';
export { createEchoToolExecutor } from './server/echo-tool-executor';
export type { ToolExecutor } from './server/tool-executor.types';

// Conformance levels, self-report, and checks
export type { ConformanceLevel } from './conformance/conformance-level.types';
export type { ConformanceSelfReport } from './conformance/self-report.types';
export type { CheckResult } from './conformance/check-result.types';
export { verifySelfReport } from './conformance/verify-self-report';
export type { ConformanceCheckRunners, ConformanceVerificationResult } from './conformance/verify-self-report.types';
export { runServerChecks } from './conformance/checks/server/run-server-checks';
export { runAdapterChecks } from './conformance/checks/adapter/run-adapter-checks';
export { runClientChecks } from './conformance/checks/client/run-client-checks';
export { runAuditChecks } from './conformance/checks/audit/run-audit-checks';

// Shared primitives
export type { Result } from './shared/result';
export { ok, err } from './shared/result';
export type { Clock } from './shared/clock.types';
export { createFixedClock } from './shared/fixed-clock';

// Test factories
export { testHarnessFactory } from './factories/test-harness-factory';
export type { TestHarness } from './factories/test-harness-factory';
export { agentDefinitionInputFactory } from './factories/agent-definition-input-factory';
export { createConversationInputFactory } from './factories/create-conversation-input-factory';
export { registerCredentialInputFactory } from './factories/register-credential-input-factory';
export { callerContextFactory } from './factories/caller-context-factory';
export { principalRefFactory } from './factories/principal-ref-factory';
export { scopeFactory } from './factories/scope-factory';
