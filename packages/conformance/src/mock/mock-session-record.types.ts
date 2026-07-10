import type { Session } from '@oasp/schemas';
import type { PendingToolCall } from '../adapter/pending-tool-call.types';
import type { SessionStatus } from '../adapter/session-status.types';
import type { ZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';
import type { Event } from '@oasp/schemas';

/**
 * The mock provider's internal, mutable record of one session's state.
 * Never exposed directly — every {@link import('../adapter/agent-provider.types').AgentProvider}
 * method reads/writes this through the provider's own closure, never
 * handing a live reference out to callers (callers only ever see the
 * immutable `Session` snapshot or `Event[]` copies).
 */
export interface MockSessionRecord {
  readonly session: Session;
  status: SessionStatus;
  readonly events: Event[];
  readonly idGenerator: ZeroPaddedIdGenerator;
  pendingToolCalls: PendingToolCall[];
  /** One-shot flag: the next `listSessionEvents` call for this session fails, then clears itself. */
  transcriptFetchShouldFailOnce: boolean;
  /**
   * Set at session creation (see `MockProviderControls.forceNextSessionToStayRunningAfterDrain`).
   * When `true`, `processSendToolResult` suppresses the ordinary
   * all-pending-calls-resolved transition to `'idle'`, leaving `status`
   * at `'running'` instead — simulating a chained tool call re-parking
   * the session immediately after the enumerated batch resolves. Used
   * to exercise `drain`'s (and `migrate`'s Stage 3's) confirmation that
   * success requires genuinely reaching `'idle'`, not just "no more
   * calls were pending a moment ago".
   */
  stayRunningAfterDrain: boolean;
}
