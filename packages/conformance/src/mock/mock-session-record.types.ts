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
}
