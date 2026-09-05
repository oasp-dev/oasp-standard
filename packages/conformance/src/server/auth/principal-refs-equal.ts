import type { PrincipalRef } from '@oasp/schemas';

/**
 * Exact `{ kind, id }` equality between two `PrincipalRef`s — the
 * `Credential.onBehalfOf` counterpart to `scopes-equal.ts`'s `Scope`
 * equality (issue #8): a `Credential` delegated for one Principal must
 * never attach for a structurally-different one, so this is a flat
 * field comparison, never a "same underlying identity under a
 * different kind" inference the standard does not define.
 *
 * Used by `resolve-credential-bindings.ts` to check a Credential's
 * `onBehalfOf` (when present) against the resolving interaction's
 * `AuthenticatedActor.delegation.onBehalfOf` — see that file's doc
 * comment for the containment rule this backs.
 */
export function principalRefsEqual(a: PrincipalRef, b: PrincipalRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
