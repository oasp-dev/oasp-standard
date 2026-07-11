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
    // Omitted entirely (never `scope: undefined`) unless the caller passed a
    // real value — required for every `outcome` except `not_found` (the
    // schema's own `.check()` enforces that; see `audit-event.ts`), where no
    // primary resource was ever identified to source a scope from
    // (docs/spec/audit.md § Not-found preconditions, issue #11).
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    when: clock.now(),
    outcome: input.outcome,
    // Omitted (never `false`) unless the caller explicitly passed `true` —
    // preserves the schema's absence-is-the-sentinel convention (see
    // `who.onBehalfOf`'s doc comment in audit-event.ts) rather than
    // stamping every non-degraded AuditEvent with an explicit `false`.
    ...(input.degraded === true ? { degraded: true as const } : {}),
    refs: input.refs,
    // Omitted entirely (never `evidence: {}`) unless the caller built a
    // non-empty evidence object via `buildAuditEvidence` — same
    // absence-is-the-sentinel convention as `degraded` above.
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
  };
  const validated = auditEventSchema.parse(candidate);
  state.auditLog.push(validated);
  return validated;
}
