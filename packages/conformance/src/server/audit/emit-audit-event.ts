import { auditEventSchema, type AuditEvent } from '@oasp/schemas';
import type { Clock } from '../../shared/clock.types';
import type { ServerState } from '../store/server-state';

/** The fields a caller supplies to emit an `AuditEvent` — everything except `id`/`when`, which this function assigns. */
export type EmitAuditEventInput = Omit<AuditEvent, 'id' | 'when'>;

/**
 * Constructs, validates, and appends one `AuditEvent` to the server's
 * audit log — the single choke point every one of the seven interactions
 * routes through, so "every emitted AuditEvent is schema-valid" is
 * true by construction rather than by convention.
 *
 * Validating with `auditEventSchema.parse` (which throws on failure)
 * rather than `safeParse` is deliberate here: a malformed AuditEvent
 * reaching this function is a bug in *this* server's interaction code,
 * not an expected failure to route back to a caller as a `Result` —
 * per the house Result-pattern rule, exceptions are for exactly this
 * case (a genuine bug), not expected domain failures.
 */
export function emitAuditEvent(state: ServerState, clock: Clock, input: EmitAuditEventInput): AuditEvent {
  state.counters.audit += 1;
  const candidate: AuditEvent = {
    id: `audit_${state.counters.audit}`,
    who: input.who,
    what: input.what,
    scope: input.scope,
    when: clock.now(),
    outcome: input.outcome,
    refs: input.refs,
  };
  const validated = auditEventSchema.parse(candidate);
  state.auditLog.push(validated);
  return validated;
}
