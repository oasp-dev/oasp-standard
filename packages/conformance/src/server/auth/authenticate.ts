import type { DomainError } from '../../shared/domain-error.types';
import { err, ok, type Result } from '../../shared/result';
import { serverErrors } from '../server-errors';
import type { ServerState } from '../store/server-state';
import type { AuthenticatedActor } from './authenticated-actor.types';
import type { AuthenticateInput } from './authenticate-input.types';

/**
 * The reference server's authentication seam — the "transport" boundary
 * a real deployment's session/token verification would occupy. Mints an
 * {@link AuthenticatedActor} by resolving `input.principalId` against
 * `ServerState.principals`, **never** by trusting caller-supplied
 * `subject`/`scopeMemberships`/`roles` directly. This is what makes an
 * `AuthenticatedActor` "derived from the transport/security layer rather
 * than accepted as a request-body assertion" (issue #7 Tranche A) — the
 * exact gap the pre-Tranche-A `CallerContext` left open.
 *
 * **Deferred to a named follow-up (delegation-issuance policy):** when
 * `input.delegation` is present, this function verifies only that
 * `onBehalfOfPrincipalId` names a genuinely registered `Principal` — it
 * does NOT check that `input.principalId`'s principal is itself entitled
 * to act on that party's behalf (e.g. a stored assistant/member pairing
 * grant, or a consent record). A real deployment needs that richer
 * issuance policy; inventing it here would be speculative for a tranche
 * scoped to closing the trust-boundary and write-path-authorization gaps
 * (see the handback). Once minted, `authorize.ts`'s containment rule
 * still holds regardless: `scopePin` is the ceiling no matter how the
 * delegation was issued.
 */
export function authenticate(state: ServerState, input: AuthenticateInput): Result<AuthenticatedActor, DomainError> {
  const principal = state.principals.get(input.principalId);
  if (!principal) return err(serverErrors.authenticationFailed(input.principalId));

  let delegation: AuthenticatedActor['delegation'];
  if (input.delegation) {
    const onBehalfOfPrincipal = state.principals.get(input.delegation.onBehalfOfPrincipalId);
    if (!onBehalfOfPrincipal) return err(serverErrors.authenticationFailed(input.delegation.onBehalfOfPrincipalId));
    delegation = {
      onBehalfOf: { kind: onBehalfOfPrincipal.kind, id: onBehalfOfPrincipal.id },
      scopePin: input.delegation.scopePin,
    };
  }

  return ok({
    principalId: principal.id,
    subject: principal.identity.subject,
    ...(principal.identity.issuer ? { issuer: principal.identity.issuer } : {}),
    scopeMemberships: principal.scopeMemberships,
    roles: principal.roles,
    ...(delegation ? { delegation } : {}),
    authenticationMethod: 'reference',
  });
}
