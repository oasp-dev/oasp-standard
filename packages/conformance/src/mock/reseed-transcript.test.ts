import { describe, expect, it } from 'vitest';
import type { Event } from '@oasp/schemas';
import { createFixedClock } from '../shared/fixed-clock';
import { createZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';
import { reseedTranscript } from './reseed-transcript';

const outgoingEvents: Event[] = [
  { id: 'session_old_0000000000', at: '2026-01-01T00:00:00.000Z', type: 'assistant_message_start', messageId: 'm1' },
  { id: 'session_old_0000000001', at: '2026-01-01T00:00:01.000Z', type: 'assistant_message_text', messageId: 'm1', delta: 'hi' },
  { id: 'session_old_0000000002', at: '2026-01-01T00:00:02.000Z', type: 'assistant_message_end', messageId: 'm1' },
];

describe('reseedTranscript', () => {
  it('preserves the type-specific content of every event', () => {
    const idGenerator = createZeroPaddedIdGenerator('session_new');
    const clock = createFixedClock('2026-02-01T00:00:00.000Z');

    const reseeded = reseedTranscript(outgoingEvents, idGenerator, clock);

    expect(reseeded).toHaveLength(3);
    expect(reseeded.map((e) => e.type)).toEqual(['assistant_message_start', 'assistant_message_text', 'assistant_message_end']);
  });

  it('re-stamps every event with a fresh id from the new session id space', () => {
    const idGenerator = createZeroPaddedIdGenerator('session_new');
    const clock = createFixedClock('2026-02-01T00:00:00.000Z');

    const reseeded = reseedTranscript(outgoingEvents, idGenerator, clock);

    for (const event of reseeded) {
      expect(event.id.startsWith('session_new_')).toBe(true);
    }
    // Still lexicographically monotonic within the new session.
    expect([...reseeded.map((e) => e.id)].sort()).toEqual(reseeded.map((e) => e.id));
  });

  it('is a flat, one-shot copy: re-running it on its own output does not nest or duplicate content', () => {
    const idGenerator1 = createZeroPaddedIdGenerator('session_a');
    const clock1 = createFixedClock('2026-02-01T00:00:00.000Z');
    const once = reseedTranscript(outgoingEvents, idGenerator1, clock1);

    const idGenerator2 = createZeroPaddedIdGenerator('session_b');
    const clock2 = createFixedClock('2026-03-01T00:00:00.000Z');
    const twice = reseedTranscript(once, idGenerator2, clock2);

    expect(twice).toHaveLength(outgoingEvents.length);
  });
});
