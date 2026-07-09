import { describe, expect, it } from 'vitest';
import { failed, passed } from './check-result.types';

describe('passed', () => {
  it('builds a passing CheckResult with no detail', () => {
    expect(passed('some check')).toEqual({ name: 'some check', passed: true });
  });
});

describe('failed', () => {
  it('builds a failing CheckResult carrying the detail message', () => {
    expect(failed('some check', 'went wrong')).toEqual({ name: 'some check', passed: false, detail: 'went wrong' });
  });
});
