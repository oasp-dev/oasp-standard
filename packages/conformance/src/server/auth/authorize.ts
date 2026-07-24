import type { Scope } from '@oasp/schemas';
import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';
import type { AuthenticatedActor } from './authenticated-actor.types';
import { scopesEqual } from './scopes-equal';

/**
 * The write-path authorization gate (issue #7 Tranche A) — mirrors
 * `authorize-pending-tool-call.ts`'s shape: a pure, `Result`-returning
 * check with no `ServerState`/provider access of its own, called by
 * every one of the six write interactions immediately after resolving
 * their primary resource and before any side effect.
 *
 * Per `docs/spec/scope-and-identity.md` § On-behalf-of and
 * scope-pinning: the containment rule:
 *
 * - **Delegated** (`actor.delegation` present): authorized iff
 *   `resourceScope` equals `actor.delegation.scopePin` — exact match.
 *   `actor.scopeMemberships`/`roles` are deliberately NOT consulted
 *   here: the pin is the ceiling, and the rule is explicit that
 *   neither party's memberships may widen a delegated action's reach
 *   beyond it. Checking memberships as a fallback would reopen exactly
 *   the widening the containment rule exists to close.
 * - **Un-delegated**: authorized iff some entry in
 *   `actor.scopeMemberships` equals `resourceScope`.
 *
 * Equality is always exact `{level, id}` match (`scopes-equal.ts`) —
 * the standard defines no scope-nesting/containment relationship to
 * check against instead.
 */
export function authorize(actor: AuthenticatedActor, resourceScope: Scope): Result<void, DomainError> {
  if (actor.delegation) {
    return scopesEqual(resourceScope, actor.delegation.scopePin)
      ? ok(undefined)
      : err(serverErrors.unauthorized(actor.principalId, resourceScope, 'resource scope does not equal the delegation\'s scopePin'));
  }

  const isMember = actor.scopeMemberships.some((membership) => scopesEqual(membership, resourceScope));
  return isMember ? ok(undefined) : err(serverErrors.unauthorized(actor.principalId, resourceScope, 'actor has no matching scopeMemberships entry'));
}
