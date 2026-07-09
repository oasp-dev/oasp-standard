import { describe, expect, it } from 'vitest';
import { rewriteDefsRefsToComponents } from './rewrite-refs';

describe('rewriteDefsRefsToComponents', () => {
  it('rewrites a top-level $defs ref to a components.schemas ref', () => {
    expect(rewriteDefsRefsToComponents({ $ref: '#/$defs/Scope' })).toEqual({
      $ref: '#/components/schemas/Scope',
    });
  });

  it('rewrites refs nested inside arrays and objects', () => {
    const input = {
      type: 'object',
      properties: {
        scope: { $ref: '#/$defs/Scope' },
        tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
      },
    };
    expect(rewriteDefsRefsToComponents(input)).toEqual({
      type: 'object',
      properties: {
        scope: { $ref: '#/components/schemas/Scope' },
        tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
      },
    });
  });

  it('leaves refs that do not point at #/$defs/ untouched', () => {
    expect(rewriteDefsRefsToComponents({ $ref: '#/components/schemas/AlreadyThere' })).toEqual({
      $ref: '#/components/schemas/AlreadyThere',
    });
  });

  it('leaves non-$ref keys, primitives, and null untouched', () => {
    expect(rewriteDefsRefsToComponents({ type: 'string', minLength: 1, nullableThing: null })).toEqual({
      type: 'string',
      minLength: 1,
      nullableThing: null,
    });
  });

  it('does not mutate its input', () => {
    const input = { $ref: '#/$defs/Scope' };
    const snapshot = JSON.stringify(input);
    rewriteDefsRefsToComponents(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
