import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Scope, scopeSchema } from './scope';

describe('scopeSchema', () => {
  it('accepts a valid scope at each taxonomy level', () => {
    for (const level of ['tenant', 'workspace', 'user', 'group', 'role']) {
      expect(scopeSchema.safeParse({ level, id: 'entity_1' }).success).toBe(true);
    }
  });

  it('rejects a level outside the taxonomy', () => {
    const result = scopeSchema.safeParse({ level: 'organization', id: 'entity_1' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['level']);
  });

  it('rejects an empty id', () => {
    const result = scopeSchema.safeParse({ level: 'workspace', id: '' });
    expect(result.success).toBe(false);
  });

  it('infers the expected shape', () => {
    expectTypeOf<Scope>().toEqualTypeOf<{ level: 'tenant' | 'workspace' | 'user' | 'group' | 'role'; id: string }>();
  });
});
