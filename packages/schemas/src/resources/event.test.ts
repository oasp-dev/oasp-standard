import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Event, eventSchema } from './event';

const base = { resourceType: 'Event', id: 'evt_1', at: '2026-01-01T00:00:00.000Z' };

describe('eventSchema', () => {
  it.each([
    { ...base, type: 'assistant_message_start', messageId: 'msg_1' },
    { ...base, type: 'assistant_message_text', messageId: 'msg_1', delta: 'Hel' },
    { ...base, type: 'assistant_message_end', messageId: 'msg_1' },
    { ...base, type: 'assistant_thinking', delta: 'considering options' },
    { ...base, type: 'custom_tool_use', toolUseId: 'tu_1', name: 'lookup', input: {} },
    { ...base, type: 'builtin_tool_use', toolUseId: 'tu_2', name: 'search', input: { query: 'x' } },
    { ...base, type: 'status', status: 'running' },
    { ...base, type: 'error', message: 'provider timed out', recoverable: true },
  ])('parses a valid $type event', (candidate) => {
    const result = eventSchema.safeParse(candidate);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('accepts an at with a numeric zone offset (not just UTC Z)', () => {
    const result = eventSchema.safeParse({
      ...base,
      at: '2026-01-01T12:00:00.000+13:00',
      type: 'status',
      status: 'idle',
    });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true);
  });

  it('rejects an unrecognized event type', () => {
    const result = eventSchema.safeParse({ ...base, type: 'assistant_message_delta' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['type']);
  });

  it('rejects a status value outside running|idle|error', () => {
    const result = eventSchema.safeParse({ ...base, type: 'status', status: 'paused' });
    expect(result.success).toBe(false);
  });

  it('infers a discriminated event union', () => {
    expectTypeOf<Event['type']>().toEqualTypeOf<
      | 'assistant_message_start'
      | 'assistant_message_text'
      | 'assistant_message_end'
      | 'assistant_thinking'
      | 'custom_tool_use'
      | 'builtin_tool_use'
      | 'status'
      | 'error'
    >();
  });
});
