import type { Event } from '@oasp/schemas';
import type { Clock } from '../shared/clock.types';
import type { ZeroPaddedIdGenerator } from '../shared/zero-padded-id-generator';

/**
 * Re-stamps a transcript being seeded into a brand-new session: every
 * event keeps its original type-specific content but is assigned a
 * fresh `id`/`at` from the *new* session's own generator/clock. This
 * is required, not cosmetic — the S1 ordering guarantee is scoped
 * "within a Session" (`docs/spec/interactions.md` § `stream`), so an
 * event carried over from the outgoing session's id space would not
 * be comparable to the new session's own ids at all.
 *
 * Re-stamping every seeded event exactly once, from the literal
 * fetched transcript, is also what keeps `migrate` non-compounding in
 * this package's design: there is no marker embedded in event content
 * to strip or accidentally double-wrap (see `docs/spec/adapters.md` §
 * the `seed` transport) — the seed is always the flat, literal
 * transcript, re-numbered once.
 */
export function reseedTranscript(events: readonly Event[], idGenerator: ZeroPaddedIdGenerator, clock: Clock): Event[] {
  return events.map((event) => {
    const { id: _id, at: _at, ...rest } = event;
    return { ...rest, id: idGenerator.next(), at: clock.now() } as Event;
  });
}
