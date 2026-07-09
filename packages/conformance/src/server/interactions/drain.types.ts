import type { SessionStatus } from '../../adapter/session-status.types';

/** Result of a successful `drain`: the session's confirmed status (always `'idle'` on success) and which pending tool uses were resolved, oldest-enumerated-first. */
export interface DrainOutcome {
  readonly status: SessionStatus;
  readonly resolvedToolUseIds: readonly string[];
}
