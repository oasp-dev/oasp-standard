/**
 * A blocking tool use a session is currently parked on, as enumerated
 * by {@link import('./agent-provider.types').AgentProvider.getPendingToolCalls}.
 * A conformant adapter MUST preserve every field here faithfully —
 * `drain` cannot execute a tool call it cannot correctly identify.
 *
 * @see docs/spec/adapters.md § `getPendingToolCalls`
 */
export interface PendingToolCall {
  /** Correlates this tool use to the `sendToolResult` call that resolves it. */
  readonly toolUseId: string;
  /** Name of the tool being invoked (custom or builtin). */
  readonly name: string;
  /** The input arguments passed to the tool. */
  readonly input: Readonly<Record<string, unknown>>;
}
