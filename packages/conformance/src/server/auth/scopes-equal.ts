import type { Scope } from '@oasp/schemas';

/**
 * Exact `{ level, id }` equality between two `Scope`s. Deliberately the
 * ONLY notion of scope equality this package uses for authorization
 * (`authorize.ts`): `docs/spec/scope-and-identity.md` defines a fixed
 * precedence order for resolving among several candidate resources, but
 * no containment-by-nesting relationship between scope levels — e.g. a
 * `workspace` scope is never "wider than" a `group` scope it happens to
 * contain in some deployment's data model, because the standard itself
 * does not define such a relationship. Treating one scope as satisfying
 * another via any kind of nesting would be inventing authorization
 * behaviour the spec does not require, so this stays a flat equality
 * check, never a hierarchy walk.
 */
export function scopesEqual(a: Scope, b: Scope): boolean {
  return a.level === b.level && a.id === b.id;
}
