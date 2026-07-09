import { describe, expect, it } from 'vitest';
import { formatPrincipalRef } from './format-principal-ref';

describe('formatPrincipalRef', () => {
  it('renders kind:id', () => {
    expect(formatPrincipalRef({ kind: 'user', id: 'user_1' })).toBe('user:user_1');
  });
});
