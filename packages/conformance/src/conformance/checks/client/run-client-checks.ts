import { eventSchema } from '@oasp/schemas';
import { failed, passed, type CheckResult } from '../../check-result.types';

function checkAllEventsValidateAgainstEventSchema(events: readonly unknown[]): CheckResult {
  const name = 'client: every consumed event validates against the normalised Event vocabulary';
  const invalidIndex = events.findIndex((event) => !eventSchema.safeParse(event).success);
  return invalidIndex === -1 ? passed(name) : failed(name, `event at index ${invalidIndex} does not conform to eventSchema`);
}

function checkTerminatesOnIdleOrFatalError(events: readonly unknown[]): CheckResult {
  const name = 'client: the stream terminates on status:idle or a non-recoverable error, per the S1 termination rule';
  if (events.length === 0) return failed(name, 'stream yielded no events at all');
  const last = eventSchema.safeParse(events[events.length - 1]);
  if (!last.success) return failed(name, 'final event does not even validate as an Event');
  const isIdle = last.data.type === 'status' && last.data.status === 'idle';
  const isFatalError = last.data.type === 'error' && !last.data.recoverable;
  return isIdle || isFatalError ? passed(name) : failed(name, `final event was ${last.data.type}, expected status:idle or a non-recoverable error`);
}

function checkEventIdsLexicographicallyMonotonic(events: readonly unknown[]): CheckResult {
  const name = 'client: event ids are lexicographically monotonic — a client can trust them as a pagination cursor';
  const ids = events
    .map((event) => eventSchema.safeParse(event))
    .filter((result) => result.success)
    .map((result) => result.data.id);
  const sorted = [...ids].sort();
  return JSON.stringify(ids) === JSON.stringify(sorted) ? passed(name) : failed(name, `ids not lexicographically sorted: ${JSON.stringify(ids)}`);
}

/**
 * Validates that a consumed event stream is something a conformant
 * *client* can correctly interpret: every event conforms to the
 * normalised `Event` vocabulary (`@oasp/schemas`' `eventSchema`), the
 * stream terminates exactly per the S1 rule (`status: 'idle'` or a
 * non-recoverable `error`), and event ids are trustworthy as a
 * pagination cursor. This is the "Client" conformance level's
 * executable check — Level 1 conformance is about correctly consuming
 * this vocabulary, so the check operates on a raw, already-consumed
 * event stream rather than driving a server or provider itself.
 */
export async function runClientChecks(events: AsyncIterable<unknown>): Promise<CheckResult[]> {
  const collected: unknown[] = [];
  for await (const event of events) collected.push(event);

  return [
    checkAllEventsValidateAgainstEventSchema(collected),
    checkTerminatesOnIdleOrFatalError(collected),
    checkEventIdsLexicographicallyMonotonic(collected),
  ];
}
