import type { SeededRandom } from '../shared/seeded-random';

/**
 * Canned reply templates the mock provider chooses between. Content
 * variety is cosmetic only — no conformance check depends on *which*
 * template is picked, only that picking one is reproducible.
 */
const REPLY_TEMPLATES: readonly string[] = [
  'Acknowledged: {input}',
  'Here is my response to "{input}".',
  'Processing complete for: {input}',
];

/**
 * Deterministically generates assistant reply text for a given input
 * message. The seeded {@link SeededRandom} only selects *which*
 * template is used — never whether a reply is produced, what shape the
 * surrounding event sequence takes, or any event's `id`/order. That
 * keeps the mock provider's control flow fully deterministic even
 * though this one piece of content has variety.
 */
export function generateReplyText(random: SeededRandom, input: string): string {
  const index = Math.floor(random() * REPLY_TEMPLATES.length) % REPLY_TEMPLATES.length;
  const template = REPLY_TEMPLATES[index] ?? REPLY_TEMPLATES[0]!;
  return template.replace('{input}', input);
}
