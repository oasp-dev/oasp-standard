/**
 * Content/result sentinels the mock provider recognises to deterministically
 * induce non-happy-path behaviour from ordinary `sendMessage`/`sendToolResult`
 * calls, without needing a bespoke API for every scenario. A test that wants
 * "the provider gets stuck on a tool call" or "the provider fails fatally"
 * simply sends one of these values instead of ordinary content — the
 * resulting event sequence is still fully deterministic given the same
 * clock/seed, satisfying this package's zero-network/zero-magic charter.
 *
 * Grouped as one object (mirroring the house `clientErrors`-style factory
 * grouping) since these are a single, small, tightly-coupled vocabulary
 * always imported and read together.
 */
export const mockSentinels = {
  /** Prefix recognised by `sendMessage`: content starting with this triggers a tool-use turn. The remainder of the string (after the colon) is used as the tool name. */
  toolUsePrefix: 'MOCK_TOOL_USE:',
  /** `sendMessage` content that triggers a recoverable mid-turn error, followed by a self-recovery back to idle. */
  errorRecoverable: 'MOCK_ERROR_RECOVERABLE',
  /** `sendMessage` content that triggers a fatal (non-recoverable) error; the session does not return to idle on its own. */
  errorFatal: 'MOCK_ERROR_FATAL',
  /** `sendToolResult` result value that triggers a fatal error instead of resolving the tool use normally — used to test drain's "executing a blocking tool use fails" path. */
  induceFatalToolError: { __mockInduceFatalError: true } as const,
} as const;
