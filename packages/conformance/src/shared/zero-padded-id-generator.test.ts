import { describe, expect, it } from 'vitest';
import { createZeroPaddedIdGenerator } from './zero-padded-id-generator';

describe('createZeroPaddedIdGenerator', () => {
  it('produces ids that are lexicographically monotonic in emission order', () => {
    const generator = createZeroPaddedIdGenerator('sess_1', 3);
    const ids = Array.from({ length: 12 }, () => generator.next());
    const sortedByteWise = [...ids].sort();
    expect(ids).toEqual(sortedByteWise);
  });

  it('demonstrates why zero-padding matters: past 9 items, unpadded ids would sort out of order', () => {
    const generator = createZeroPaddedIdGenerator('sess_1', 3);
    const ids = Array.from({ length: 11 }, () => generator.next());
    // The 11th id (counter value 10) must sort AFTER the 3rd id (counter value 2).
    expect(ids[10]! > ids[2]!).toBe(true);
  });

  it('prefixes every id with the given prefix', () => {
    const generator = createZeroPaddedIdGenerator('sess_abc');
    expect(generator.next().startsWith('sess_abc_')).toBe(true);
  });

  it('two independently-constructed generators with the same prefix agree on every call', () => {
    const a = createZeroPaddedIdGenerator('sess_1');
    const b = createZeroPaddedIdGenerator('sess_1');
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });
});
