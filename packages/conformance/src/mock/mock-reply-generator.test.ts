import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../shared/seeded-random';
import { generateReplyText } from './mock-reply-generator';

describe('generateReplyText', () => {
  it('embeds the input content into the generated reply', () => {
    const random = createSeededRandom(1);
    expect(generateReplyText(random, 'hello there')).toContain('hello there');
  });

  it('is fully reproducible given the same seed', () => {
    const a = generateReplyText(createSeededRandom(7), 'ping');
    const b = generateReplyText(createSeededRandom(7), 'ping');
    expect(a).toBe(b);
  });
});
