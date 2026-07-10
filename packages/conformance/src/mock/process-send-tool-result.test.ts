import { describe, expect, it } from 'vitest';
import { createFixedClock } from '../shared/fixed-clock';
import { createZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';
import { mockSentinels } from './mock-sentinels';
import type { MockSessionRecord } from './mock-session-record.types';
import { processSendToolResult } from './process-send-tool-result';

function buildParkedRecord(): MockSessionRecord {
  return {
    session: { id: 'session_1', pinnedAgentVersion: { agentDefinitionId: 'agentdef_1', version: 1 }, resources: [], vaultIds: [] },
    status: 'running',
    events: [],
    idGenerator: createZeroPaddedIdGenerator('session_1'),
    pendingToolCalls: [],
    transcriptFetchShouldFailOnce: false,
    stayRunningAfterDrain: false,
  };
}

describe('processSendToolResult', () => {
  it('returns to idle once no pending tool calls remain (caller has already removed the resolved one)', () => {
    const record = buildParkedRecord();
    processSendToolResult(record, { output: 'ok' }, createFixedClock('2026-01-01T00:00:00.000Z'));

    expect(record.status).toBe('idle');
    expect(record.events).toEqual([expect.objectContaining({ type: 'status', status: 'idle' })]);
  });

  it('stays running if other tool calls are still pending', () => {
    const record = buildParkedRecord();
    record.pendingToolCalls.push({ toolUseId: 'tooluse_2', name: 'other', input: {} });
    processSendToolResult(record, { output: 'ok' }, createFixedClock('2026-01-01T00:00:00.000Z'));

    expect(record.status).toBe('running');
    expect(record.events).toHaveLength(0);
  });

  it('terminally fails when given the fatal-error sentinel', () => {
    const record = buildParkedRecord();
    processSendToolResult(record, mockSentinels.induceFatalToolError, createFixedClock('2026-01-01T00:00:00.000Z'));

    expect(record.status).toBe('error');
    expect(record.events).toEqual([expect.objectContaining({ type: 'error', recoverable: false })]);
  });

  it('stays running instead of transitioning to idle when stayRunningAfterDrain is forced, even with no pending calls left', () => {
    const record = buildParkedRecord();
    record.stayRunningAfterDrain = true;
    processSendToolResult(record, { output: 'ok' }, createFixedClock('2026-01-01T00:00:00.000Z'));

    expect(record.status).toBe('running');
    expect(record.events).toHaveLength(0);
  });
});
