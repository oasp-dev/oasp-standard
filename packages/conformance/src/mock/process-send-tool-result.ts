import type { Clock } from '../shared/clock.types';
import { buildEvent } from './mock-event-factory';
import { mockSentinels } from './mock-sentinels';
import type { MockSessionRecord } from './mock-session-record.types';

/**
 * Advances a mock session's state in response to a `sendToolResult`
 * call for a tool use already confirmed pending (the caller — see
 * `create-mock-agent-provider.ts` — has already validated `toolUseId`
 * against `record.pendingToolCalls` and removed it before calling
 * this). Appends the resulting {@link Event}s and updates `status` on
 * `record` in place: idle once no tool calls remain pending, or a
 * fatal error if `result` is the {@link mockSentinels.induceFatalToolError}
 * sentinel — see `docs/spec/interactions.md` § `drain`'s "executing a
 * blocking tool use fails" path.
 */
export function processSendToolResult(record: MockSessionRecord, result: unknown, clock: Clock): void {
  if (
    typeof result === 'object' &&
    result !== null &&
    '__mockInduceFatalError' in result &&
    (result as { __mockInduceFatalError: unknown }).__mockInduceFatalError === true
  ) {
    record.events.push(
      buildEvent(record.idGenerator, clock, {
        type: 'error',
        message: 'Induced fatal error while executing a blocking tool use (mock).',
        recoverable: false,
      }),
    );
    record.status = 'error';
    return;
  }

  if (record.pendingToolCalls.length === 0) {
    record.events.push(buildEvent(record.idGenerator, clock, { type: 'status', status: 'idle' }));
    record.status = 'idle';
  }
  // else: other tool calls are still pending — stay 'running' until every one is resolved.
}
