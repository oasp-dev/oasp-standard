import type { Clock } from '../shared/clock.types';
import type { SeededRandom } from '../shared/seeded-random';
import { buildEvent } from './mock-event-factory';
import { mockSentinels } from './mock-sentinels';
import { generateReplyText } from './mock-reply-generator';
import type { MockSessionRecord } from './mock-session-record.types';

/**
 * Advances a mock session's state in response to a `sendMessage` call,
 * appending the resulting {@link Event}s and updating `status` /
 * `pendingToolCalls` on `record` in place. Branches on the
 * `content`/{@link mockSentinels} vocabulary to deterministically
 * simulate a normal reply, a tool-use turn, or an induced error — see
 * `mock-sentinels.ts` for what each recognised value does.
 *
 * Mutates `record`; not a pure function, but every input it reads
 * (`record`, `clock`, `random`) is caller-supplied, so its behaviour is
 * still fully deterministic and independently testable given a
 * constructed `record`.
 */
export function processSendMessage(record: MockSessionRecord, content: string, clock: Clock, random: SeededRandom): void {
  record.status = 'running';
  const messageId = `msg_${record.events.length}`;

  if (content.startsWith(mockSentinels.toolUsePrefix)) {
    const toolName = content.slice(mockSentinels.toolUsePrefix.length) || 'unknown_tool';
    const toolUseId = `tooluse_${record.events.length}`;
    record.events.push(
      buildEvent(record.idGenerator, clock, { type: 'assistant_message_start', messageId }),
      buildEvent(record.idGenerator, clock, {
        type: 'custom_tool_use',
        toolUseId,
        name: toolName,
        input: { requestedBy: 'mock' },
      }),
    );
    record.pendingToolCalls.push({ toolUseId, name: toolName, input: { requestedBy: 'mock' } });
    // status stays 'running' — the session is parked on the tool call until sendToolResult/drain resolves it.
    return;
  }

  if (content === mockSentinels.errorRecoverable) {
    record.events.push(
      buildEvent(record.idGenerator, clock, { type: 'error', message: 'Induced recoverable error (mock).', recoverable: true }),
      buildEvent(record.idGenerator, clock, { type: 'status', status: 'idle' }),
    );
    record.status = 'idle';
    return;
  }

  if (content === mockSentinels.errorFatal) {
    record.events.push(
      buildEvent(record.idGenerator, clock, { type: 'error', message: 'Induced fatal error (mock).', recoverable: false }),
    );
    record.status = 'error';
    return;
  }

  const replyText = generateReplyText(random, content);
  record.events.push(
    buildEvent(record.idGenerator, clock, { type: 'assistant_message_start', messageId }),
    buildEvent(record.idGenerator, clock, { type: 'assistant_message_text', messageId, delta: replyText }),
    buildEvent(record.idGenerator, clock, { type: 'assistant_message_end', messageId }),
    buildEvent(record.idGenerator, clock, { type: 'status', status: 'idle' }),
  );
  record.status = 'idle';
}
