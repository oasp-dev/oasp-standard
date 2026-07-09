import type { PendingToolCall } from '../adapter/pending-tool-call.types';

/**
 * The test-only control surface returned alongside a mock
 * {@link import('../adapter/agent-provider.types').AgentProvider}
 * instance. None of this is part of the `AgentProvider` contract
 * itself — a conformance check exercises the provider purely through
 * that interface — but constructing interesting, deterministic
 * failure/edge scenarios (a degraded transcript fetch, a session that
 * starts already parked on a tool call) needs *some* way to arrange
 * them without polluting `AgentProvider` itself with test-only
 * concerns. This is that "some way," kept entirely separate from the
 * contract it drives.
 */
export interface MockProviderControls {
  /**
   * Causes the *next* `listSessionEvents` call for `sessionId` to fail
   * once (returning `Adapter.TranscriptFetchFailed`), then clears
   * itself. Used to exercise `migrate`'s degrade-to-fresh-start path.
   */
  induceTranscriptFetchFailureOnce(sessionId: string): void;

  /**
   * Causes the session created by the *next* `createSession` call to
   * start already parked on the given tool call, instead of idle. Used
   * to exercise Stage 3 of `migrate` (drain must run on the newly
   * minted session before it is exposed) and standalone `drain` tests.
   */
  queuePendingToolCallForNextSession(toolCall: PendingToolCall): void;

  /** How many times `createSession` has been called with a `resources` entry matching `resourceKey` (e.g. a `fileId`). Proves resources are genuinely re-mounted, not aliased, across repeated `createSession` calls (e.g. `migrate`'s Stage 1). */
  getResourceMountCount(resourceKey: string): number;
}
