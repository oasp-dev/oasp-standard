import { describe, expect, it } from 'vitest';
import { createFixedClock } from '../shared/fixed-clock';
import { createSeededRandom } from '../shared/seeded-random';
import { createZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';
import { mockSentinels } from './mock-sentinels';
import type { MockSessionRecord } from './mock-session-record.types';
import { processSendMessage } from './process-send-message';

function buildRecord(): MockSessionRecord {
  return {
    session: { id: 'session_1', pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 }, resources: [], vaultIds: [] },
    status: 'idle',
    events: [],
    idGenerator: createZeroPaddedIdGenerator('session_1'),
    pendingToolCalls: [],
    transcriptFetchShouldFailOnce: false,
    stayRunningAfterDrain: false,
  };
}

describe('processSendMessage', () => {
  it('produces a full assistant turn and returns to idle for ordinary content', () => {
    const record = buildRecord();
    processSendMessage(record, 'hello', createFixedClock('2026-01-01T00:00:00.000Z'), createSeededRandom(1));

    expect(record.status).toBe('idle');
    expect(record.events.map((e) => e.type)).toEqual([
      'assistant_message_start',
      'assistant_message_text',
      'assistant_message_end',
      'status',
    ]);
  });

  it('parks the session on a pending tool call for the tool-use sentinel', () => {
    const record = buildRecord();
    processSendMessage(record, `${mockSentinels.toolUsePrefix}search_docs`, createFixedClock('2026-01-01T00:00:00.000Z'), createSeededRandom(1));

    expect(record.status).toBe('running');
    expect(record.pendingToolCalls).toHaveLength(1);
    expect(record.pendingToolCalls[0]?.name).toBe('search_docs');
    expect(record.events.some((e) => e.type === 'custom_tool_use')).toBe(true);
    expect(record.events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(false);
  });

  it('recovers to idle after a recoverable induced error', () => {
    const record = buildRecord();
    processSendMessage(record, mockSentinels.errorRecoverable, createFixedClock('2026-01-01T00:00:00.000Z'), createSeededRandom(1));

    expect(record.status).toBe('idle');
    const types = record.events.map((e) => e.type);
    expect(types).toEqual(['error', 'status']);
    expect(record.events[0]).toMatchObject({ type: 'error', recoverable: true });
  });

  it('terminally fails (status error, no idle event) for a fatal induced error', () => {
    const record = buildRecord();
    processSendMessage(record, mockSentinels.errorFatal, createFixedClock('2026-01-01T00:00:00.000Z'), createSeededRandom(1));

    expect(record.status).toBe('error');
    expect(record.events).toHaveLength(1);
    expect(record.events[0]).toMatchObject({ type: 'error', recoverable: false });
  });
});
