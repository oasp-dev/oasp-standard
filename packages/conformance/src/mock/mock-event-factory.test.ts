import { describe, expect, it } from 'vitest';
import { createFixedClock } from '../shared/fixed-clock';
import { createZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';
import { buildEvent } from './mock-event-factory';

describe('buildEvent', () => {
  it('stamps the variant with an id from the generator and a timestamp from the clock', () => {
    const idGenerator = createZeroPaddedIdGenerator('sess_1');
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    const event = buildEvent(idGenerator, clock, { type: 'status', status: 'idle' });

    expect(event).toEqual({
      resourceType: 'Event',
      type: 'status',
      status: 'idle',
      id: 'sess_1_0000000000',
      at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('produces lexicographically increasing ids across successive calls', () => {
    const idGenerator = createZeroPaddedIdGenerator('sess_1');
    const clock = createFixedClock('2026-01-01T00:00:00.000Z');

    const first = buildEvent(idGenerator, clock, { type: 'status', status: 'running' });
    const second = buildEvent(idGenerator, clock, { type: 'status', status: 'idle' });

    expect(first.id < second.id).toBe(true);
  });
});
